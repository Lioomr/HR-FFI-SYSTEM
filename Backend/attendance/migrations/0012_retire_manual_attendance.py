"""Purge manual attendance data as part of the BioTime-only attendance policy.

.. warning::

   **This migration is irreversible and permanently destroys data.** It issues
   hard ``DELETE`` statements against attendance, correction-request,
   starting-work-acknowledgment, workflow and audit-log rows. ``reverse_code``
   is ``migrations.RunPython.noop``: it exists only so the migration can be
   unapplied to move the schema pointer back, and it *cannot* recreate anything
   this forward step removed. The only way back is a database backup taken
   before this migration ran. Take one.

What is deleted (explicit, conservative targeting)
--------------------------------------------------
1. **Every** ``AttendanceRecord`` row with ``source`` in ``{EMPLOYEE, HR}`` --
   every punch created by employee self check-in/out or by an HR override. No
   manual row is exempt; see "Records protected by a StartingWorkAcknowledgment"
   below for the one case that needs extra work first.
2. Every ``AttendanceCorrectionRequest`` row, regardless of status. Manual
   attendance correction is permanently retired, so there is no state in which
   one of these rows remains meaningful.
3. Any ``StartingWorkAcknowledgment`` anchored to a row deleted by step 1. Its
   ``attendance_record`` field is a non-nullable ``PROTECT`` one-to-one, so the
   relationship cannot merely be unlinked -- the acknowledgment row itself must
   go before the attendance row can be deleted.
4. ``WorkflowInstance`` rows (and, by cascade, their ``WorkflowAction`` rows)
   that point at any object deleted by steps 1, 2, 3 or 6. Leaving them behind
   would strand generic foreign keys on missing objects.
5. ``AuditLog`` rows for the retired manual actions and for the acknowledgments
   removed by step 3, matched by BOTH action name AND the id of a row deleted
   above -- never by action name alone.
6. Auto-generated absence rows -- ``source=SYSTEM``, ``status=ABSENT``, no
   punch timestamps, no ``biotime_emp_code``, no ``created_by`` -- belonging to
   employees who have no ``BioTimeEmployeeMap`` at all. Such an employee was
   never registered on a device, so the absence was never evidence of anything.

Records protected by a StartingWorkAcknowledgment
-------------------------------------------------
``StartingWorkAcknowledgment.attendance_record`` is ``on_delete=PROTECT``, so a
manual attendance row carrying one cannot simply be deleted.

Such a row exists only through a specific history:
``generate_starting_work_acknowledgment()`` refuses to create an acknowledgment
unless the record is ``source=SYSTEM``, ``is_overridden=False`` and carries a
``biotime_emp_code`` matching a live mapping. So the anchor row started life as
a genuine BioTime punch and only became manual afterwards, when an HR override
stamped ``source=HR`` / ``is_overridden=True`` on it. The approved policy is
that manual attendance is purged, so the row goes -- an earlier draft of this
migration silently exempted it, which quietly retained exactly the manual HR
override the policy exists to remove.

For each such row this migration therefore:

* deletes the ``StartingWorkAcknowledgment`` row, which releases the ``PROTECT``
  and drops its ``affected_attendance_records`` through-table entries;
* deletes that acknowledgment's ``WorkflowInstance`` (and its
  ``WorkflowAction`` rows) and its ``AuditLog`` events;
* **keeps** the linked ``EmployeeDocument`` -- the generated acknowledgment PDF
  in the employee's document archive. Only the relationship is removed, never
  the HR document itself.

The migration writes **nothing**. The approved policy purges manual attendance
data *and its audit events*, so no replacement record is created for the
unlinked document: a new audit row would carry the very manual-attendance
identifiers and dates the purge exists to remove. The surviving
``EmployeeDocument`` keeps its own ``custom_name`` ("Starting Work
Acknowledgment"), ``original_filename`` and ``employee_profile``, which is what
HR uses to identify it afterwards.

Fail-closed guards (nothing is deleted if either trips)
-------------------------------------------------------
Both checks run before the first ``DELETE``, and ``RunPython`` executes inside a
transaction, so the database is never left partially purged.

* **Unexpected inbound references.** Only ``CASCADE`` and ``SET_NULL`` actually
  remove or detach a referencing row when its acknowledgment goes. Every other
  behaviour -- ``PROTECT``, ``RESTRICT``, ``SET_DEFAULT``, ``DO_NOTHING`` and
  anything unrecognised -- is treated as a blocker. ``DO_NOTHING`` in particular
  is *not* safe here: it leaves the referencing row pointing at a deleted
  acknowledgment, which is either a dangling reference or a database integrity
  error raised part-way through the purge. When a blocker is found the migration
  raises and names the model, field, ``on_delete`` and row count. Today nothing
  in the project references ``StartingWorkAcknowledgment``, so this guard exists
  for future schema changes rather than current data.
* **An acknowledgment on an auto-absence row.** Step 6 targets rows with no
  punch data and no mapping, which by construction can never carry an
  acknowledgment. Removing an acknowledgment there was never approved, so
  rather than silently skipping the row the migration raises and names the rows
  needing manual review.

What is preserved
-----------------
* Every ``source=SYSTEM`` row that carries BioTime punch information -- a
  ``biotime_emp_code``, a ``check_in_at`` or a ``check_out_at``. These are
  genuine device reads and are never touched, whatever their status. A
  ``StartingWorkAcknowledgment`` anchored to one of these is likewise untouched:
  only acknowledgments on *manual* rows are removed.
* Every auto-absence row for an employee who *does* have a BioTime mapping:
  that employee is on a device, so a missing punch is real information.
* Every ``EmployeeDocument``, including the acknowledgment PDFs whose
  acknowledgment row is removed by step 3.
* Employee profiles themselves. Unmapped construction-site and visitor staff
  stay HR employees; they simply have no attendance data.
* All audit history that is not one of the enumerated manual-attendance,
  correction or removed-acknowledgment events, including the
  ``attendance.absence_detection_run`` batch summaries and every BioTime
  ingest/config/mapping event. No new audit rows are added by this migration.
"""

