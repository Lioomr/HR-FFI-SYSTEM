"""Unit tests for the shared signing pieces: name fallback, keys, KMS signer, validation."""

from __future__ import annotations

from io import BytesIO
from types import SimpleNamespace

import pytest
from cryptography.fernet import Fernet
from pypdf import PdfReader
from reportlab.pdfgen import canvas

from core.document_integrity import crypto
from core.document_integrity.backends import AwsKmsSigningBackend, simple_credential
from core.document_integrity.conf import SigningConfigurationError
from core.document_integrity.pdf_signing import SEAL_FIELD, sign_pdf
from core.document_integrity.validation import validate_pdf_bytes
from core.pdf_forms import SIGNATURE_NAME_FALLBACK, SIGNATURE_PLACED, load_form_assets, render_mapped_form
from core.pdf_signers import signer_signatures
from core.tests_pdf_forms import make_png
from core.tests_pdf_signers import _StoredFile, _user


def _leave_assets():
    return load_form_assets("leave_request_blank.pdf", "leave_request_blank_field_map.json")


def _blank_pdf() -> bytes:
    buffer = BytesIO()
    pdf = canvas.Canvas(buffer)
    pdf.drawString(72, 720, "Approved")
    pdf.showPage()
    pdf.save()
    return buffer.getvalue()


# --- name fallback ---------------------------------------------------------


def test_a_signer_without_an_image_resolves_to_their_profile_name():
    unsigned = _user(name="Account Name", email="who@ffi.test", profile=SimpleNamespace(full_name_en="Profile Name"))

    asset = signer_signatures({"hr_signature_image": unsigned})["hr_signature_image"]

    assert asset is not None and asset.name_fallback
    assert asset.signer_label == "Profile Name", "the profile is the source of truth for the name"
    assert asset.data == b""


def test_name_fallback_never_prints_an_email_address():
    unsigned = _user(name="", email="who@ffi.test", profile=SimpleNamespace(full_name_en=""))

    assert signer_signatures({"hr_signature_image": unsigned}) == {"hr_signature_image": None}


def test_a_stored_image_still_wins_over_the_name():
    signed = _user(profile=SimpleNamespace(full_name_en="Signed One", signature=_StoredFile(make_png())))

    asset = signer_signatures({"hr_signature_image": signed})["hr_signature_image"]

    assert asset is not None and not asset.name_fallback and asset.is_supported_image()


def test_renderer_prints_the_name_in_the_signature_box_and_reports_it():
    assets = _leave_assets()
    signatures = signer_signatures(
        {
            "employee_signature_image": _user(profile=SimpleNamespace(full_name_en="Fallback Fatima")),
            "hr_signature_image": None,
        }
    )

    pdf_bytes, diagnostics = render_mapped_form(assets, {"reference_no": "LR-1"}, signatures=signatures)

    states = {row["field"]: row["state"] for row in diagnostics}
    assert states["employee_signature_image"] == SIGNATURE_NAME_FALLBACK
    assert states["hr_signature_image"] == "missing"
    assert "Fallback Fatima" in (PdfReader(BytesIO(pdf_bytes)).pages[0].extract_text() or "")


def test_a_typed_name_twin_is_not_duplicated_by_the_fallback():
    assets = load_form_assets("loan_request_blank.pdf", "loan_request_blank_field_map.json")
    signatures = signer_signatures(
        {"manager_signature_image": _user(profile=SimpleNamespace(full_name_en="Twin Tariq"))}
    )

    pdf_bytes, diagnostics = render_mapped_form(assets, {"manager_signature": "Twin Tariq"}, signatures=signatures)

    assert {row["field"]: row["state"] for row in diagnostics}["manager_signature_image"] == SIGNATURE_NAME_FALLBACK
    assert (PdfReader(BytesIO(pdf_bytes)).pages[0].extract_text() or "").count("Twin Tariq") == 1


def test_real_images_are_still_reported_as_placed():
    assets = _leave_assets()
    signatures = signer_signatures(
        {
            "employee_signature_image": _user(
                profile=SimpleNamespace(full_name_en="X", signature=_StoredFile(make_png()))
            )
        }
    )

    _, diagnostics = render_mapped_form(assets, {}, signatures=signatures)

    assert diagnostics[0]["state"] == SIGNATURE_PLACED


# --- keys and at-rest encryption --------------------------------------------


