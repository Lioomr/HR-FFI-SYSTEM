"""Key, certificate and at-rest encryption helpers (``cryptography`` based)."""

from __future__ import annotations

import datetime as dt
import hashlib
from collections.abc import Iterable

from asn1crypto import keys as asn1_keys
from asn1crypto import x509 as asn1_x509
from cryptography import x509
from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

from .conf import SigningConfigurationError, fernet_key

PERSONAL_KEY_BITS = 2048
AUTHORITY_KEY_BITS = 3072


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def generate_key(bits: int = PERSONAL_KEY_BITS) -> rsa.RSAPrivateKey:
    return rsa.generate_private_key(public_exponent=65537, key_size=bits)


def build_name(common_name: str, *, organization: str = "", email: str = "", serial_number: str = "") -> x509.Name:
    attributes = [x509.NameAttribute(NameOID.COMMON_NAME, (common_name or "Unnamed")[:64])]
    if organization:
        attributes.append(x509.NameAttribute(NameOID.ORGANIZATION_NAME, organization[:64]))
    if serial_number:
        attributes.append(x509.NameAttribute(NameOID.SERIAL_NUMBER, serial_number[:64]))
    if email:
        attributes.append(x509.NameAttribute(NameOID.EMAIL_ADDRESS, email[:128]))
    return x509.Name(attributes)


def build_certificate(
    *,
    subject: x509.Name,
    public_key,
    issuer_cert: x509.Certificate | None,
    issuer_key,
    days: int,
    ca: bool = False,
    extended_usages: Iterable = (),
) -> x509.Certificate:
    """Issue a certificate. ``issuer_cert=None`` makes it self-signed."""

    now = dt.datetime.now(dt.timezone.utc)
    issuer_name = issuer_cert.subject if issuer_cert is not None else subject
    builder = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer_name)
        .public_key(public_key)
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - dt.timedelta(minutes=5))
        .not_valid_after(now + dt.timedelta(days=days))
        .add_extension(x509.BasicConstraints(ca=ca, path_length=0 if ca else None), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=not ca,
                content_commitment=not ca,
                key_encipherment=False,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=ca,
                crl_sign=ca,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
        .add_extension(x509.SubjectKeyIdentifier.from_public_key(public_key), critical=False)
    )
    if issuer_cert is not None:
        builder = builder.add_extension(
            x509.AuthorityKeyIdentifier.from_issuer_public_key(issuer_cert.public_key()), critical=False
        )
    usages = list(extended_usages)
    if usages:
        builder = builder.add_extension(x509.ExtendedKeyUsage(usages), critical=False)
    return builder.sign(issuer_key, hashes.SHA256())


DOCUMENT_SIGNING_USAGES = (ExtendedKeyUsageOID.EMAIL_PROTECTION,)


def cert_fingerprint(cert: x509.Certificate) -> str:
    return cert.fingerprint(hashes.SHA256()).hex()


def serial_hex(serial: int) -> str:
    return format(int(serial), "x")


def cert_pem(cert: x509.Certificate) -> str:
    return cert.public_bytes(serialization.Encoding.PEM).decode("ascii")


def load_pem_certificates(data: bytes) -> list[x509.Certificate]:
    return list(x509.load_pem_x509_certificates(data)) if data.strip() else []


def to_asn1_cert(cert: x509.Certificate) -> asn1_x509.Certificate:
    return asn1_x509.Certificate.load(cert.public_bytes(serialization.Encoding.DER))


def to_asn1_key(key) -> asn1_keys.PrivateKeyInfo:
    der = key.private_bytes(serialization.Encoding.DER, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    return asn1_keys.PrivateKeyInfo.load(der)


def _fernet() -> Fernet:
    try:
        return Fernet(fernet_key())
    except ValueError as exc:
        raise SigningConfigurationError("DOCUMENT_SIGNING_KEY_ENCRYPTION_KEY is not a valid Fernet key.") from exc


def encrypt_private_key(key) -> str:
    der = key.private_bytes(serialization.Encoding.DER, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    return _fernet().encrypt(der).decode("ascii")


def decrypt_private_key(token: str):
    try:
        der = _fernet().decrypt(token.encode("ascii"))
    except InvalidToken as exc:
        raise SigningConfigurationError("A stored signing key could not be decrypted with the configured key.") from exc
    return serialization.load_der_private_key(der, password=None)


def key_file_password() -> bytes:
    """Passphrase protecting key files written to disk by the local backend."""

    return fernet_key()


def write_encrypted_key_pem(key, password: bytes) -> bytes:
    return key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.BestAvailableEncryption(password),
    )


def load_key_pem(data: bytes, password: bytes | None):
    return serialization.load_pem_private_key(data, password=password or None)


def sign_payload(key, payload: bytes) -> bytes:
    return key.sign(payload, padding.PKCS1v15(), hashes.SHA256())


def verify_payload(cert: x509.Certificate, payload: bytes, signature: bytes) -> bool:
    try:
        cert.public_key().verify(signature, payload, padding.PKCS1v15(), hashes.SHA256())
    except Exception:
        return False
    return True
