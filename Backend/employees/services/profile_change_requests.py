"""Employee-requested profile changes, applied item by item only after HR decides.

An employee asks for one or more changes (personal details, passport and national
ID data, and new passport / ID scans) in ONE request. Uploaded scans are read by
the existing OCR pipeline and offered as suggestions only. Nothing reaches the
profile, the login account, or the document archive until an HR approver
(HRManager, SystemAdmin, or an active HR delegate; never the requester) decides
every item in one call. The shared workflow engine sees a single APPROVE (all or
some items approved) or REJECT (none approved) action, recorded as it happens.
Notifications run after commit and can never undo a decision.
"""

from __future__ import annotations

import logging
import os
import re
from collections.abc import Callable
from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.contrib.auth.base_user import BaseUserManager
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.files.base import ContentFile
from django.core.validators import validate_email
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone

from audit.utils import audit
from core.delegation import is_user_approver_for_role
from core.models import WorkflowAction
from core.responses import error
from core.services import get_hr_approver_users, notify_profile_request_status_whatsapp, notify_users_for_pending_status
from core.services.workflow_engine import begin_recorded_transition, record_workflow_transition

from ..models import EmployeeDocument, EmployeeProfile, ProfileChangeAttachment, ProfileChangeRequest
from ..ocr.parsers import normalize_digits, parse_date
from .document_jobs import queue_document_extraction

logger = logging.getLogger(__name__)

Status = ProfileChangeRequest.Status
DocumentType = ProfileChangeAttachment.DocumentType
ExtractionStatus = EmployeeDocument.ExtractionStatus

REQUEST_TYPE = "Profile Change Request"
HR_ACTION_PATH = "/hr/employees/profile-change-requests"
EMPLOYEE_ACTION_PATH = "/employee/profile"

# Whitelist, in display order. value kind -> how it is normalized and validated.
TEXT, DATE, EMAIL, MOBILE, PASSPORT_NO, NATIONAL_ID = "text", "date", "email", "mobile", "passport_no", "national_id"
FIELD_KINDS = {
    "full_name": TEXT,
    "date_of_birth": DATE,
    "nationality": TEXT,
    "email": EMAIL,
    "mobile": MOBILE,
    "passport_no": PASSPORT_NO,
    "passport_issue_date": DATE,
    "passport_expiry": DATE,
    "national_id": NATIONAL_ID,
    "id_expiry": DATE,
}
# field -> (profile attribute, sibling attributes set to the same value, raw attributes cleared).
PROFILE_TARGETS = {
    "full_name": ("full_name", ("full_name_en",), ()),
    "date_of_birth": ("date_of_birth", (), ("date_of_birth_raw",)),
    "nationality": ("nationality", ("nationality_en",), ()),
    "mobile": ("mobile", (), ()),
    "passport_no": ("passport_no", (), ()),
    "passport_issue_date": ("passport_issue_date", (), ()),
    "passport_expiry": ("passport_expiry", (), ("passport_expiry_raw",)),
    "national_id": ("national_id", (), ()),
    "id_expiry": ("id_expiry", (), ("id_expiry_raw",)),
}
TEXT_LIMITS = {"full_name": (2, 255), "nationality": (2, 100)}
NOT_IN_FUTURE = {"date_of_birth", "passport_issue_date"}
FILE_FIELDS = {DocumentType.PASSPORT: "passport_file", DocumentType.SAUDI_ID: "national_id_file"}
FILE_EXPIRY_FIELD = {DocumentType.PASSPORT: "passport_expiry", DocumentType.SAUDI_ID: "id_expiry"}
ALL_FIELDS = (*FIELD_KINDS, *FILE_FIELDS.values())
FIELD_LABELS = {
    "full_name": "Full name",
    "date_of_birth": "Date of birth",
    "nationality": "Nationality",
    "email": "Email",
    "mobile": "Mobile",
    "passport_no": "Passport number",
    "passport_issue_date": "Passport issue date",
    "passport_expiry": "Passport expiry",
    "national_id": "National ID number",
    "id_expiry": "National ID expiry",
    "passport_file": "Passport copy",
    "national_id_file": "National ID copy",
}
# OCR parser key -> whitelist field, per document type.
OCR_FIELD_MAP = {
    DocumentType.PASSPORT: {
        "passport_number": "passport_no",
        "full_name": "full_name",
        "nationality": "nationality",
        "date_of_birth": "date_of_birth",
        "issue_date": "passport_issue_date",
        "expiry_date": "passport_expiry",
    },
    DocumentType.SAUDI_ID: {
        "iqama_number": "national_id",
        "iqama_expiry_date": "id_expiry",
    },
}
TERMINAL_EXTRACTION = {ExtractionStatus.SUCCESS, ExtractionStatus.PARTIAL, ExtractionStatus.FAILED}
MAX_UNUSED_ATTACHMENTS = 10
UNUSED_ATTACHMENT_TTL = timedelta(hours=24)
APPROVE, REJECT = "approve", "reject"
_ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_MOBILE = re.compile(r"^\+?[0-9 ()\-]+$")
_PASSPORT_NO = re.compile(r"^[A-Z0-9]{5,20}$")
_NATIONAL_ID = re.compile(r"^\d{10}$")

