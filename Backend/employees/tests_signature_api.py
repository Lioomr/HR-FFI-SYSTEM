"""Reusable employee signature: storage, upload API, permissions, and audit.

The rules these protect: only the owner may store a signature, it is validated
by magic bytes rather than by what the client claims, it never leaves private
storage except through an authenticated response, and every change is audited.
"""

from __future__ import annotations

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from audit.models import AuditLog
from employees.serializers import EMPLOYEE_SIGNATURE_MAX_SIZE

SIGNATURE_URL = "/employees/{}/signature"
PREVIEW_URL = "/employees/{}/signature/preview"


def draw_signature(
    image,
    *,
    ink=(24, 24, 32),
    width_ratio=0.7,
    stroke=None,
):
    """Draw a wavy stroke that behaves like a real signature under processing."""

    import math

    from PIL import ImageDraw

    draw = ImageDraw.Draw(image)
    w, h = image.size
    # Real handwriting keeps its stroke a small share of its own height,
    # whatever the capture resolution. A fixed pixel width would make small
    # fixtures look like fat blobs rather than signatures.
    if stroke is None:
        stroke = max(2, round(h * 0.022))
    left = int(w * (1 - width_ratio) / 2)
    right = w - left
    mid = h // 2
    amplitude = max(2, int(h * 0.22))
    points = []
    span = max(1, right - left)
    for x in range(left, right):
        t = (x - left) / span
        y = mid + int(amplitude * math.sin(t * 3.2 * math.pi))
        points.append((x, y))
    draw.line(points, fill=ink, width=stroke, joint="curve")
    return image


def signature_image(
    width: int = 400,
    height: int = 160,
    *,
    background=(255, 255, 255),
    ink=(24, 24, 32),
    width_ratio: float = 0.7,
):
    """A signature on plain paper, as a Pillow image."""

    from PIL import Image

    image = Image.new("RGB", (width, height), background)
    return draw_signature(image, ink=ink, width_ratio=width_ratio)


def png_bytes(width: int = 400, height: int = 160, *, ink=(24, 24, 32), background=(255, 255, 255)) -> bytes:
    """A valid PNG holding a signature on light paper.

    Uploads are normalized server-side now, so a fixture has to look like an
    actual signature: a flat block of colour is correctly refused.
    """

    from io import BytesIO

    buffer = BytesIO()
    signature_image(width, height, background=background, ink=ink).save(buffer, format="PNG")
    return buffer.getvalue()


def jpeg_bytes(width: int = 480, height: int = 200, *, shadow: bool = False, ink=(30, 40, 120)) -> bytes:
    """A JPEG that looks like a phone photo of a signed page."""

    from io import BytesIO

    from PIL import Image

    image = Image.new("RGB", (width, height), (246, 244, 238))
    if shadow:
        # A soft diagonal falloff, the way a hand or a lamp shades a page.
        pixels = image.load()
        for y in range(height):
            for x in range(width):
                r, g, b = pixels[x, y]
                falloff = int(60 * ((x / width) * 0.6 + (y / height) * 0.4))
                pixels[x, y] = (max(0, r - falloff), max(0, g - falloff), max(0, b - falloff))
    draw_signature(image, ink=ink)
    buffer = BytesIO()
    image.save(buffer, format="JPEG", quality=88)
    return buffer.getvalue()


#: A real JPEG signature, used wherever a JPG upload is exercised.
JPEG_BYTES = jpeg_bytes()


def upload(data: bytes, name: str = "signature.png", content_type: str = "image/png") -> SimpleUploadedFile:
    return SimpleUploadedFile(name, data, content_type=content_type)


def client_for(user, company_id):
    client = APIClient()
    client.force_authenticate(user)
    client.credentials(HTTP_X_ACTIVE_COMPANY_ID=str(company_id))
    return client


def owner_client(world):
    return client_for(world["users"]["owner"], world["company"].id)


# --------------------------------------------------------------------------
# Upload validation
# --------------------------------------------------------------------------