from django.db import migrations, models

# Audit actions written by the retired manual endpoints, keyed by the
# ``entity`` value they were logged under.
MANUAL_RECORD_AUDIT_ACTIONS = (
    "attendance.check_in",
    "attendance.check_out",
    "attendance.override",
    "approve",
    "reject",
    "approve_ceo",
    "reject_ceo",
)
MANUAL_RECORD_AUDIT_ENTITIES = ("attendance_record", "AttendanceRecord")

CORRECTION_AUDIT_ACTIONS = (
    "attendance_correction.submitted",
    "attendance_correction.manager_approved",
    "attendance_correction.hr_approved",
    "attendance_correction.rejected",
    "attendance_correction.cancelled",
)
CORRECTION_AUDIT_ENTITIES = ("attendance_correction_request", "AttendanceCorrectionRequest")

STARTING_WORK_AUDIT_ACTIONS = (
    "starting_work_acknowledgment_pending_hr_created",
    "starting_work_acknowledgment_document_archived",
    "starting_work_acknowledgment_hr_notified",
    "starting_work_acknowledgment_pdf_downloaded",
    "starting_work_acknowledgment_approved",
    "starting_work_acknowledgment_rejected",
)
STARTING_WORK_AUDIT_ENTITIES = ("StartingWorkAcknowledgment", "starting_work_acknowledgment")

#: The only ``on_delete`` behaviours that actually remove or detach a
#: referencing row when its target goes. Everything else -- PROTECT, RESTRICT,
#: SET_DEFAULT, DO_NOTHING and anything unrecognised -- must stop the migration:
#: DO_NOTHING would leave a dangling reference or raise an integrity error
#: part-way through the purge.
SAFE_ON_DELETE = frozenset({models.CASCADE, models.SET_NULL})


def _delete_workflow_instances(apps, model_label, object_ids):
    """Drop WorkflowInstance rows (cascading to WorkflowAction) for ``object_ids``."""
    if not object_ids:
        return 0
    ContentType = apps.get_model("contenttypes", "ContentType")
    WorkflowInstance = apps.get_model("core", "WorkflowInstance")
    app_label, model = model_label.split(".")
    content_type = ContentType.objects.filter(app_label=app_label, model=model).first()
    if content_type is None:
        return 0
    deleted, _ = WorkflowInstance.objects.filter(
        content_type_id=content_type.id, object_id__in=object_ids
    ).delete()
    return deleted


def _delete_audit_logs(apps, actions, entities, entity_ids):
    if not entity_ids:
        return 0
    AuditLog = apps.get_model("audit", "AuditLog")
    deleted, _ = AuditLog.objects.filter(
        action__in=actions,
        entity__in=entities,
        entity_id__in=[str(pk) for pk in entity_ids],
    ).delete()
    return deleted


def _acknowledgment_delete_blockers(apps, acknowledgment_ids):
    """Inbound references that would make deleting these acknowledgments unsafe.

    Returns human-readable descriptions; an empty list means the delete is safe.
    Reverse many-to-many relations are skipped: the through rows this
    migration's acknowledgments own are removed with them.
    """
    if not acknowledgment_ids:
        return []

    Acknowledgment = apps.get_model("job_offers", "StartingWorkAcknowledgment")
    blockers = []
    for relation in Acknowledgment._meta.related_objects:
        if relation.many_to_many:
            continue
        field = relation.field
        if getattr(field.remote_field, "on_delete", None) in SAFE_ON_DELETE:
            continue
        related_model = relation.related_model
        count = (
            related_model._default_manager.filter(**{f"{field.name}__in": acknowledgment_ids}).count()
        )
        if count:
            blockers.append(
                f"{related_model._meta.label}.{field.name} still references "
                f"{count} acknowledgment(s) with on_delete="
                f"{getattr(field.remote_field.on_delete, '__name__', field.remote_field.on_delete)}"
            )
    return blockers