NOT_CHANGEABLE_MESSAGE = "This field cannot be changed."
FILE_IN_ITEMS_MESSAGE = "Upload the file as an attachment instead."
EMPTY_MESSAGE = "This field cannot be empty."
EMAIL_TAKEN_MESSAGE = "This email is already used by another account."
EMAIL_TAKEN_AT_APPROVAL_MESSAGE = "This email is now used by another account. Reject this item."
NOTHING_TO_CHANGE_MESSAGE = "Change at least one detail or attach a document."
ALREADY_PENDING_MESSAGE = "You already have a change request waiting for HR."
ATTACHMENT_INVALID_MESSAGE = "One or more attachments are not available. Upload them again."
ATTACHMENT_DUPLICATE_TYPE_MESSAGE = "Attach at most one passport and one national ID."
TOO_MANY_UPLOADS_MESSAGE = "Too many unused uploads. Submit or wait before uploading again."
NOT_PENDING_MESSAGE = "This request is no longer pending HR review."
NOTE_REQUIRED_MESSAGE = "A rejection reason is required."
SELF_DECISION_MESSAGE = "You cannot decide your own profile change request."
NOT_HR_MESSAGE = "Only HR workflow approvers can decide profile change requests."
NOT_OWNER_MESSAGE = "Only the requester can cancel this request."
COMPANY_CHANGED_MESSAGE = "The employee has moved to another company. Reject this request and ask for a new one."
FILE_MISSING_MESSAGE = "An uploaded file is missing from storage. Reject that item and ask for a new upload."


class ProfileChangeError(Exception):
    """A refused action, carrying its HTTP status and the per-field errors."""

    def __init__(self, message: str, *, status: int = 422, field: str | None = None, errors: dict | None = None):
        super().__init__(message)
        self.message = message
        self.status = status
        self.errors = errors or {field or "non_field_errors": [message]}

    def to_response(self):
        if self.status == 422:
            return error("Validation error", errors=self.errors, status=422)
        return error(self.message, errors=[self.message], status=self.status)


def _fail(errors: dict) -> ProfileChangeError:
    first = next(iter(errors.values()))[0]
    return ProfileChangeError(first, errors=errors)


# ---------------------------------------------------------------------------
# Values
# ---------------------------------------------------------------------------


def current_value(profile: EmployeeProfile, field: str) -> str:
    """The live profile value of a whitelist field, as a string ('' when empty)."""

    if field == "email":
        return (getattr(profile.user, "email", "") or "") if profile.user_id else ""
    value = getattr(profile, PROFILE_TARGETS[field][0])
    if isinstance(value, date):
        return value.isoformat()
    return str(value or "")