def test_owner_uploads_a_png_signature(world):
    response = owner_client(world).post(
        SIGNATURE_URL.format("me"), {"signature": upload(png_bytes())}, format="multipart", secure=True
    )

    assert response.status_code == 201
    payload = response.data["data"]
    assert payload["has_signature"] is True
    assert payload["content_type"] == "image/png"
    assert payload["size_bytes"] > 0
    assert payload["uploaded_at"]

    profile = world["users"]["owner"].employee_profile
    profile.refresh_from_db()
    assert profile.signature.name.startswith("employee_signatures/")
    assert profile.signature_uploaded_at is not None


def test_owner_uploads_a_jpeg_signature(world):
    response = owner_client(world).post(
        SIGNATURE_URL.format("me"),
        {"signature": upload(JPEG_BYTES, name="signature.jpg", content_type="image/jpeg")},
        format="multipart",
        secure=True,
    )

    assert response.status_code == 201
    # Every accepted upload is normalized, so a JPEG photo is stored as a
    # transparent PNG rather than kept as the raw camera frame.
    assert response.data["data"]["content_type"] == "image/png"


@pytest.mark.parametrize(
    ("data", "name", "content_type", "reason"),
    [
        (b"<svg xmlns='http://www.w3.org/2000/svg'/>", "sig.svg", "image/svg+xml", "svg is executable markup"),
        (b"%PDF-1.7\n%%EOF\n", "sig.pdf", "application/pdf", "pdf is not an image"),
        (b"MZ\x90\x00\x03", "sig.exe", "application/octet-stream", "executable"),
        (b"#!/bin/sh\necho hi\n", "sig.png", "image/png", "shell script wearing a png name"),
        (b"\xff\xd8\xff\xe0 not a png", "sig.png", "image/png", "jpeg magic under a png name"),
        (png_bytes(), "sig.png", "application/pdf", "content type contradicts the extension"),
    ],
)
def test_rejects_content_that_is_not_an_approved_image(world, data, name, content_type, reason):
    response = owner_client(world).post(
        SIGNATURE_URL.format("me"),
        {"signature": upload(data, name=name, content_type=content_type)},
        format="multipart",
        secure=True,
    )

    assert response.status_code == 422, reason
    assert any(item["field"] == "signature" for item in response.data["errors"])
    world["users"]["owner"].employee_profile.refresh_from_db()
    assert not world["users"]["owner"].employee_profile.signature


def test_rejects_an_empty_file(world):
    response = owner_client(world).post(
        SIGNATURE_URL.format("me"), {"signature": upload(b"", name="sig.png")}, format="multipart", secure=True
    )

    assert response.status_code == 422


def test_rejects_an_oversized_file(world):
    padded = png_bytes() + b"\x00" * (EMPLOYEE_SIGNATURE_MAX_SIZE + 1)

    response = owner_client(world).post(
        SIGNATURE_URL.format("me"), {"signature": upload(padded)}, format="multipart", secure=True
    )

    assert response.status_code == 422


def test_rejects_a_request_with_no_file(world):
    response = owner_client(world).post(SIGNATURE_URL.format("me"), {}, format="multipart", secure=True)

    assert response.status_code == 422


# --------------------------------------------------------------------------
# Replace and delete
# --------------------------------------------------------------------------


def test_replacing_a_signature_keeps_one_active_file(world):
    client = owner_client(world)
    client.post(SIGNATURE_URL.format("me"), {"signature": upload(png_bytes())}, format="multipart", secure=True)
    profile = world["users"]["owner"].employee_profile
    profile.refresh_from_db()
    first_name = profile.signature.name
    storage = profile.signature.storage

    response = client.post(
        SIGNATURE_URL.format("me"), {"signature": upload(png_bytes(360, 140))}, format="multipart", secure=True
    )

    assert response.status_code == 200
    profile.refresh_from_db()
    assert profile.signature.name != first_name
    assert profile.signature.storage.exists(profile.signature.name)
    assert not storage.exists(first_name), "the superseded private file must not be left behind"