def purge_manual_attendance(apps, schema_editor):
    AttendanceRecord = apps.get_model("attendance", "AttendanceRecord")
    AttendanceCorrectionRequest = apps.get_model("attendance", "AttendanceCorrectionRequest")
    BioTimeEmployeeMap = apps.get_model("attendance", "BioTimeEmployeeMap")
    Acknowledgment = apps.get_model("job_offers", "StartingWorkAcknowledgment")

    # ---- Collect targets (no deletes yet) --------------------------------
    # 1. Manual punch records: employee self-service and HR overrides. Every
    #    one of them, including any that a StartingWorkAcknowledgment protects.
    manual_ids = list(
        AttendanceRecord.objects.filter(source__in=["EMPLOYEE", "HR"]).values_list("id", flat=True)
    )

    # 2. Every correction request, whatever its status.
    correction_ids = list(AttendanceCorrectionRequest.objects.values_list("id", flat=True))

    # 3. Acknowledgments anchored to a manual record. These must go first: the
    #    relation is a non-nullable PROTECT one-to-one, so it cannot be unlinked.
    acknowledgment_ids = list(
        Acknowledgment.objects.filter(attendance_record_id__in=manual_ids).values_list("id", flat=True)
    )

    # 6. Auto-absences for employees with no BioTime mapping. Every clause is
    #    required: a row must look exactly like one `mark_absentees_for_date`
    #    wrote (system source, ABSENT, no punch data, no human author) and
    #    belong to an employee who is not on any device.
    mapped_profile_ids = set(BioTimeEmployeeMap.objects.values_list("employee_profile_id", flat=True))
    unmapped_absence_ids = list(
        AttendanceRecord.objects.filter(
            source="SYSTEM",
            status="ABSENT",
            check_in_at__isnull=True,
            check_out_at__isnull=True,
            biotime_emp_code="",
            created_by__isnull=True,
        )
        .exclude(employee_profile_id__in=mapped_profile_ids)
        .values_list("id", flat=True)
    )

    # ---- Fail-closed guards (still no deletes) ---------------------------
    blockers = _acknowledgment_delete_blockers(apps, acknowledgment_ids)
    if blockers:
        raise RuntimeError(
            "attendance.0012 aborted before deleting anything: a Starting Work "
            "acknowledgment attached to manual attendance is referenced by rows this "
            "migration is not allowed to remove. Resolve these by hand, then re-run:\n  - "
            + "\n  - ".join(blockers)
        )

    absence_acknowledgments = list(
        Acknowledgment.objects.filter(attendance_record_id__in=unmapped_absence_ids).values_list(
            "attendance_record_id", "reference_number"
        )
    )
    if absence_acknowledgments:
        details = ", ".join(
            f"attendance_record={record_id} (reference {reference})"
            for record_id, reference in absence_acknowledgments
        )
        raise RuntimeError(
            "attendance.0012 aborted before deleting anything: auto-absence rows for unmapped "
            "employees carry a Starting Work acknowledgment, which this migration is not "
            "approved to remove. These rows need manual review: " + details
        )

    record_ids = manual_ids + unmapped_absence_ids

    # ---- Deletes ---------------------------------------------------------
    # 4. Workflow instances first: they reference their objects generically, so
    #    nothing else clears them.
    _delete_workflow_instances(apps, "job_offers.startingworkacknowledgment", acknowledgment_ids)
    _delete_workflow_instances(apps, "attendance.attendancerecord", record_ids)
    _delete_workflow_instances(apps, "attendance.attendancecorrectionrequest", correction_ids)

    # 5. Audit events, matched on action name *and* a deleted row's id.
    _delete_audit_logs(
        apps, STARTING_WORK_AUDIT_ACTIONS, STARTING_WORK_AUDIT_ENTITIES, acknowledgment_ids
    )
    _delete_audit_logs(apps, MANUAL_RECORD_AUDIT_ACTIONS, MANUAL_RECORD_AUDIT_ENTITIES, record_ids)
    _delete_audit_logs(apps, CORRECTION_AUDIT_ACTIONS, CORRECTION_AUDIT_ENTITIES, correction_ids)

    # 3. Acknowledgments, which releases the PROTECT on their attendance rows.
    #    The EmployeeDocument each one points at is deliberately left in place,
    #    and nothing is written to record that: a replacement audit row would
    #    carry the manual-attendance identifiers this purge exists to remove.
    Acknowledgment.objects.filter(id__in=acknowledgment_ids).delete()

    # Correction requests before attendance records: they hold a nullable FK to
    # AttendanceRecord and must not be left dangling mid-transaction.
    AttendanceCorrectionRequest.objects.filter(id__in=correction_ids).delete()
    AttendanceRecord.objects.filter(id__in=record_ids).delete()


class Migration(migrations.Migration):
    """Irreversible data purge. See the module docstring before running."""

    dependencies = [
        ("attendance", "0011_attendancerecord_is_late_flagged"),
        ("audit", "0001_initial"),
        ("core", "0001_initial"),
        ("contenttypes", "0002_remove_content_type_name"),
        ("job_offers", "0005_startingworkacknowledgment"),
    ]

    operations = [
        migrations.RunPython(purge_manual_attendance, migrations.RunPython.noop),
    ]