def normalize_value(field: str, raw) -> str:
    """Normalize one submitted value; '' means blank. Raises ``ValueError`` with a user message."""

    if not isinstance(raw, str):
        raise ValueError("Enter a text value.")
    kind = FIELD_KINDS[field]
    value = " ".join(raw.split())
    if not value:
        return ""
    if kind == TEXT:
        low, high = TEXT_LIMITS[field]
        if not low <= len(value) <= high:
            raise ValueError(f"Enter between {low} and {high} characters.")
        return value
    if kind == DATE:
        parsed = None
        if _ISO_DATE.match(value):
            try:
                parsed = date.fromisoformat(value)
            except ValueError:
                parsed = None
        if parsed is None or parsed.year < 1900:
            raise ValueError("Enter a valid date as YYYY-MM-DD.")
        if field in NOT_IN_FUTURE and parsed > timezone.localdate():
            raise ValueError("This date cannot be in the future.")
        return parsed.isoformat()
    if kind == EMAIL:
        if len(value) > 254:
            raise ValueError("Enter a valid email address.")
        try:
            validate_email(value)
        except DjangoValidationError:
            raise ValueError("Enter a valid email address.") from None
        return BaseUserManager.normalize_email(value)
    if kind == MOBILE:
        digits = re.sub(r"\D", "", value)
        if not _MOBILE.match(value) or not 7 <= len(digits) <= 20:
            raise ValueError("Enter a valid mobile number.")
        return value
    if kind == PASSPORT_NO:
        value = re.sub(r"\s+", "", value).upper()
        if not _PASSPORT_NO.match(value):
            raise ValueError("Enter 5 to 20 letters or digits.")
        return value
    # NATIONAL_ID
    value = re.sub(r"[\s-]+", "", normalize_digits(value))
    if not _NATIONAL_ID.match(value):
        raise ValueError("Enter the 10-digit ID number.")
    return value


def _same(field: str, new: str, old: str) -> bool:
    if field == "email":
        return new.lower() == old.lower()
    return new == old


def _email_taken(email: str, *, exclude_user_id) -> bool:
    return get_user_model().objects.filter(email__iexact=email).exclude(pk=exclude_user_id).exists()


def ocr_values(attachment: ProfileChangeAttachment) -> dict[str, str]:
    """Normalized whitelist values read from a finished attachment (unfiltered)."""

    if attachment.extraction_status not in {ExtractionStatus.SUCCESS, ExtractionStatus.PARTIAL}:
        return {}
    extracted = attachment.extracted_fields if isinstance(attachment.extracted_fields, dict) else {}
    values = {}
    for parser_key, field in OCR_FIELD_MAP.get(attachment.document_type, {}).items():
        raw = str(extracted.get(parser_key) or "").strip()
        if not raw:
            continue
        if FIELD_KINDS[field] == DATE:
            parsed = parse_date(raw)
            raw = parsed.isoformat() if parsed else ""
            if not raw:
                continue
        try:
            value = normalize_value(field, raw)
        except ValueError:
            continue
        if value:
            values[field] = value
    return values


def suggested_values(attachment: ProfileChangeAttachment) -> dict[str, str]:
    """OCR values that differ from the current profile: what the form should pre-fill."""

    profile = attachment.employee_profile
    return {
        field: value
        for field, value in ocr_values(attachment).items()
        if not _same(field, value, current_value(profile, field))
    }


# ---------------------------------------------------------------------------
# Access
# ---------------------------------------------------------------------------


def is_hr_approver(user) -> bool:
    """HRManager/SystemAdmin, or an active HR workflow delegate (as the workflow engine decides)."""

    return bool(user and user.is_authenticated and is_user_approver_for_role(user, "hr"))


def can_actor_decide(actor, instance: ProfileChangeRequest, *, hr_approver: bool | None = None) -> bool:
    """Whether decide would accept ``actor`` right now."""

    if not actor or not getattr(actor, "is_authenticated", False) or instance.status != Status.PENDING_HR:
        return False
    if actor.pk == instance.employee_profile.user_id:
        return False
    return is_hr_approver(actor) if hr_approver is None else hr_approver


