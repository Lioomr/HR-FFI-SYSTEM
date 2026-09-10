"""Regression for BACKEND-SIGNATURE-UPLOAD-500.

``EmployeeProfile.save()`` calls ``clean()`` unconditionally, so a profile whose
``manager_profile`` points at an employee with no linked user account cannot be
saved at all. The signature endpoint used ``save(update_fields=["signature",
...])`` and inherited that failure as an HTTP 500, even though the write touched
nothing to do with managers.

These tests pin both halves of the contract: a signature write succeeds over
stale manager data, and manager validation is still enforced for real profile
edits.
"""

from __future__ import annotations

import pytest
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.files.uploadedfile import SimpleUploadedFile

from audit.models import AuditLog
from employees.models import EmployeeProfile
from employees.services.signature import clear_signature, store_signature
from employees.tests_signature_api import (
    EMPLOYEE_SIGNATURE_MAX_SIZE,
    PREVIEW_URL,
    SIGNATURE_URL,
    client_for,
    owner_client,
    png_bytes,
    upload,
)


def attach_stale_manager(profile):
    """Point ``profile`` at a manager with no linked user, bypassing validation.

    This is how the data reaches production: the assignment was valid when made
    and the manager's user account was unlinked afterwards.
    """

    manager = EmployeeProfile.objects.create(
        company=profile.company,
        employee_id=f"STALE-MGR-{profile.pk}",
        full_name="Stale Manager",
    )
    assert manager.user_id is None
    EmployeeProfile.objects.filter(pk=profile.pk).update(manager_profile=manager, manager=None)
    profile.refresh_from_db()
    return manager


# --------------------------------------------------------------------------
# The failure, and that it is gone
# --------------------------------------------------------------------------


def test_the_stale_manager_really_does_block_a_full_profile_save(world):
    """Documents the root cause that produced the 500."""

    profile = world["users"]["owner"].employee_profile
    attach_stale_manager(profile)

    with pytest.raises(DjangoValidationError) as excinfo:
        profile.save(update_fields=["signature", "signature_uploaded_at", "updated_at"])

    assert "manager_profile" in excinfo.value.message_dict
    assert "linked to a user account" in excinfo.value.message_dict["manager_profile"][0]


def test_owner_can_upload_despite_an_unrelated_stale_manager(world):
    profile = world["users"]["owner"].employee_profile
    attach_stale_manager(profile)

    response = owner_client(world).post(
        SIGNATURE_URL.format("me"), {"signature": upload(png_bytes())}, format="multipart", secure=True
    )

    assert response.status_code == 201, response.data
    profile.refresh_from_db()
    assert profile.signature.name.startswith("employee_signatures/")
    assert profile.signature_uploaded_at is not None
    # The stale relationship is left exactly as it was: this fix stores a
    # signature, it does not quietly repair employment data.
    assert profile.manager_profile_id is not None


def test_replacement_and_delete_also_work_despite_a_stale_manager(world):
    client = owner_client(world)
    profile = world["users"]["owner"].employee_profile
    attach_stale_manager(profile)

    client.post(SIGNATURE_URL.format("me"), {"signature": upload(png_bytes())}, format="multipart", secure=True)
    profile.refresh_from_db()
    first_name, storage = profile.signature.name, profile.signature.storage

    replaced = client.post(
        SIGNATURE_URL.format("me"), {"signature": upload(png_bytes(360, 140))}, format="multipart", secure=True
    )

    assert replaced.status_code == 200
    profile.refresh_from_db()
    assert profile.signature.name != first_name
    assert not storage.exists(first_name), "the superseded file must be removed"

    second_name = profile.signature.name
    assert client.delete(SIGNATURE_URL.format("me"), secure=True).status_code == 200
    profile.refresh_from_db()
    assert not profile.signature
    assert not storage.exists(second_name)


