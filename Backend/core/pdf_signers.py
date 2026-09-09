"""Resolve who signed a request, and fetch that person's stored signature.

A signature only ever comes from the person the workflow actually recorded for
that stage - never from whoever happens to be downloading the PDF.  Callers pass
the recorded actor (``manager_decision_by``, ``hr_signer_user``, ``approved_by``,
...); this module turns it into a :class:`~core.pdf_forms.SignatureAsset` or
``None``.

Signatures come from ``EmployeeProfile.signature``, the single reusable image
each employee uploads for themselves.  A signer with nothing stored yields
``None``, the mapped box stays blank, and the renderer reports the gap.  This
module never invents a signature and never substitutes a different signer.
"""

from __future__ import annotations

import logging
from typing import Any

from core.pdf_forms import MAX_SIGNATURE_BYTES, SignatureAsset

logger = logging.getLogger(__name__)

#: The employee profile field holding the reusable signature image.
SIGNATURE_SOURCE_ATTRS = ("signature",)


def profile_for_user(user: Any) -> Any:
    """Return the signer's employee profile, or ``None`` when they have none."""

    if user is None:
        return None
    try:
        return user.employee_profile
    except Exception:
        return None


def display_name(user: Any = None, profile: Any = None) -> str:
    """Human name for a signer, preferring the profile's own English name."""

    profile = profile if profile is not None else profile_for_user(user)
    if profile is not None:
        for attr in ("full_name_en", "full_name", "full_name_ar"):
            value = str(getattr(profile, attr, "") or "").strip()
            if value:
                return value
    if user is None:
        return ""
    return str(getattr(user, "full_name", "") or getattr(user, "email", "") or "").strip()


def _read_signature_file(handle: Any) -> bytes | None:
    """Read at most ``MAX_SIGNATURE_BYTES`` from a Django file field."""

    if handle is None or not getattr(handle, "name", ""):
        return None
    try:
        handle.open("rb")
    except Exception:
        # Some storages hand back an already-open file object.
        pass
    try:
        data = handle.read(MAX_SIGNATURE_BYTES + 1)
    except Exception:
        return None
    finally:
        try:
            handle.close()
        except Exception:
            pass
    if not data or len(data) > MAX_SIGNATURE_BYTES:
        return None
    return bytes(data)


def signature_for_profile(profile: Any, *, label: str = "") -> SignatureAsset | None:
    """Return the profile's stored reusable signature, or ``None``."""

    if profile is None:
        return None
    for attr in SIGNATURE_SOURCE_ATTRS:
        data = _read_signature_file(getattr(profile, attr, None))
        if not data:
            continue
        asset = SignatureAsset(data=data, signer_label=label or display_name(profile=profile))
        if asset.is_supported_image():
            return asset
        logger.warning(
            "pdf_signature.unsupported_format",
            extra={"attribute": attr, "profile_id": str(getattr(profile, "pk", "") or "")},
        )
    return None


def signature_for_user(user: Any) -> SignatureAsset | None:
    """Return the recorded actor's stored signature, or ``None`` when absent.

    Returning ``None`` is the correct outcome for an unsigned stage: the caller
    leaves the mapped box blank and the renderer records the missing state.
    """

    if user is None:
        return None
    profile = profile_for_user(user)
    return signature_for_profile(profile, label=display_name(user=user, profile=profile))


def signature_for_signer(signer: Any) -> SignatureAsset | None:
    """Resolve a signer given either a user account or an employee profile."""

    if signer is None:
        return None
    if any(hasattr(signer, attr) for attr in SIGNATURE_SOURCE_ATTRS):
        return signature_for_profile(signer, label=display_name(profile=signer))
    return signature_for_user(signer)


def signer_signatures(slots: dict[str, Any]) -> dict[str, SignatureAsset | None]:
    """Map ``{map_field_name: recorded_signer}`` onto signature assets.

    Slots whose signer is ``None`` - a stage nobody has completed - stay in the
    result as ``None`` so the renderer reports them as missing rather than
    quietly dropping them.
    """

    return {field: signature_for_signer(signer) for field, signer in slots.items()}
