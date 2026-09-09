"""Signature image normalization: paper removal, cropping, and refusals.

The contract: an accepted upload is stored as a tight transparent PNG holding
only the strokes, and anything that is not a signature on light paper is
refused with an actionable message rather than turned into a grey smudge.
"""

from __future__ import annotations

import math
from io import BytesIO

import pytest
from PIL import Image, ImageDraw

from employees.serializers import EMPLOYEE_SIGNATURE_MAX_SIZE
from employees.services.signature_image import (
    MAX_SOURCE_PIXELS,
    NO_MARK_MESSAGE,
    NOT_A_SIGNATURE_MESSAGE,
    TOO_DARK_MESSAGE,
    SignatureImageError,
    normalize_signature,
)
from employees.tests_signature_api import (
    PREVIEW_URL,
    SIGNATURE_URL,
    jpeg_bytes,
    owner_client,
    png_bytes,
    upload,
)


def normalize(data: bytes):
    return normalize_signature(data, size_limit=EMPLOYEE_SIGNATURE_MAX_SIZE)


def as_image(data: bytes) -> Image.Image:
    image = Image.open(BytesIO(data))
    image.load()
    return image


def encode(image: Image.Image, fmt: str = "PNG", **kwargs) -> bytes:
    buffer = BytesIO()
    image.save(buffer, format=fmt, **kwargs)
    return buffer.getvalue()


def stroke_on(image: Image.Image, ink, *, stroke: int = 4, inset: float = 0.2) -> Image.Image:
    draw = ImageDraw.Draw(image)
    w, h = image.size
    left, right = int(w * inset), int(w * (1 - inset))
    mid, amplitude = h // 2, max(2, int(h * 0.2))
    points = [
        (x, mid + int(amplitude * math.sin((x - left) / max(1, right - left) * 3.2 * math.pi)))
        for x in range(left, right)
    ]
    draw.line(points, fill=ink, width=stroke, joint="curve")
    return image


def opaque_ratio(image: Image.Image) -> float:
    alpha = image.getchannel("A")
    histogram = alpha.histogram()
    return sum(histogram[33:]) / (sum(histogram) or 1)


# --------------------------------------------------------------------------
# Paper removal
# --------------------------------------------------------------------------


def test_white_paper_becomes_transparent_outside_the_signature():
    result = normalize(png_bytes(400, 160))
    image = as_image(result.data)

    assert image.format == "PNG"
    assert image.mode == "RGBA"
    # The corners were paper; they must be fully clear.
    for corner in ((0, 0), (image.width - 1, 0), (0, image.height - 1), (image.width - 1, image.height - 1)):
        assert image.getpixel(corner)[3] == 0, f"paper left behind at {corner}"
    # The stroke is a minority of the frame but must be present.
    assert 0.005 < opaque_ratio(image) < 0.5


def test_phone_photo_with_shadow_and_cream_paper_is_cleaned():
    """A gradient across the page must not survive as a grey wash."""

    result = normalize(jpeg_bytes(480, 200, shadow=True))
    image = as_image(result.data)

    assert image.mode == "RGBA"
    assert image.getpixel((0, 0))[3] == 0
    assert image.getpixel((image.width - 1, image.height - 1))[3] == 0
    assert 0.005 < opaque_ratio(image) < 0.5


def test_black_and_blue_strokes_both_survive_with_their_colour():
    for ink, channel in (((20, 20, 20), None), ((25, 45, 170), "blue")):
        source = stroke_on(Image.new("RGB", (420, 170), (252, 251, 247)), ink)
        image = as_image(normalize(encode(source)).data)

        opaque = [
            image.getpixel((x, y))
            for x in range(0, image.width, 3)
            for y in range(0, image.height, 3)
            if image.getpixel((x, y))[3] > 200
        ]
        assert opaque, f"{ink} stroke was erased"
        darkest = min(opaque, key=lambda px: px[0] + px[1] + px[2])
        assert darkest[0] + darkest[1] + darkest[2] < 3 * 200, "stroke must stay dark, not washed out"
        if channel == "blue":
            assert darkest[2] > darkest[0], "a blue pen must stay blue"


def test_a_faint_stroke_is_kept_rather_than_thresholded_away():
    source = stroke_on(Image.new("RGB", (400, 160), (255, 255, 255)), (120, 120, 128), stroke=2)

    image = as_image(normalize(encode(source)).data)

    assert opaque_ratio(image) > 0.002, "a light pen must not be erased"