# ---------------------------------------------------------------------------
# Attachments (uploaded and OCR-read before the request exists)
# ---------------------------------------------------------------------------


def create_attachment(*, user, profile: EmployeeProfile, document_type: str, upload) -> ProfileChangeAttachment:
    with transaction.atomic():
        EmployeeProfile.objects.select_for_update().only("pk").get(pk=profile.pk)
        unused = ProfileChangeAttachment.objects.filter(employee_profile=profile, request__isnull=True).count()
        if unused >= MAX_UNUSED_ATTACHMENTS:
            raise ProfileChangeError(TOO_MANY_UPLOADS_MESSAGE, field="file")
        attachment = ProfileChangeAttachment(
            employee_profile=profile,
            company_id=profile.company_id,
            document_type=document_type,
            original_filename=os.path.basename(getattr(upload, "name", "") or "")[:255],
            uploaded_by=user,
        )
        attachment.file = upload
        attachment.save()
        transaction.on_commit(lambda: queue_attachment_extraction(attachment))
    return attachment


QUEUE_FAILED_WARNING = "The document could not be read automatically. Enter the details by hand."


def queue_attachment_extraction(attachment: ProfileChangeAttachment) -> None:
    from ..tasks import extract_profile_change_attachment

    try:
        result = extract_profile_change_attachment.apply_async(args=[attachment.pk], retry=False)
    except Exception:
        logger.exception("profile_change_attachment_ocr_queue_failed", extra={"attachment_id": attachment.pk})
        ProfileChangeAttachment.objects.filter(pk=attachment.pk).update(
            extraction_status=ExtractionStatus.FAILED,
            extraction_error="OCR could not be queued.",
            extraction_warnings=[QUEUE_FAILED_WARNING],
            extraction_completed_at=timezone.now(),
        )
        return
    task_id = str(getattr(result, "id", "") or "")[:64]
    if task_id:
        ProfileChangeAttachment.objects.filter(pk=attachment.pk).update(extraction_task_id=task_id)


def cleanup_unattached_attachments(*, now=None) -> int:
    """Delete uploads never submitted within ``UNUSED_ATTACHMENT_TTL`` (file first, then row)."""

    cutoff = (now or timezone.now()) - UNUSED_ATTACHMENT_TTL
    deleted = 0
    for attachment in ProfileChangeAttachment.objects.filter(request__isnull=True, created_at__lt=cutoff).iterator():
        try:
            if attachment.file:
                attachment.file.delete(save=False)
        except Exception:
            logger.exception("profile_change_attachment_file_delete_failed", extra={"attachment_id": attachment.pk})
            continue
        # Re-check under the delete: a submit may have claimed it meanwhile.
        deleted += ProfileChangeAttachment.objects.filter(pk=attachment.pk, request__isnull=True).delete()[0]
    return deleted


# ---------------------------------------------------------------------------
# Submit / cancel
# ---------------------------------------------------------------------------


def _normalized_changes(profile: EmployeeProfile, items) -> dict[str, str]:
    if items is None:
        items = {}
    if not isinstance(items, dict):
        raise ProfileChangeError("Send items as an object of field: value.", field="items")
    errors: dict[str, list[str]] = {}
    normalized: dict[str, str] = {}
    for field, raw in items.items():
        if field in FILE_FIELDS.values():
            errors[field] = [FILE_IN_ITEMS_MESSAGE]
        elif field not in FIELD_KINDS:
            errors[str(field)] = [NOT_CHANGEABLE_MESSAGE]
        else:
            try:
                normalized[field] = normalize_value(field, raw)
            except ValueError as exc:
                errors[field] = [str(exc)]
    if errors:
        raise _fail(errors)

    changes = {}
    for field in FIELD_KINDS:
        if field not in normalized:
            continue
        value, old = normalized[field], current_value(profile, field)
        if _same(field, value, old):
            continue
        if not value:
            errors[field] = [EMPTY_MESSAGE]
        elif field == "email" and _email_taken(value, exclude_user_id=profile.user_id):
            errors[field] = [EMAIL_TAKEN_MESSAGE]
        else:
            changes[field] = value
    if errors:
        raise _fail(errors)
    return changes