def test_deleting_clears_the_signature_and_its_file(world):
    client = owner_client(world)
    client.post(SIGNATURE_URL.format("me"), {"signature": upload(png_bytes())}, format="multipart", secure=True)
    profile = world["users"]["owner"].employee_profile
    profile.refresh_from_db()
    stored_name, storage = profile.signature.name, profile.signature.storage

    response = client.delete(SIGNATURE_URL.format("me"), secure=True)

    assert response.status_code == 200
    assert response.data["data"]["has_signature"] is False
    profile.refresh_from_db()
    assert not profile.signature
    assert profile.signature_uploaded_at is None
    assert not storage.exists(stored_name)


def test_deleting_when_nothing_is_stored_is_a_404(world):
    assert owner_client(world).delete(SIGNATURE_URL.format("me"), secure=True).status_code == 404


def test_state_reads_cleanly_before_any_upload(world):
    response = owner_client(world).get(SIGNATURE_URL.format("me"), secure=True)

    assert response.status_code == 200
    assert response.data["data"] == {
        "has_signature": False,
        "uploaded_at": None,
        "content_type": None,
        "size_bytes": None,
        "preview_url": None,
    }


# --------------------------------------------------------------------------
# Preview response
# --------------------------------------------------------------------------


def test_preview_is_private_and_never_exposes_a_storage_path(world):
    client = owner_client(world)
    created = client.post(
        SIGNATURE_URL.format("me"), {"signature": upload(png_bytes())}, format="multipart", secure=True
    )
    profile = world["users"]["owner"].employee_profile
    profile.refresh_from_db()

    # The API advertises an authenticated route, not a file location.
    preview_url = created.data["data"]["preview_url"]
    assert preview_url == f"/employees/{profile.pk}/signature/preview"
    assert "private_uploads" not in str(created.data)
    assert profile.signature.name not in str(created.data)

    response = client.get(PREVIEW_URL.format("me"), secure=True)

    assert response.status_code == 200
    assert response["Content-Type"] == "image/png"
    assert response["Cache-Control"] == "private, no-store"
    assert response["X-Content-Type-Options"] == "nosniff"
    assert b"".join(response.streaming_content).startswith(b"\x89PNG")


def test_preview_is_404_when_nothing_is_stored(world):
    assert owner_client(world).get(PREVIEW_URL.format("me"), secure=True).status_code == 404


# --------------------------------------------------------------------------
# Permissions and company scope
# --------------------------------------------------------------------------


def test_anonymous_access_is_rejected(world):
    profile = world["users"]["owner"].employee_profile
    client = APIClient()

    assert client.get(SIGNATURE_URL.format(profile.pk), secure=True).status_code == 401
    assert (
        client.post(
            SIGNATURE_URL.format(profile.pk), {"signature": upload(png_bytes())}, format="multipart", secure=True
        ).status_code
        == 401
    )


def test_a_colleague_cannot_read_or_touch_another_employees_signature(world):
    profile = world["users"]["owner"].employee_profile
    client = client_for(world["users"]["colleague"], world["company"].id)

    assert client.get(SIGNATURE_URL.format(profile.pk), secure=True).status_code == 404
    assert client.get(PREVIEW_URL.format(profile.pk), secure=True).status_code == 404
    assert client.delete(SIGNATURE_URL.format(profile.pk), secure=True).status_code == 404
    assert (
        client.post(
            SIGNATURE_URL.format(profile.pk), {"signature": upload(png_bytes())}, format="multipart", secure=True
        ).status_code
        == 404
    )


def test_hr_may_read_and_delete_but_never_upload_on_someones_behalf(world):
    owner_client(world).post(
        SIGNATURE_URL.format("me"), {"signature": upload(png_bytes())}, format="multipart", secure=True
    )
    profile = world["users"]["owner"].employee_profile
    hr = client_for(world["users"]["hr"], world["company"].id)

    assert hr.get(SIGNATURE_URL.format(profile.pk), secure=True).data["data"]["has_signature"] is True
    assert hr.get(PREVIEW_URL.format(profile.pk), secure=True).status_code == 200

    forged = hr.post(
        SIGNATURE_URL.format(profile.pk), {"signature": upload(png_bytes())}, format="multipart", secure=True
    )
    assert forged.status_code == 403, "HR must not be able to store a signature in someone else's name"

    assert hr.delete(SIGNATURE_URL.format(profile.pk), secure=True).status_code == 200


