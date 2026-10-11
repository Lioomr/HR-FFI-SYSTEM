"""Pluggable key custody for the organization seal and the internal CA.

``local``   Key files on disk (PKCS#12 or PEM). When none are configured and
            ``DOCUMENT_SIGNING_DEV_AUTOGENERATE`` is on, a dev root CA and a seal
            certificate are generated once under ``DOCUMENT_SIGNING_KEY_DIR``
            (encrypted with the Fernet key). Dev material is **not** publicly
            trusted: PDF readers report an unknown signer until its root is trusted.
``aws_kms`` The seal's private key stays in AWS KMS; only digests leave the host.
            Needs ``boto3`` (not installed by default), a KMS key id, and the seal
            certificate issued for that key. Per-person keys still use the local
            internal CA (encrypted at rest), which is weaker than KMS/HSM custody.
"""

from __future__ import annotations

import hashlib
import logging
import os
import time
from dataclasses import dataclass, field
from pathlib import Path

from asn1crypto import algos as asn1_algos
from cryptography import x509
from django.conf import settings
from pyhanko.sign import signers
from pyhanko_certvalidator.registry import SimpleCertificateStore

from . import crypto
from .conf import SigningConfigurationError, dev_autogenerate, key_dir

logger = logging.getLogger(__name__)

DEV_CA_CERT = "dev_root_ca.crt.pem"
DEV_CA_KEY = "dev_root_ca.key.pem"
DEV_SEAL_CERT = "dev_seal.crt.pem"
DEV_SEAL_KEY = "dev_seal.key.pem"
DEV_CA_DAYS = 3650
DEV_SEAL_DAYS = 1825


@dataclass
class SigningCredential:
    """Everything pyHanko needs to sign, plus the certificate for reporting."""

    signer: signers.Signer
    certificate: x509.Certificate
    chain: list[x509.Certificate] = field(default_factory=list)

    @property
    def common_name(self) -> str:
        names = self.certificate.subject.get_attributes_for_oid(x509.oid.NameOID.COMMON_NAME)
        return str(names[0].value) if names else ""


def _registry(chain: list[x509.Certificate]) -> SimpleCertificateStore:
    return SimpleCertificateStore.from_certs([crypto.to_asn1_cert(cert) for cert in chain])


def simple_credential(key, certificate: x509.Certificate, chain: list[x509.Certificate]) -> SigningCredential:
    signer = signers.SimpleSigner(
        signing_cert=crypto.to_asn1_cert(certificate),
        signing_key=crypto.to_asn1_key(key),
        cert_registry=_registry(chain),
    )
    return SigningCredential(signer=signer, certificate=certificate, chain=list(chain))


def _read(path: str | Path) -> bytes:
    return Path(path).read_bytes()