def _parse_attachment_ids(attachment_ids) -> list[int]:
    if attachment_ids is None:
        return []
    if not isinstance(attachment_ids, list) or not all(
        isinstance(value, int) and not isinstance(value, bool) for value in attachment_ids
    ):
        raise ProfileChangeError("Send attachment_ids as a list of ids.", field="attachment_ids")
    if len(set(attachment_ids)) != len(attachment_ids) or len(attachment_ids) > len(FILE_FIELDS):
        raise ProfileChangeError(ATTACHMENT_DUPLICATE_TYPE_MESSAGE, field="attachment_ids")
    return attachment_ids


def submit_change_request(*, user, profile: EmployeeProfile, items, attachment_ids) -> ProfileChangeRequest:
    """Create a PENDING_HR request owned by ``profile``; ownership and company never come from the client."""

    changes = _normalized_changes(profile, items)
    ids = _parse_attachment_ids(attachment_ids)
    try:
        with transaction.atomic():
            # Serialize simultaneous submissions by the same employee.
            EmployeeProfile.objects.select_for_update().only("pk").get(pk=profile.pk)
            if ProfileChangeRequest.objects.filter(employee_profile=profile, status=Status.PENDING_HR).exists():
                raise ProfileChangeError(ALREADY_PENDING_MESSAGE)
            attachments = list(
                ProfileChangeAttachment.objects.select_for_update()
                .filter(pk__in=ids, employee_profile=profile, company_id=profile.company_id, request__isnull=True)
                .order_by("pk")
            )
            if len(attachments) != len(ids):
                raise ProfileChangeError(ATTACHMENT_INVALID_MESSAGE, field="attachment_ids")
            if len({attachment.document_type for attachment in attachments}) != len(attachments):
                raise ProfileChangeError(ATTACHMENT_DUPLICATE_TYPE_MESSAGE, field="attachment_ids")
            if not changes and not attachments:
                raise ProfileChangeError(NOTHING_TO_CHANGE_MESSAGE, field="items")

            ocr = {}
            for attachment in attachments:
                ocr.update(ocr_values(attachment))
            line_items = [
                {
                    "field": field,
                    "old": current_value(profile, field) or None,
                    "new": value,
                    "source": "ocr" if ocr.get(field) == value else "manual",
                    "decision": "pending",
                    "note": "",
                }
                for field, value in changes.items()
            ]
            for attachment in sorted(attachments, key=lambda item: ALL_FIELDS.index(FILE_FIELDS[item.document_type])):
                line_items.append(
                    {
                        "field": FILE_FIELDS[attachment.document_type],
                        "old": None,
                        "new": attachment.original_filename or os.path.basename(attachment.file.name),
                        "source": "manual",
                        "decision": "pending",
                        "note": "",
                        "attachment_id": attachment.pk,
                    }
                )
            instance = ProfileChangeRequest.objects.create(
                employee_profile=profile,
                company_id=profile.company_id,
                items=line_items,
                submitted_by=user,
            )
            ProfileChangeAttachment.objects.filter(pk__in=[a.pk for a in attachments]).update(request=instance)
            start = begin_recorded_transition(instance, actor=user, new_instance=True)
            record_workflow_transition(
                instance, start, action=WorkflowAction.Action.SUBMIT, actor=user, approver_role=""
            )
    except IntegrityError:
        # The partial unique constraint caught a concurrent duplicate.
        raise ProfileChangeError(ALREADY_PENDING_MESSAGE) from None
    return instance