# --------------------------------------------------------------------------
# Geometry
# --------------------------------------------------------------------------


def test_empty_borders_are_cropped_with_a_small_margin():
    wide = Image.new("RGB", (1000, 600), (255, 255, 255))
    # A small stroke marooned in a large empty page.
    stroke_on(wide.crop((0, 0, 1000, 600)), (20, 20, 20))
    wide.paste(stroke_on(Image.new("RGB", (240, 90), (255, 255, 255)), (20, 20, 20)), (380, 255))

    result = normalize(encode(wide))

    assert result.width < 1000 and result.height < 600, "the empty page must be cropped away"
    assert result.width > 100, "the crop must keep the whole stroke plus padding"


def test_exif_orientation_is_applied_before_processing():
    portrait = stroke_on(Image.new("RGB", (200, 500), (255, 255, 255)), (20, 20, 20))
    exif = Image.Exif()
    exif[274] = 6  # rotate 90 CW on display
    rotated = encode(portrait, "JPEG", exif=exif, quality=92)

    upright = normalize(rotated)
    without_exif = normalize(encode(portrait, "JPEG", quality=92))

    # Honouring the tag turns the tall frame into a wide one.
    assert upright.width > upright.height
    assert without_exif.height > without_exif.width


def test_output_is_bounded_and_stays_under_the_upload_limit():
    big = stroke_on(Image.new("RGB", (3000, 1400), (255, 255, 255)), (20, 20, 20), stroke=12)

    result = normalize(encode(big))

    assert len(result.data) <= EMPLOYEE_SIGNATURE_MAX_SIZE
    assert max(as_image(result.data).size) <= 1200


# --------------------------------------------------------------------------
# Refusals
# --------------------------------------------------------------------------


def test_a_blank_page_is_refused_with_an_actionable_message():
    blank = encode(Image.new("RGB", (400, 160), (255, 255, 255)))

    with pytest.raises(SignatureImageError) as excinfo:
        normalize(blank)

    assert str(excinfo.value) == NO_MARK_MESSAGE
    assert "plain paper" in str(excinfo.value)


def test_a_near_blank_speck_is_refused():
    nearly = Image.new("RGB", (600, 300), (255, 255, 255))
    ImageDraw.Draw(nearly).point([(10, 10), (11, 11)], fill=(0, 0, 0))

    with pytest.raises(SignatureImageError):
        normalize(encode(nearly))


def test_a_dark_photo_is_refused_rather_than_cleaned():
    dark = stroke_on(Image.new("RGB", (400, 160), (28, 30, 34)), (240, 240, 240))

    with pytest.raises(SignatureImageError) as excinfo:
        normalize(encode(dark))

    assert str(excinfo.value) == TOO_DARK_MESSAGE


def test_a_busy_background_is_refused_rather_than_producing_a_smudge():
    busy = Image.new("RGB", (400, 200), (250, 250, 250))
    draw = ImageDraw.Draw(busy)
    for y in range(0, 200, 6):
        draw.rectangle([(0, y), (400, y + 3)], fill=(40, 40, 40))
    stroke_on(busy, (10, 10, 10))

    with pytest.raises(SignatureImageError) as excinfo:
        normalize(encode(busy))

    assert str(excinfo.value) == NOT_A_SIGNATURE_MESSAGE


def test_a_corrupt_image_is_refused():
    with pytest.raises(SignatureImageError):
        normalize(b"\x89PNG\r\n\x1a\nnot really a png")


def test_an_oversized_frame_is_refused_before_decoding():
    side = int(math.sqrt(MAX_SOURCE_PIXELS)) + 400
    huge = encode(Image.new("L", (side, side)))

    with pytest.raises(SignatureImageError) as excinfo:
        normalize(huge)

    assert "too large" in str(excinfo.value)


# --------------------------------------------------------------------------
# No outbound calls
# --------------------------------------------------------------------------


def test_normalization_makes_no_network_call(monkeypatch):
    import socket

    def forbidden(*args, **kwargs):
        raise AssertionError("signature normalization must not touch the network")

    monkeypatch.setattr(socket, "socket", forbidden)
    monkeypatch.setattr(socket, "create_connection", forbidden)

    assert normalize(png_bytes()).data.startswith(b"\x89PNG")


# --------------------------------------------------------------------------
# Through the API
# --------------------------------------------------------------------------


