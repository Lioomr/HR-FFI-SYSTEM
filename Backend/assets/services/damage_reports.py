"""State transitions for asset damage reports.

Only the CEO approval lives here so far: it is the final decision on the form and
the moment its PDF is frozen (``assets.document_integrity``). The checks and
messages are the ones ``CEOAssetDamageReportViewSet.approve`` always used.
"""

from __future__ import annotations

from django.db import transaction
from django.utils import timezone

from ..document_integrity import on_asset_damage_stage_approved
from ..models import AssetDamageReport

NOT_PENDING_CEO_MESSAGE = "Request is not pending CEO approval."


class AssetDamageTransitionError(Exception):
    """A refused damage-report transition (HTTP 422)."""


def approve_damage_report_by_ceo(report: AssetDamageReport, *, actor, comment: str = "") -> AssetDamageReport:
    """Approve a damage report pending CEO; freezes its PDF after the commit.

    The freeze runs on commit and never raises, so it can never undo the approval.
    """

    with transaction.atomic():
        locked = AssetDamageReport.objects.select_for_update().get(pk=report.pk)
        if locked.status != AssetDamageReport.RequestStatus.PENDING_CEO:
            raise AssetDamageTransitionError(NOT_PENDING_CEO_MESSAGE)
        locked.status = AssetDamageReport.RequestStatus.APPROVED
        locked.ceo_decision_by = actor
        locked.ceo_decision_at = timezone.now()
        locked.ceo_decision_note = comment or ""
        locked.save(update_fields=["status", "ceo_decision_by", "ceo_decision_at", "ceo_decision_note"])
        on_asset_damage_stage_approved(locked, role="ceo", actor=actor, at=locked.ceo_decision_at)
    return locked