def _lock(instance: ProfileChangeRequest) -> ProfileChangeRequest:
    return (
        ProfileChangeRequest.objects.select_for_update(of=("self",))
        .select_related("employee_profile", "employee_profile__user")
        .get(pk=instance.pk)
    )


def cancel_change_request(instance, *, actor) -> ProfileChangeRequest:
    with transaction.atomic():
        locked = _lock(instance)
        if locked.employee_profile.user_id != actor.pk:
            raise ProfileChangeError(NOT_OWNER_MESSAGE, status=403)
        if locked.status != Status.PENDING_HR:
            raise ProfileChangeError("Only pending requests can be cancelled.")
        start = begin_recorded_transition(locked, actor=actor)
        locked.status = Status.CANCELLED
        locked.decided_by = actor
        locked.decided_at = timezone.now()
        locked.save(update_fields=["status", "decided_by", "decided_at", "updated_at"])
        record_workflow_transition(locked, start, action=WorkflowAction.Action.CANCEL, actor=actor, approver_role="")
    return locked


# ---------------------------------------------------------------------------
# Decide (every item at once)
# ---------------------------------------------------------------------------


def _assert_hr_decider(locked: ProfileChangeRequest, actor) -> None:
    if actor.pk == locked.employee_profile.user_id:
        raise ProfileChangeError(SELF_DECISION_MESSAGE, status=403)
    if not is_hr_approver(actor):
        raise ProfileChangeError(NOT_HR_MESSAGE, status=403)
    if locked.status != Status.PENDING_HR:
        raise ProfileChangeError(NOT_PENDING_MESSAGE)


def _parse_decisions(decisions, items: list[dict]) -> dict[str, tuple[str, str]]:
    """``{field: (decision, note)}`` covering every item exactly once, or a 422."""

    if not isinstance(decisions, list) or not decisions:
        raise ProfileChangeError("Send decisions as a list with one entry per item.", field="decisions")
    item_fields = [item["field"] for item in items]
    errors: dict[str, list[str]] = {}
    parsed: dict[str, tuple[str, str]] = {}
    for entry in decisions:
        if not isinstance(entry, dict) or not isinstance(entry.get("field"), str):
            raise ProfileChangeError("Each decision needs a field.", field="decisions")
        field = entry["field"]
        if field not in item_fields:
            raise ProfileChangeError(f"'{field}' is not part of this request.", field="decisions")
        if field in parsed:
            raise ProfileChangeError(f"'{field}' was decided more than once.", field="decisions")
        decision = entry.get("decision")
        note = entry.get("note") or ""
        if not isinstance(note, str):
            errors[f"decisions.{field}"] = ["Enter the note as text."]
            continue
        note = note.strip()[:2000]
        if decision not in {APPROVE, REJECT}:
            errors[f"decisions.{field}"] = ["Use approve or reject."]
        elif decision == REJECT and not note:
            errors[f"decisions.{field}"] = [NOTE_REQUIRED_MESSAGE]
        parsed[field] = (decision, note)
    if errors:
        raise _fail(errors)
    missing = [field for field in item_fields if field not in parsed]
    if missing:
        raise ProfileChangeError(f"Decide every item: {', '.join(missing)}.", field="decisions")
    return parsed


def _to_python(field: str, value: str):
    return date.fromisoformat(value) if FIELD_KINDS[field] == DATE else value


def _apply_profile_fields(profile: EmployeeProfile, approved: list[dict]) -> list[str]:
    changed: list[str] = []
    for item in approved:
        field = item["field"]
        if field not in PROFILE_TARGETS:
            continue
        target, siblings, raws = PROFILE_TARGETS[field]
        value = _to_python(field, item["new"])
        for attribute in (target, *siblings):
            setattr(profile, attribute, value)
        for attribute in raws:
            # The raw import text described the old value; keep it from contradicting the new one.
            setattr(profile, attribute, None)
        changed.extend([target, *siblings, *raws])
    if changed:
        profile.save(update_fields=[*changed, "updated_at"])
    return changed