def test_uploaded_photo_is_stored_and_previewed_normalized(world):
    client = owner_client(world)

    created = client.post(
        SIGNATURE_URL.format("me"),
        {"signature": upload(jpeg_bytes(480, 200, shadow=True), name="photo.jpg", content_type="image/jpeg")},
        format="multipart",
        secure=True,
    )

    assert created.status_code == 201
    assert created.data["data"]["content_type"] == "image/png"

    profile = world["users"]["owner"].employee_profile
    profile.refresh_from_db()
    assert profile.signature.name.endswith(".png")

    preview = client.get(PREVIEW_URL.format("me"), secure=True)
    body = b"".join(preview.streaming_content)

    assert preview["Content-Type"] == "image/png"
    assert body.startswith(b"\x89PNG")
    stored = as_image(body)
    assert stored.mode == "RGBA"
    assert stored.getpixel((0, 0))[3] == 0, "the preview must show the cleaned image, not the raw photo"


def test_a_blank_upload_is_rejected_by_the_api(world):
    blank = encode(Image.new("RGB", (400, 160), (255, 255, 255)))

    response = owner_client(world).post(
        SIGNATURE_URL.format("me"), {"signature": upload(blank)}, format="multipart", secure=True
    )

    assert response.status_code == 422
    message = response.data["errors"][0]["message"]
    assert "No signature could be detected" in message
    world["users"]["owner"].employee_profile.refresh_from_db()
    assert not world["users"]["owner"].employee_profile.signature


def test_a_dark_upload_is_rejected_by_the_api(world):
    dark = encode(stroke_on(Image.new("RGB", (400, 160), (28, 30, 34)), (240, 240, 240)))

    response = owner_client(world).post(
        SIGNATURE_URL.format("me"), {"signature": upload(dark)}, format="multipart", secure=True
    )

    assert response.status_code == 422
    assert "too dark" in response.data["errors"][0]["message"]


def test_the_raw_upload_is_not_retained(world):
    """Only the normalized PNG is stored; the camera frame is not kept."""

    client = owner_client(world)
    raw = jpeg_bytes(480, 200, shadow=True)
    client.post(
        SIGNATURE_URL.format("me"),
        {"signature": upload(raw, name="photo.jpg", content_type="image/jpeg")},
        format="multipart",
        secure=True,
    )

    profile = world["users"]["owner"].employee_profile
    profile.refresh_from_db()
    stored = profile.signature.read()
    profile.signature.close()

    assert stored != raw
    assert stored.startswith(b"\x89PNG")
    assert not profile.signature.storage.exists("employee_signatures/photo.jpg")


# --------------------------------------------------------------------------
# Not-a-signature gates
#
# Regression for SIGNATURE-REAL-PHOTO-VALIDATION: a real phone photograph of a
# person was accepted and stored as an 840x1200 "signature". Coverage alone did
# not catch it, so the shape of the marks is checked too.
# --------------------------------------------------------------------------


def photograph_like(width: int = 700, height: int = 1000) -> Image.Image:
    """A printed portrait on a light page: the shape that used to slip through.

    Mid-tone regions covering a large share of a brightly bordered frame, which
    is what a phone photo of a person or an object looks like to the pipeline.
    """

    page = Image.new("RGB", (width, height), (250, 249, 246))
    draw = ImageDraw.Draw(page)
    margin = int(width * 0.08)
    draw.rectangle([(margin, margin), (width - margin, height - margin)], fill=(196, 178, 166))
    draw.ellipse(
        [(width * 0.24, height * 0.14), (width * 0.76, height * 0.52)],
        fill=(150, 122, 104),
    )
    draw.rectangle([(width * 0.16, height * 0.55), (width * 0.84, height - margin)], fill=(96, 46, 44))
    return page


def test_a_photograph_of_a_person_is_refused():
    """The confirmed real-photo failure, reproduced without shipping the photo."""

    with pytest.raises(SignatureImageError) as excinfo:
        normalize(encode(photograph_like()))

    assert str(excinfo.value) == NOT_A_SIGNATURE_MESSAGE


def test_a_sparse_solid_object_is_refused_by_the_stroke_shape_gate():
    """Sparse enough to pass the coverage gate, but not made of strokes."""

    blob = Image.new("RGB", (800, 600), (255, 255, 255))
    ImageDraw.Draw(blob).ellipse([(150, 100), (650, 500)], fill=(60, 60, 70))

    with pytest.raises(SignatureImageError) as excinfo:
        normalize(encode(blob))

    assert str(excinfo.value) == NOT_A_SIGNATURE_MESSAGE