def test_preview_works_despite_a_stale_manager(world):
    client = owner_client(world)
    profile = world["users"]["owner"].employee_profile
    attach_stale_manager(profile)
    client.post(SIGNATURE_URL.format("me"), {"signature": upload(png_bytes())}, format="multipart", secure=True)

    response = client.get(PREVIEW_URL.format("me"), secure=True)

    assert response.status_code == 200
    assert response["Cache-Control"] == "private, no-store"


# --------------------------------------------------------------------------
# Nothing else was weakened
# --------------------------------------------------------------------------


def test_a_stale_manager_still_blocks_a_real_profile_edit(world):
    """The fix is scoped to signatures; manager validation stays enforced."""

    profile = world["users"]["owner"].employee_profile
    attach_stale_manager(profile)
    profile.full_name = "Renamed Person"

    with pytest.raises(DjangoValidationError) as excinfo:
        profile.save()

    assert "manager_profile" in excinfo.value.message_dict


def test_assigning_a_manager_without_a_user_is_still_refused(world):
    """The validation itself is untouched for the case it exists to catch."""

    profile = world["users"]["owner"].employee_profile
    manager = EmployeeProfile.objects.create(
        company=profile.company, employee_id="NEW-STALE-MGR", full_name="No Account"
    )
    profile.manager_profile = manager

    with pytest.raises(DjangoValidationError):
        profile.save()


def test_uploading_for_someone_else_is_still_forbidden(world):
    """The narrow write path must not become an authorization bypass."""

    target = world["users"]["colleague"].employee_profile
    attach_stale_manager(target)
    hr = client_for(world["users"]["hr"], world["company"].id)

    response = hr.post(
        SIGNATURE_URL.format(target.pk), {"signature": upload(png_bytes())}, format="multipart", secure=True
    )

    assert response.status_code == 403
    target.refresh_from_db()
    assert not target.signature


def test_cross_company_access_is_still_denied(world):
    profile = world["users"]["owner"].employee_profile
    attach_stale_manager(profile)
    foreign_hr = client_for(world["users"]["foreign_hr"], world["foreign"].id)

    assert foreign_hr.get(SIGNATURE_URL.format(profile.pk), secure=True).status_code == 404
    assert foreign_hr.delete(SIGNATURE_URL.format(profile.pk), secure=True).status_code == 404
    assert (
        foreign_hr.post(
            SIGNATURE_URL.format(profile.pk), {"signature": upload(png_bytes())}, format="multipart", secure=True
        ).status_code
        == 404
    )


def test_anonymous_access_is_still_rejected(world):
    from rest_framework.test import APIClient

    profile = world["users"]["owner"].employee_profile
    attach_stale_manager(profile)

    assert (
        APIClient()
        .post(SIGNATURE_URL.format(profile.pk), {"signature": upload(png_bytes())}, format="multipart", secure=True)
        .status_code
        == 401
    )


def test_upload_with_a_stale_manager_is_still_audited(world):
    profile = world["users"]["owner"].employee_profile
    attach_stale_manager(profile)

    owner_client(world).post(
        SIGNATURE_URL.format("me"), {"signature": upload(png_bytes())}, format="multipart", secure=True
    )

    row = AuditLog.objects.get(action="employee_signature_uploaded")
    assert row.entity_id == str(profile.id)
    assert row.metadata["company_id"] == world["company"].id
    assert row.metadata["replaced"] is False
    assert set(row.metadata) <= {"employee_profile_id", "company_id", "replaced", "size_bytes"}