def _apply_email(profile: EmployeeProfile, new_email: str) -> None:
    user_model = get_user_model()
    user = user_model.objects.select_for_update().get(pk=profile.user_id)
    if _email_taken(new_email, exclude_user_id=user.pk):
        raise ProfileChangeError(EMAIL_TAKEN_AT_APPROVAL_MESSAGE, field="decisions.email")
    user.email = new_email
    user.save(update_fields=["email"])


def _promote_attachment(
    attachment: ProfileChangeAttachment, profile: EmployeeProfile, submitted_by
) -> EmployeeDocument:
    """Copy an approved scan into the archive as a new, authoritative document (older ones are kept)."""

    try:
        with attachment.file.open("rb") as handle:
            content = handle.read()
    except FileNotFoundError:
        raise ProfileChangeError(FILE_MISSING_MESSAGE) from None
    document = EmployeeDocument(
        employee_profile=profile,
        company_id=profile.company_id,
        document_type=attachment.document_type,
        original_filename=attachment.original_filename,
        exit_before=getattr(profile, FILE_EXPIRY_FIELD[attachment.document_type]),
        uploaded_by=submitted_by,
    )
    filename = attachment.original_filename or os.path.basename(attachment.file.name)
    document.file.save(filename, ContentFile(content), save=False)
    document.save()
    attachment.applied_document = document
    attachment.save(update_fields=["applied_document", "updated_at"])
    return document


def decide_change_request(instance, *, actor, decisions, note: str = ""):
    """Decide every item. Returns ``(request, approved_fields, rejected_fields)``."""

    note = (note or "").strip()[:2000] if isinstance(note, str) else ""
    with transaction.atomic():
        locked = _lock(instance)
        _assert_hr_decider(locked, actor)
        parsed = _parse_decisions(decisions, locked.items)
        profile = (
            EmployeeProfile.objects.select_for_update(of=("self",))
            .select_related("user")
            .get(pk=locked.employee_profile_id)
        )
        if profile.company_id != locked.company_id:
            raise ProfileChangeError(COMPANY_CHANGED_MESSAGE)

        items = [dict(item) for item in locked.items]
        for item in items:
            decision, item_note = parsed[item["field"]]
            item["decision"] = "approved" if decision == APPROVE else "rejected"
            item["note"] = item_note
        approved = [item for item in items if item["decision"] == "approved"]
        rejected = [item for item in items if item["decision"] == "rejected"]

        start = begin_recorded_transition(locked, actor=actor)
        # Checks that can refuse the decision run before anything is written to storage.
        email_item = next((item for item in approved if item["field"] == "email"), None)
        if email_item:
            _apply_email(profile, email_item["new"])
        _apply_profile_fields(profile, approved)
        attachments = {attachment.pk: attachment for attachment in locked.attachments.all()}
        documents = []
        for item in approved:
            if item["field"] in FILE_FIELDS.values():
                attachment = attachments.get(item.get("attachment_id"))
                if attachment is None:
                    raise ProfileChangeError(FILE_MISSING_MESSAGE)
                documents.append(_promote_attachment(attachment, profile, locked.submitted_by))

        if not rejected:
            locked.status = Status.APPROVED
        elif approved:
            locked.status = Status.PARTIALLY_APPROVED
        else:
            locked.status = Status.REJECTED
        locked.items = items
        locked.decided_by = actor
        locked.decided_at = timezone.now()
        locked.decision_note = note
        locked.save(update_fields=["status", "items", "decided_by", "decided_at", "decision_note", "updated_at"])
        record_workflow_transition(
            locked,
            start,
            action=WorkflowAction.Action.REJECT if locked.status == Status.REJECTED else WorkflowAction.Action.APPROVE,
            actor=actor,
            note=note,
            approver_role="hr",
        )
        for document in documents:
            transaction.on_commit(lambda document=document: _queue_document_ocr(document))
    return locked, [item["field"] for item in approved], [item["field"] for item in rejected]


