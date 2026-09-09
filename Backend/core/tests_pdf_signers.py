"""Tests for resolving a request's signers into signature images.

The rule these protect: a signature may only come from the actor the workflow
recorded for that stage, and a stage nobody completed yields no signature at all.
"""

from __future__ import annotations

from types import SimpleNamespace

from django.core.files.base import ContentFile

from core.pdf_signers import display_name, signature_for_user, signer_signatures
from core.tests_pdf_forms import make_png


class _StoredFile:
    """Stands in for a Django FileField holding a stored signature."""

    def __init__(self, data: bytes, name: str = "signatures/private/emp-1.png"):
        self._file = ContentFile(data)
        self.name = name
        self.closed = False

    def open(self, mode="rb"):
        self._file.seek(0)
        return self

    def read(self, size=-1):
        return self._file.read(size)

    def close(self):
        self.closed = True


def _user(name="Manager One", email="manager@ffi.test", profile=None):
    return SimpleNamespace(full_name=name, email=email, employee_profile=profile)


def test_display_name_prefers_the_profile_english_name():
    profile = SimpleNamespace(full_name_en="Mariam Abdelrahman", full_name="مريم", full_name_ar="مريم")

    assert display_name(user=_user(profile=profile), profile=profile) == "Mariam Abdelrahman"


def test_display_name_falls_back_to_the_user_record():
    assert display_name(user=_user(name="", email="hr@ffi.test")) == "hr@ffi.test"


def test_stored_signature_is_returned_for_the_recorded_actor():
    profile = SimpleNamespace(full_name_en="Manager One", signature=_StoredFile(make_png()))

    asset = signature_for_user(_user(profile=profile))

    assert asset is not None
    assert asset.is_supported_image()
    assert asset.signer_label == "Manager One"


def test_signature_asset_never_carries_the_storage_path():
    """A private upload path must not travel with the image into logs or audit."""

    stored = _StoredFile(make_png(), name="private_uploads/signatures/secret-path.png")
    profile = SimpleNamespace(full_name_en="Manager One", signature=stored)

    asset = signature_for_user(_user(profile=profile))

    assert asset is not None
    assert not hasattr(asset, "path")
    assert "secret-path" not in asset.signer_label


def test_actor_without_stored_signature_yields_nothing():
    profile = SimpleNamespace(full_name_en="Manager One")

    assert signature_for_user(_user(profile=profile)) is None


def test_incomplete_stage_has_no_signer_at_all():
    """An outstanding stage must stay ``None`` - never the requesting user."""

    assert signer_signatures({"hr_signature_image": None}) == {"hr_signature_image": None}


def test_non_image_stored_file_is_rejected():
    profile = SimpleNamespace(full_name_en="Manager One", signature=_StoredFile(b"%PDF-1.7 not an image"))

    assert signature_for_user(_user(profile=profile)) is None


def test_user_without_a_profile_resolves_to_no_signature():
    class _NoProfile:
        full_name = "Contractor"
        email = "contractor@ffi.test"

        @property
        def employee_profile(self):
            raise AttributeError("no profile")

    assert signature_for_user(_NoProfile()) is None


def test_signer_map_resolves_each_slot_independently():
    signed = SimpleNamespace(full_name_en="HR One", signature=_StoredFile(make_png()))
    slots = {
        "hr_signature_image": _user(profile=signed),
        "ceo_signature_image": None,
    }

    resolved = signer_signatures(slots)

    assert resolved["hr_signature_image"] is not None
    assert resolved["ceo_signature_image"] is None