def test_a_photographed_page_of_printed_text_is_refused():
    page = Image.new("RGB", (900, 600), (250, 249, 245))
    draw = ImageDraw.Draw(page)
    for row in range(14):
        y = 60 + row * 36
        x = 70
        while x < 830:
            word = 30 + (row * 7 + x) % 60
            draw.rectangle([(x, y), (min(830, x + word), y + 9)], fill=(45, 45, 50))
            x += word + 14

    with pytest.raises(SignatureImageError):
        normalize(encode(page))


# --- and the legitimate cases nearest those gates must still pass ----------


def test_a_thick_marker_signature_is_still_accepted():
    """Closest legitimate case to the stroke-shape gate."""

    thick = stroke_on(Image.new("RGB", (900, 340), (255, 255, 255)), (20, 20, 20), stroke=14)

    result = normalize(encode(thick))

    assert as_image(result.data).mode == "RGBA"
    assert result.ink_fraction < 0.14


def test_a_dense_multi_stroke_signature_is_still_accepted():
    """Closest legitimate case to the coverage gate."""

    dense = Image.new("RGB", (900, 340), (255, 255, 255))
    for index in range(6):
        stroke_on(dense, (20, 20, 20), stroke=5, inset=0.10 + index * 0.005)

    result = normalize(encode(dense))

    assert as_image(result.data).mode == "RGBA"


# --------------------------------------------------------------------------
# Real-world capture conditions
# --------------------------------------------------------------------------


def shaded_page(width: int, height: int, strength: int = 95) -> Image.Image:
    """A page with a strong diagonal illumination falloff."""

    page = Image.new("RGB", (width, height), (244, 241, 233))
    pixels = page.load()
    for y in range(height):
        for x in range(width):
            r, g, b = pixels[x, y]
            drop = int(strength * ((x / width) * 0.55 + (y / height) * 0.45))
            pixels[x, y] = (max(0, r - drop), max(0, g - drop), max(0, b - drop))
    return page


@pytest.mark.parametrize("angle", [7, 25])
def test_a_rotated_signature_is_still_accepted(angle):
    tilted = stroke_on(Image.new("RGB", (900, 340), (255, 255, 255)), (20, 20, 20), stroke=5).rotate(
        angle, expand=True, fillcolor=(255, 255, 255), resample=Image.BICUBIC
    )

    image = as_image(normalize(encode(tilted)).data)

    assert image.mode == "RGBA"
    assert opaque_ratio(image) > 0.002


def test_a_page_photographed_at_an_angle_is_still_accepted():
    page = stroke_on(shaded_page(1200, 620), (24, 30, 90), stroke=6)
    coeffs = (1.0, 0.16, -120.0, 0.05, 1.0, -18.0, 0.00016, 0.00006)
    skewed = page.transform((1200, 620), Image.PERSPECTIVE, coeffs, Image.BICUBIC, fillcolor=(252, 250, 245))

    image = as_image(normalize(encode(skewed, "JPEG", quality=85)).data)

    assert image.mode == "RGBA"
    assert image.getpixel((0, 0))[3] == 0


def test_heavy_jpeg_artefacts_do_not_break_paper_removal():
    noisy = stroke_on(shaded_page(900, 340), (20, 20, 20), stroke=5)

    image = as_image(normalize(encode(noisy, "JPEG", quality=40)).data)

    assert image.getpixel((0, 0))[3] == 0
    assert opaque_ratio(image) > 0.002


def test_a_light_blue_ballpoint_on_a_shaded_page_survives():
    """The reference project special-cases blue ink; per-channel subtraction
    already keeps it without a dedicated code path."""

    page = stroke_on(shaded_page(1200, 620), (95, 125, 205), stroke=5)

    image = as_image(normalize(encode(page, "JPEG", quality=75)).data)

    opaque = [
        image.getpixel((x, y))
        for x in range(0, image.width, 4)
        for y in range(0, image.height, 4)
        if image.getpixel((x, y))[3] > 180
    ]
    assert opaque, "a light blue ballpoint must not be erased"
    assert max(px[2] - px[0] for px in opaque) > 20, "it must still read as blue"