@pytest.mark.parametrize(
    ("payload_kind", "name", "content_type"),
    [
        ("svg", "sig.svg", "image/svg+xml"),
        ("pdf", "sig.pdf", "application/pdf"),
        ("empty", "sig.png", "image/png"),
        ("script", "sig.png", "image/png"),
        ("mismatched_type", "sig.png", "application/pdf"),
        ("oversized", "sig.png", "image/png"),
    ],
)
def test_file_validation_is_still_enforced(world, payload_kind, name, content_type):
    profile = world["users"]["owner"].employee_profile
    attach_stale_manager(profile)
    payloads = {
        "svg": b"<svg xmlns='http://www.w3.org/2000/svg'/>",
        "pdf": b"%PDF-1.7\n%%EOF\n",
        "empty": b"",
        "script": b"#!/bin/sh\necho hi\n",
        "mismatched_type": png_bytes(),
        "oversized": png_bytes() + b"\x00" * (EMPLOYEE_SIGNATURE_MAX_SIZE + 1),
    }

    response = owner_client(world).post(
        SIGNATURE_URL.format("me"),
        {"signature": upload(payloads[payload_kind], name=name, content_type=content_type)},
        format="multipart",
        secure=True,
    )

    assert response.status_code == 422
    profile.refresh_from_db()
    assert not profile.signature


# --------------------------------------------------------------------------
# Storage integrity when the row write fails
# --------------------------------------------------------------------------


def _break_row_update(monkeypatch):
    def explode(_profile):
        raise RuntimeError("database is down")

    monkeypatch.setattr("employees.services.signature._profile_rows", explode)


def test_a_failed_row_update_leaves_no_orphaned_file(world, monkeypatch):
    profile = world["users"]["owner"].employee_profile
    storage = EmployeeProfile._meta.get_field("signature").storage
    written = []
    real_save = storage.save

    def spy_save(name, content, max_length=None):
        stored = real_save(name, content, max_length)
        written.append(stored)
        return stored

    monkeypatch.setattr(storage, "save", spy_save)
    _break_row_update(monkeypatch)

    with pytest.raises(RuntimeError):
        store_signature(profile, SimpleUploadedFile("boom.png", png_bytes(), content_type="image/png"))

    assert written, "the file is written before the row update, so this path matters"
    assert not storage.exists(written[0]), "a failed row update must not leave the file behind"
    profile.refresh_from_db()
    assert not profile.signature


def test_the_previous_signature_survives_a_failed_replacement(world, monkeypatch):
    client = owner_client(world)
    client.post(SIGNATURE_URL.format("me"), {"signature": upload(png_bytes())}, format="multipart", secure=True)
    profile = world["users"]["owner"].employee_profile
    profile.refresh_from_db()
    original_name, storage = profile.signature.name, profile.signature.storage

    _break_row_update(monkeypatch)

    with pytest.raises(RuntimeError):
        store_signature(profile, SimpleUploadedFile("new.png", png_bytes(330, 120), content_type="image/png"))

    assert storage.exists(original_name), "a failed replacement must not destroy the stored signature"
    profile.refresh_from_db()
    assert profile.signature.name == original_name


def test_a_vanished_profile_row_leaves_no_orphaned_file(world):
    profile = world["users"]["owner"].employee_profile
    storage = EmployeeProfile._meta.get_field("signature").storage
    before = set(storage.listdir("employee_signatures")[1]) if storage.exists("employee_signatures") else set()
    EmployeeProfile.objects.filter(pk=profile.pk).delete()

    with pytest.raises(EmployeeProfile.DoesNotExist):
        store_signature(profile, SimpleUploadedFile("gone.png", png_bytes(), content_type="image/png"))

    after = set(storage.listdir("employee_signatures")[1]) if storage.exists("employee_signatures") else set()
    assert after == before, "no file may be left behind when the row is gone"


def test_clear_signature_touches_only_the_signature_columns(world):
    client = owner_client(world)
    client.post(SIGNATURE_URL.format("me"), {"signature": upload(png_bytes())}, format="multipart", secure=True)
    profile = world["users"]["owner"].employee_profile
    profile.refresh_from_db()
    attach_stale_manager(profile)
    full_name, manager_id = profile.full_name, profile.manager_profile_id

    clear_signature(profile)

    profile.refresh_from_db()
    assert not profile.signature
    assert profile.signature_uploaded_at is None
    assert profile.full_name == full_name
    assert profile.manager_profile_id == manager_id