def _write_private(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as handle:
        handle.write(data)


class _DirectoryLock:
    """Cross-process lock so two workers never generate two different dev CAs."""

    def __init__(self, directory: Path, timeout: float = 30.0):
        self.path = directory / ".generate.lock"
        self.timeout = timeout
        self.fd = None

    def __enter__(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        deadline = time.monotonic() + self.timeout
        while True:
            try:
                self.fd = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
                return self
            except FileExistsError:
                try:
                    if time.time() - self.path.stat().st_mtime > self.timeout:
                        self.path.unlink(missing_ok=True)
                        continue
                except FileNotFoundError:
                    continue
                if time.monotonic() > deadline:
                    raise SigningConfigurationError("Timed out waiting for the signing key directory lock.")
                time.sleep(0.1)

    def __exit__(self, *exc):
        if self.fd is not None:
            os.close(self.fd)
        self.path.unlink(missing_ok=True)


class LocalSigningBackend:
    name = "local"

    # -- internal CA -----------------------------------------------------
    def _configured_ca(self):
        cert_path = str(getattr(settings, "DOCUMENT_SIGNING_CA_CERT_PATH", "") or "").strip()
        key_path = str(getattr(settings, "DOCUMENT_SIGNING_CA_KEY_PATH", "") or "").strip()
        if not (cert_path and key_path):
            return None
        password = str(getattr(settings, "DOCUMENT_SIGNING_CA_KEY_PASSWORD", "") or "").encode() or None
        cert = crypto.load_pem_certificates(_read(cert_path))[0]
        return cert, crypto.load_key_pem(_read(key_path), password)

    def _dev_paths(self) -> dict[str, Path]:
        directory = key_dir()
        return {
            "ca_cert": directory / DEV_CA_CERT,
            "ca_key": directory / DEV_CA_KEY,
            "seal_cert": directory / DEV_SEAL_CERT,
            "seal_key": directory / DEV_SEAL_KEY,
        }

    def _dev_material_exists(self) -> bool:
        return all(path.exists() for path in self._dev_paths().values())

    def ensure_dev_material(self) -> bool:
        """Create the dev CA and seal once. Returns whether anything was generated."""

        if self._dev_material_exists():
            return False
        if not dev_autogenerate():
            raise SigningConfigurationError(
                "No signing keys are configured and DOCUMENT_SIGNING_DEV_AUTOGENERATE is off."
            )
        paths = self._dev_paths()
        with _DirectoryLock(key_dir()):
            if self._dev_material_exists():
                return False
            password = crypto.key_file_password()
            organization = str(getattr(settings, "DOCUMENT_SIGNING_ORGANIZATION", "") or "FFI")
            ca_key = crypto.generate_key(crypto.AUTHORITY_KEY_BITS)
            ca_cert = crypto.build_certificate(
                subject=crypto.build_name(
                    f"{organization} HR Internal Root CA (DEV - NOT TRUSTED)", organization=organization
                ),
                public_key=ca_key.public_key(),
                issuer_cert=None,
                issuer_key=ca_key,
                days=DEV_CA_DAYS,
                ca=True,
            )
            seal_key = crypto.generate_key(crypto.AUTHORITY_KEY_BITS)
            seal_cert = crypto.build_certificate(
                subject=crypto.build_name(
                    str(getattr(settings, "DOCUMENT_SIGNING_SEAL_NAME", "") or "HR Document Seal"),
                    organization=organization,
                ),
                public_key=seal_key.public_key(),
                issuer_cert=ca_cert,
                issuer_key=ca_key,
                days=DEV_SEAL_DAYS,
                extended_usages=crypto.DOCUMENT_SIGNING_USAGES,
            )
            _write_private(paths["ca_key"], crypto.write_encrypted_key_pem(ca_key, password))
            _write_private(paths["seal_key"], crypto.write_encrypted_key_pem(seal_key, password))
            _write_private(paths["seal_cert"], crypto.cert_pem(seal_cert).encode())
            # The CA certificate is written last: its presence marks a complete set.
            _write_private(paths["ca_cert"], crypto.cert_pem(ca_cert).encode())
        logger.warning(
            "document_signing.dev_material_generated",
            extra={"ca_fingerprint": crypto.cert_fingerprint(ca_cert), "directory": str(key_dir())},
        )
        return True

    def certificate_authority(self):
        """Return ``(ca_cert, ca_key)`` used to issue per-person certificates."""

        configured = self._configured_ca()
        if configured is not None:
            return configured
        self.ensure_dev_material()
        paths = self._dev_paths()
        password = crypto.key_file_password()
        cert = crypto.load_pem_certificates(_read(paths["ca_cert"]))[0]
        return cert, crypto.load_key_pem(_read(paths["ca_key"]), password)

    def trust_roots(self) -> list[x509.Certificate]:
        """Internal roots, read without generating anything."""

        roots: list[x509.Certificate] = []
        cert_path = str(getattr(settings, "DOCUMENT_SIGNING_CA_CERT_PATH", "") or "").strip()
        candidates = [Path(cert_path)] if cert_path else []
        candidates.append(self._dev_paths()["ca_cert"])
        for path in candidates:
            try:
                roots.extend(crypto.load_pem_certificates(path.read_bytes()))
            except (OSError, ValueError):
                continue
        chain_path = str(getattr(settings, "DOCUMENT_SIGNING_SEAL_CHAIN_PATH", "") or "").strip()
        if chain_path:
            try:
                roots.extend(c for c in crypto.load_pem_certificates(_read(chain_path)) if c.issuer == c.subject)
            except (OSError, ValueError):
                pass
        return roots

    # -- organization seal ----------------------------------------------
    def seal_credential(self) -> SigningCredential:
        pkcs12_path = str(getattr(settings, "DOCUMENT_SIGNING_SEAL_PKCS12_PATH", "") or "").strip()
        if pkcs12_path:
            from cryptography.hazmat.primitives.serialization import pkcs12

            password = str(getattr(settings, "DOCUMENT_SIGNING_SEAL_PKCS12_PASSWORD", "") or "").encode() or None
            key, cert, extra = pkcs12.load_key_and_certificates(_read(pkcs12_path), password)
            if key is None or cert is None:
                raise SigningConfigurationError("The seal PKCS#12 file has no key or certificate.")
            return simple_credential(key, cert, list(extra or []))
        key_path = str(getattr(settings, "DOCUMENT_SIGNING_SEAL_KEY_PATH", "") or "").strip()
        cert_path = str(getattr(settings, "DOCUMENT_SIGNING_SEAL_CERT_PATH", "") or "").strip()
        if key_path and cert_path:
            certs = crypto.load_pem_certificates(_read(cert_path))
            chain_path = str(getattr(settings, "DOCUMENT_SIGNING_SEAL_CHAIN_PATH", "") or "").strip()
            chain = crypto.load_pem_certificates(_read(chain_path)) if chain_path else []
            password = str(getattr(settings, "DOCUMENT_SIGNING_SEAL_PKCS12_PASSWORD", "") or "").encode() or None
            return simple_credential(crypto.load_key_pem(_read(key_path), password), certs[0], certs[1:] + chain)

        self.ensure_dev_material()
        paths = self._dev_paths()
        password = crypto.key_file_password()
        ca_cert = crypto.load_pem_certificates(_read(paths["ca_cert"]))[0]
        seal_cert = crypto.load_pem_certificates(_read(paths["seal_cert"]))[0]
        return simple_credential(crypto.load_key_pem(_read(paths["seal_key"]), password), seal_cert, [ca_cert])

    # -- per-person credentials -----------------------------------------
    def personal_credential(self, record) -> SigningCredential:
        if record.key_backend != "local" or not record.encrypted_private_key:
            raise SigningConfigurationError(f"Certificate {record.serial} has no locally held key.")
        cert = crypto.load_pem_certificates(record.certificate_pem.encode())[0]
        ca_cert, _ = self.certificate_authority()
        return simple_credential(crypto.decrypt_private_key(record.encrypted_private_key), cert, [ca_cert])


class KmsSigner(signers.Signer):
    """pyHanko signer whose RSA private key never leaves AWS KMS."""

    _ALGORITHMS = {"sha256": "RSASSA_PKCS1_V1_5_SHA_256", "sha384": "RSASSA_PKCS1_V1_5_SHA_384"}

    def __init__(self, *, key_id: str, client, signing_cert, cert_registry, signature_bytes: int):
        self.key_id = key_id
        self.client = client
        self.signature_bytes = signature_bytes
        super().__init__(
            signing_cert=signing_cert,
            cert_registry=cert_registry,
            signature_mechanism=asn1_algos.SignedDigestAlgorithm({"algorithm": "sha256_rsa"}),
        )

    async def async_sign_raw(self, data: bytes, digest_algorithm: str, dry_run=False) -> bytes:
        if dry_run:
            return bytes(self.signature_bytes)
        algorithm = self._ALGORITHMS.get(digest_algorithm.lower())
        if algorithm is None:
            raise SigningConfigurationError(f"Unsupported digest for KMS signing: {digest_algorithm}")
        digest = hashlib.new(digest_algorithm, data).digest()
        response = self.client.sign(KeyId=self.key_id, Message=digest, MessageType="DIGEST", SigningAlgorithm=algorithm)
        return response["Signature"]


class AwsKmsSigningBackend(LocalSigningBackend):
    name = "aws_kms"

    def __init__(self, client=None):
        self._client = client

    def _kms_client(self):
        if self._client is not None:
            return self._client
        try:
            import boto3  # noqa: PLC0415 - optional dependency, only for this backend
        except ImportError as exc:
            raise SigningConfigurationError("DOCUMENT_SIGNING_BACKEND=aws_kms needs boto3 installed.") from exc
        region = str(getattr(settings, "DOCUMENT_SIGNING_KMS_REGION", "") or "").strip() or None
        self._client = boto3.client("kms", region_name=region)
        return self._client

    def seal_credential(self) -> SigningCredential:
        key_id = str(getattr(settings, "DOCUMENT_SIGNING_KMS_KEY_ID", "") or "").strip()
        cert_path = str(getattr(settings, "DOCUMENT_SIGNING_SEAL_CERT_PATH", "") or "").strip()
        if not (key_id and cert_path):
            raise SigningConfigurationError(
                "aws_kms needs DOCUMENT_SIGNING_KMS_KEY_ID and DOCUMENT_SIGNING_SEAL_CERT_PATH."
            )
        certs = crypto.load_pem_certificates(_read(cert_path))
        chain_path = str(getattr(settings, "DOCUMENT_SIGNING_SEAL_CHAIN_PATH", "") or "").strip()
        chain = certs[1:] + (crypto.load_pem_certificates(_read(chain_path)) if chain_path else [])
        signer = KmsSigner(
            key_id=key_id,
            client=self._kms_client(),
            signing_cert=crypto.to_asn1_cert(certs[0]),
            cert_registry=_registry(chain),
            signature_bytes=certs[0].public_key().key_size // 8,
        )
        return SigningCredential(signer=signer, certificate=certs[0], chain=chain)


_BACKENDS = {"local": LocalSigningBackend, "aws_kms": AwsKmsSigningBackend}


def get_signing_backend():
    name = str(getattr(settings, "DOCUMENT_SIGNING_BACKEND", "local") or "local").strip().lower()
    backend = _BACKENDS.get(name)
    if backend is None:
        raise SigningConfigurationError(f"Unknown DOCUMENT_SIGNING_BACKEND {name!r}.")
    return backend()