def test_private_keys_round_trip_only_with_the_configured_key(settings):
    settings.DOCUMENT_SIGNING_KEY_ENCRYPTION_KEY = Fernet.generate_key().decode()
    key = crypto.generate_key()
    token = crypto.encrypt_private_key(key)

    assert b"PRIVATE KEY" not in token.encode()
    assert crypto.decrypt_private_key(token).private_numbers() == key.private_numbers()

    settings.DOCUMENT_SIGNING_KEY_ENCRYPTION_KEY = Fernet.generate_key().decode()
    with pytest.raises(SigningConfigurationError):
        crypto.decrypt_private_key(token)


def test_production_refuses_to_store_keys_without_an_encryption_key(settings):
    settings.DEBUG = False
    settings.DOCUMENT_SIGNING_DEV_AUTOGENERATE = False
    settings.DOCUMENT_SIGNING_KEY_ENCRYPTION_KEY = ""

    with pytest.raises(SigningConfigurationError):
        crypto.encrypt_private_key(crypto.generate_key())


# --- AWS KMS seal -----------------------------------------------------------


class _FakeKms:
    """Signs digests the way KMS does, with a key that never leaves this object."""

    def __init__(self, key):
        self._key = key
        self.calls = []

    def sign(self, *, KeyId, Message, MessageType, SigningAlgorithm):  # noqa: N803 - boto3 argument names
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.primitives.asymmetric import padding, utils

        self.calls.append((KeyId, MessageType, SigningAlgorithm))
        signature = self._key.sign(Message, padding.PKCS1v15(), utils.Prehashed(hashes.SHA256()))
        return {"Signature": signature}


@pytest.mark.django_db
def test_kms_backend_seals_without_holding_the_private_key(settings, tmp_path):
    key = crypto.generate_key()
    cert = crypto.build_certificate(
        subject=crypto.build_name("KMS Seal"), public_key=key.public_key(), issuer_cert=None, issuer_key=key, days=30
    )
    cert_path = tmp_path / "seal.pem"
    cert_path.write_text(crypto.cert_pem(cert))
    settings.DOCUMENT_SIGNING_BACKEND = "aws_kms"
    settings.DOCUMENT_SIGNING_KMS_KEY_ID = "alias/test-seal"
    settings.DOCUMENT_SIGNING_SEAL_CERT_PATH = str(cert_path)
    settings.DOCUMENT_SIGNING_SEAL_CHAIN_PATH = ""
    fake = _FakeKms(key)

    credential = AwsKmsSigningBackend(client=fake).seal_credential()
    signed = sign_pdf(_blank_pdf(), credential, field_name=SEAL_FIELD, reason="test")

    assert fake.calls == [("alias/test-seal", "DIGEST", "RSASSA_PKCS1_V1_5_SHA_256")]
    result = validate_pdf_bytes(signed)
    assert result["signature_count"] == 1
    assert result["signatures"][0]["valid"] is True
    assert result["signatures"][0]["trust"] == "unknown"


# --- validation -------------------------------------------------------------


@pytest.mark.django_db
def test_validation_handles_unsigned_and_unreadable_files(settings, tmp_path):
    settings.DOCUMENT_SIGNING_KEY_DIR = str(tmp_path)
    assert validate_pdf_bytes(_blank_pdf())["signature_count"] == 0
    assert validate_pdf_bytes(b"%PDF-1.7 garbage")["error"] == "unreadable_pdf"


@pytest.mark.django_db
def test_validation_reports_a_self_signed_seal_as_valid_but_untrusted(settings, tmp_path):
    settings.DOCUMENT_SIGNING_KEY_DIR = str(tmp_path)
    key = crypto.generate_key()
    cert = crypto.build_certificate(
        subject=crypto.build_name("Self Seal"), public_key=key.public_key(), issuer_cert=None, issuer_key=key, days=30
    )
    signed = sign_pdf(_blank_pdf(), simple_credential(key, cert, []), field_name=SEAL_FIELD, reason="t")

    row = validate_pdf_bytes(signed)["signatures"][0]
    tampered = validate_pdf_bytes(signed.replace(b"/Producer", b"/Producar", 1))

    assert row["is_seal"] and row["valid"] and row["trust"] == "unknown"
    assert row["signer_name"] == "Self Seal"
    assert tampered["all_valid"] is False