def _queue_document_ocr(document: EmployeeDocument) -> None:
    try:
        queue_document_extraction(document)
    except Exception:
        # The decision is durable; HR can re-run OCR from the document archive.
        logger.exception("profile_change_document_ocr_queue_failed", extra={"document_id": document.pk})


# ---------------------------------------------------------------------------
# Audit (ids, status and field names only: never values, OCR text, notes, or file contents)
# ---------------------------------------------------------------------------


def audit_change_request(request, action: str, instance: ProfileChangeRequest, *, extra=None) -> None:
    metadata = {
        "request_id": instance.pk,
        "employee_profile_id": instance.employee_profile_id,
        "company_id": instance.company_id,
        "status": instance.status,
        "fields": [item["field"] for item in instance.items or []],
    }
    metadata.update(extra or {})
    audit(request, action, entity="ProfileChangeRequest", entity_id=instance.pk, metadata=metadata)


def audit_attachment(request, action: str, attachment: ProfileChangeAttachment) -> None:
    audit(
        request,
        action,
        entity="ProfileChangeAttachment",
        entity_id=attachment.pk,
        metadata={
            "attachment_id": attachment.pk,
            "request_id": attachment.request_id,
            "employee_profile_id": attachment.employee_profile_id,
            "company_id": attachment.company_id,
            "document_type": attachment.document_type,
        },
    )


# ---------------------------------------------------------------------------
# Notifications (after commit; failures are logged and never propagate)
# ---------------------------------------------------------------------------


def eligible_hr_approvers(company_id, *, exclude_user_id=None):
    users = get_hr_approver_users().filter(
        Q(employee_profile__company_id=company_id)
        | Q(organization_access_entries__organization_id=company_id)
        | Q(groups__name="SystemAdmin")
    )
    if exclude_user_id is not None:
        users = users.exclude(pk=exclude_user_id)
    return users.distinct()


def _labels(fields) -> str:
    return ", ".join(FIELD_LABELS.get(field, field) for field in fields)


def _dispatch(event: str, instance: ProfileChangeRequest, send: Callable[[], object]) -> None:
    try:
        with transaction.atomic():
            send()
    except Exception:
        logger.exception(
            "profile_change_request_notification_failed",
            extra={"event": event, "entity_id": instance.pk, "status": instance.status},
        )


def notify_after_submission(instance: ProfileChangeRequest) -> None:
    profile = instance.employee_profile

    def send():
        recipients = list(eligible_hr_approvers(instance.company_id, exclude_user_id=profile.user_id))
        if not recipients:
            return None
        return notify_users_for_pending_status(
            users=recipients,
            request_type=REQUEST_TYPE,
            request_id=instance.pk,
            requester_name=profile.full_name or getattr(profile.user, "email", ""),
            status_label="Pending HR",
            details=[f"Requested changes: {_labels(item['field'] for item in instance.items)}"],
            action_path=HR_ACTION_PATH,
        )

    transaction.on_commit(lambda: _dispatch("submitted", instance, send))


def notify_after_decision(instance: ProfileChangeRequest) -> None:
    approved = [item for item in instance.items if item.get("decision") == "approved"]
    rejected = [item for item in instance.items if item.get("decision") == "rejected"]
    details = []
    if approved:
        details.append(f"Approved: {_labels(item['field'] for item in approved)}")
    if rejected:
        details.append(f"Rejected: {_labels(item['field'] for item in rejected)}")
    reason = "; ".join(f"{FIELD_LABELS.get(item['field'], item['field'])}: {item['note']}" for item in rejected)

    def send():
        return notify_profile_request_status_whatsapp(
            profile=instance.employee_profile,
            request_type=REQUEST_TYPE,
            request_id=instance.pk,
            status_label=str(instance.get_status_display()),
            details=details,
            action_path=EMPLOYEE_ACTION_PATH,
            reason=reason or None,
        )

    transaction.on_commit(lambda: _dispatch(instance.status.lower(), instance, send))
