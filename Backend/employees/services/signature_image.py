"""Deterministic clean-up of an uploaded signature image.

A signature is usually photographed on paper, so the raw upload carries the
sheet, the shadow across it, and a lot of empty margin. Embedding that straight
into a PDF puts a grey rectangle on the form. This module turns any accepted
upload into a tight, transparent PNG holding only the strokes.

The whole pipeline is fixed arithmetic over the pixels - no model, no service,
no network. A generic background remover is deliberately not used: those models
are trained on solid objects and routinely erase the thin, broken strokes that
make up a signature.

How the paper is removed
------------------------
The illumination across a photographed page is uneven, so a single global
threshold either keeps the shadow or eats the faint parts of the stroke.
Instead the paper itself is estimated and subtracted:

1. Shrink a copy and run a max filter over it. Taking the local maximum removes
   dark thin strokes while leaving the page, which yields the illumination
   field - the shadow included.
2. Scale that estimate back up, blur it smooth, and subtract it from the image.
   What survives is "how much darker than its own local paper" each pixel is,
   which is exactly the ink and is independent of the shadow gradient.
3. Map that ink density through a soft ramp to build the alpha channel, so
   antialiased stroke edges stay smooth instead of turning jagged.
4. Recover colour per channel the same way, which keeps a blue pen blue while a
   black pen stays black.

Anything that does not look like ink on paper is refused rather than guessed at.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from io import BytesIO

from PIL import Image, ImageChops, ImageFilter, ImageOps

logger = logging.getLogger(__name__)

# --- Input bounds -----------------------------------------------------------
#: Refuse absurd pixel counts before decoding the whole frame (decompression
#: bombs, and images too large to process in a request).
MAX_SOURCE_PIXELS = 40_000_000
#: Everything is processed at or below this dimension to bound memory and time.
WORK_MAX_DIM = 1600

# --- Paper estimation -------------------------------------------------------
#: The illumination field is estimated on a copy shrunk by this factor; a max
#: filter is cheap there and the field is low-frequency anyway.
BACKGROUND_SCALE = 8
#: Max-filter window on the shrunk copy. Must be odd. Large enough to swallow a
#: stroke at that scale, small enough to keep the shadow's shape.
BACKGROUND_MAX_FILTER = 5
#: Smooths the upscaled field so no blockiness leaks into the alpha channel.
BACKGROUND_BLUR_RADIUS = 3.0

# --- Ink detection ----------------------------------------------------------
#: Ink density (0-255) below this is paper grain and sensor noise: fully clear.
INK_LOW = 26
#: At or above this the pixel is solid stroke: fully opaque. Between the two the
#: alpha ramps linearly, which preserves antialiased edges and faint strokes.
INK_HIGH = 72
#: Alpha above this counts as a visible mark when measuring coverage.
ALPHA_VISIBLE = 32

# --- Sanity gates -----------------------------------------------------------
#: Median paper luminance must be at least this bright. A darker frame is not a
#: signature on paper, and "removing the background" from it would invent one.
MIN_BACKGROUND_LUMA = 110
#: Below this fraction of visible pixels there is nothing worth storing.
MIN_INK_FRACTION = 0.0005
#: Above this share of the frame, the marks are not a signature. Measured
#: against real inputs: a photograph of a person scores 0.19 and a page of ruled
#: lines far higher, while the densest legitimate signature tried - many
#: overlapping strokes filling the frame - reaches only 0.076.
MAX_INK_FRACTION = 0.14

# --- Stroke-shape gate ------------------------------------------------------
# Ink coverage alone does not catch a photograph of a solid object, which can
# be sparse yet obviously not handwriting. A signature is *thin*: erode it and
# almost nothing survives, whereas filled regions barely change. The mark is
# first scaled to a fixed probe size so this is independent of camera
# resolution.
#: Longest side the cropped mark is scaled to before erosion.
SOLID_PROBE_DIM = 400
#: Erosion window on the probe. Must be odd.
SOLID_ERODE = 5
#: Share of the mark that may survive erosion. A solid blob scores 0.75; the
#: thickest legitimate marker pen tried scores 0.37.
MAX_SOLID_SURVIVAL = 0.55

# --- Output -----------------------------------------------------------------
#: Padding kept around the cropped strokes, as a share of the longer side.
CROP_PADDING_RATIO = 0.02
CROP_PADDING_MIN = 4
#: A signature never needs more than this; keeps the stored PNG small.
OUTPUT_MAX_DIM = 1200
#: Progressive shrink steps used if the encoded PNG overshoots the size cap.
OUTPUT_SHRINK_STEPS = (0.8, 0.6, 0.45, 0.3)

NO_MARK_MESSAGE = (
    "No signature could be detected in this image. Sign in dark ink on plain "
    "paper, then upload a clear, well-lit photo or scan."
)
TOO_DARK_MESSAGE = (
    "The background of this image is too dark or too busy to separate from the "
    "signature. Use plain, light paper and even lighting."
)
NOT_A_SIGNATURE_MESSAGE = (
    "This image does not look like a handwritten signature. Upload a photo or "
    "scan of your signature on plain paper, not a photograph of a person, "
    "object, or document."
)
UNREADABLE_MESSAGE = "This image could not be read. Upload a valid PNG or JPG signature."


class SignatureImageError(ValueError):
    """The upload cannot be turned into a usable signature."""


@dataclass(frozen=True)
class NormalizedSignature:
    data: bytes
    width: int
    height: int
    ink_fraction: float


def _load(data: bytes) -> Image.Image:
    """Decode, apply EXIF orientation, and flatten onto white."""

    try:
        with Image.open(BytesIO(data)) as probe:
            width, height = probe.size
            if width * height > MAX_SOURCE_PIXELS:
                raise SignatureImageError("This image is too large to process. Upload a smaller photo.")
            probe.load()
            image = ImageOps.exif_transpose(probe) or probe
            image = image.copy()
    except SignatureImageError:
        raise
    except Exception as exc:  # Pillow raises a wide range for malformed files.
        raise SignatureImageError(UNREADABLE_MESSAGE) from exc

    if image.mode in {"RGBA", "LA", "PA"} or "transparency" in image.info:
        # An already-transparent upload is composited over white so the paper
        # path below sees the same thing a photograph would show.
        rgba = image.convert("RGBA")
        flattened = Image.new("RGB", rgba.size, (255, 255, 255))
        flattened.paste(rgba, mask=rgba.getchannel("A"))
        image = flattened
    else:
        image = image.convert("RGB")

    image.thumbnail((WORK_MAX_DIM, WORK_MAX_DIM), Image.LANCZOS)
    return image


def _paper_field(channel: Image.Image) -> Image.Image:
    """Estimate the local paper level of one channel, shadows included."""

    width, height = channel.size
    small = channel.resize(
        (max(1, width // BACKGROUND_SCALE), max(1, height // BACKGROUND_SCALE)),
        Image.LANCZOS,
    )
    # The local maximum keeps paper and discards dark strokes.
    small = small.filter(ImageFilter.MaxFilter(BACKGROUND_MAX_FILTER))
    field = small.resize((width, height), Image.LANCZOS)
    return field.filter(ImageFilter.GaussianBlur(BACKGROUND_BLUR_RADIUS))


def _median_luma(luma: Image.Image) -> int:
    histogram = luma.histogram()
    midpoint = sum(histogram) // 2
    running = 0
    for value, count in enumerate(histogram):
        running += count
        if running >= midpoint:
            return value
    return 255


def _alpha_from_ink(ink: Image.Image) -> Image.Image:
    span = max(INK_HIGH - INK_LOW, 1)

    def ramp(value: int) -> int:
        if value <= INK_LOW:
            return 0
        if value >= INK_HIGH:
            return 255
        return int((value - INK_LOW) * 255 / span)

    return ink.point(ramp)


def _solid_survival(mask: Image.Image, bbox: tuple[int, int, int, int]) -> float:
    """Share of the mark that survives erosion, at a resolution-free scale.

    Handwriting is thin, so eroding it removes nearly everything. A filled
    region - a face, an object, a dark patch - barely shrinks.
    """

    cropped = mask.crop(bbox)
    width, height = cropped.size
    scale = SOLID_PROBE_DIM / max(width, height, 1)
    probe = cropped.resize((max(1, int(width * scale)), max(1, int(height * scale))), Image.LANCZOS)
    probe = probe.point(lambda value: 255 if value > 127 else 0)
    area = probe.histogram()[255]
    if not area:
        return 0.0
    return probe.filter(ImageFilter.MinFilter(SOLID_ERODE)).histogram()[255] / area


def _visible_fraction(alpha: Image.Image) -> float:
    histogram = alpha.histogram()
    total = sum(histogram) or 1
    return sum(histogram[ALPHA_VISIBLE + 1 :]) / total


def _encode(image: Image.Image, size_limit: int) -> bytes:
    """Encode as PNG, shrinking only if the cap is exceeded."""

    for scale in (1.0, *OUTPUT_SHRINK_STEPS):
        candidate = image
        if scale != 1.0:
            candidate = image.resize(
                (max(1, int(image.width * scale)), max(1, int(image.height * scale))),
                Image.LANCZOS,
            )
        buffer = BytesIO()
        candidate.save(buffer, format="PNG", optimize=True)
        data = buffer.getvalue()
        if len(data) <= size_limit:
            return data
    raise SignatureImageError("This signature could not be compressed to an acceptable size.")


def normalize_signature(data: bytes, *, size_limit: int) -> NormalizedSignature:
    """Return a cropped, transparent PNG holding only the signature strokes.

    Raises :class:`SignatureImageError` when the image holds no usable mark or
    its background cannot be separated safely.
    """

    image = _load(data)
    luma = image.convert("L")

    paper = _paper_field(luma)
    if _median_luma(paper) < MIN_BACKGROUND_LUMA:
        raise SignatureImageError(TOO_DARK_MESSAGE)

    # How much darker than its own local paper each pixel is. Subtract clamps at
    # zero, so anything lighter than the paper simply drops out.
    ink = ImageChops.subtract(paper, luma)
    alpha = _alpha_from_ink(ink)

    fraction = _visible_fraction(alpha)
    if fraction < MIN_INK_FRACTION:
        raise SignatureImageError(NO_MARK_MESSAGE)
    if fraction > MAX_INK_FRACTION:
        # Far more of the frame is marked than any signature covers: a photo of
        # a person or object, or a page of printed or ruled lines.
        raise SignatureImageError(NOT_A_SIGNATURE_MESSAGE)

    mask = alpha.point(lambda value: 255 if value > ALPHA_VISIBLE else 0)
    bbox = mask.getbbox()
    if bbox is None:
        raise SignatureImageError(NO_MARK_MESSAGE)
    if _solid_survival(mask, bbox) > MAX_SOLID_SURVIVAL:
        # Sparse enough to pass the coverage gate, but made of filled regions
        # rather than strokes - handwriting does not survive erosion like this.
        raise SignatureImageError(NOT_A_SIGNATURE_MESSAGE)

    # Rebuild colour the same way, per channel, so the stroke keeps its hue
    # while the paper and its shadow flatten to white.
    channels = []
    for band in image.split():
        band_ink = ImageChops.subtract(_paper_field(band), band)
        channels.append(ImageChops.invert(band_ink))
    cleaned = Image.merge("RGB", channels)

    padding = max(CROP_PADDING_MIN, int(max(image.size) * CROP_PADDING_RATIO))
    left = max(0, bbox[0] - padding)
    top = max(0, bbox[1] - padding)
    right = min(image.width, bbox[2] + padding)
    bottom = min(image.height, bbox[3] + padding)

    result = Image.merge("RGBA", (*cleaned.split(), alpha)).crop((left, top, right, bottom))
    if max(result.size) > OUTPUT_MAX_DIM:
        result.thumbnail((OUTPUT_MAX_DIM, OUTPUT_MAX_DIM), Image.LANCZOS)

    encoded = _encode(result, size_limit)
    logger.info(
        "employee_signature.normalized",
        extra={"width": result.width, "height": result.height, "ink_fraction": round(fraction, 5)},
    )
    return NormalizedSignature(data=encoded, width=result.width, height=result.height, ink_fraction=fraction)