def test_system_admin_follows_the_same_policy_as_hr(world):
    owner_client(world).post(
        SIGNATURE_URL.format("me"), {"signature": upload(png_bytes())}, format="multipart", secure=True
    )
    profile = world["users"]["owner"].employee_profile
    admin = client_for(world["users"]["admin"], world["company"].id)

    assert admin.get(SIGNATURE_URL.format(profile.pk), secure=True).status_code == 200
    assert (
        admin.post(
            SIGNATURE_URL.format(profile.pk), {"signature": upload(png_bytes())}, format="multipart", secure=True
        ).status_code
        == 403
    )


def test_hr_from_another_company_is_denied(world):
    owner_client(world).post(
        SIGNATURE_URL.format("me"), {"signature": upload(png_bytes())}, format="multipart", secure=True
    )
    profile = world["users"]["owner"].employee_profile
    foreign_hr = client_for(world["users"]["foreign_hr"], world["foreign"].id)

    assert foreign_hr.get(SIGNATURE_URL.format(profile.pk), secure=True).status_code == 404
    assert foreign_hr.get(PREVIEW_URL.format(profile.pk), secure=True).status_code == 404
    assert foreign_hr.delete(SIGNATURE_URL.format(profile.pk), secure=True).status_code == 404


def test_a_client_supplied_profile_id_cannot_redirect_the_upload(world):
    """POSTing to another id must never write to the caller's own row either."""

    colleague_profile = world["users"]["colleague"].employee_profile

    response = owner_client(world).post(
        SIGNATURE_URL.format(colleague_profile.pk),
        {"signature": upload(png_bytes())},
        format="multipart",
        secure=True,
    )

    assert response.status_code == 404
    colleague_profile.refresh_from_db()
    world["users"]["owner"].employee_profile.refresh_from_db()
    assert not colleague_profile.signature
    assert not world["users"]["owner"].employee_profile.signature


# --------------------------------------------------------------------------
# Audit
# --------------------------------------------------------------------------


def test_upload_replace_delete_and_preview_are_audited_without_sensitive_data(world):
    client = owner_client(world)
    profile = world["users"]["owner"].employee_profile

    client.post(SIGNATURE_URL.format("me"), {"signature": upload(png_bytes())}, format="multipart", secure=True)
    client.post(SIGNATURE_URL.format("me"), {"signature": upload(png_bytes(320, 130))}, format="multipart", secure=True)
    client.get(PREVIEW_URL.format("me"), secure=True)
    client.delete(SIGNATURE_URL.format("me"), secure=True)

    actions = list(
        AuditLog.objects.filter(action__startswith="employee_signature_")
        .order_by("id")
        .values_list("action", flat=True)
    )
    assert actions == [
        "employee_signature_uploaded",
        "employee_signature_replaced",
        "employee_signature_previewed",
        "employee_signature_deleted",
    ]

    uploaded = AuditLog.objects.get(action="employee_signature_uploaded")
    replaced = AuditLog.objects.get(action="employee_signature_replaced")
    assert uploaded.entity_id == str(profile.id)
    assert uploaded.metadata["company_id"] == world["company"].id
    assert uploaded.metadata["replaced"] is False
    assert replaced.metadata["replaced"] is True

    for row in AuditLog.objects.filter(action__startswith="employee_signature_"):
        serialised = str(row.metadata)
        assert "private_uploads" not in serialised
        assert "employee_signatures/" not in serialised
        assert "PNG" not in serialised
        assert set(row.metadata) <= {"employee_profile_id", "company_id", "replaced", "size_bytes"}
