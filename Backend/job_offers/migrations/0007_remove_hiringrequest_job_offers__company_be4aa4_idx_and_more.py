import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

import employees.storage


def preserve_offers_and_remove_hiring_request_data(apps, schema_editor):
    HiringRequest = apps.get_model("job_offers", "HiringRequest")
    JobOffer = apps.get_model("job_offers", "JobOffer")
    ContentType = apps.get_model("contenttypes", "ContentType")
    WorkflowDefinition = apps.get_model("core", "WorkflowDefinition")
    WorkflowInstance = apps.get_model("core", "WorkflowInstance")
    Notification = apps.get_model("in_app_notifications", "Notification")

    JobOffer.objects.update(approval_status="approved")
    for offer in JobOffer.objects.exclude(hiring_request_id=None).iterator():
        hiring_request = HiringRequest.objects.get(pk=offer.hiring_request_id)
        events = []
        if hiring_request.submitted_at:
            events.append(
                {
                    "id": f"migrated-submit-{hiring_request.pk}",
                    "type": "submit",
                    "actor_id": hiring_request.requested_by_id,
                    "at": hiring_request.submitted_at.isoformat(),
                    "from_status": "draft",
                    "to_status": "pending_ceo",
                    "reason": "",
                    "recommendation": "",
                }
            )
        if hiring_request.ceo_decision_at and hiring_request.status in {"approved", "converted", "rejected"}:
            approved = hiring_request.status in {"approved", "converted"}
            events.append(
                {
                    "id": f"migrated-decision-{hiring_request.pk}",
                    "type": "approve" if approved else "reject",
                    "actor_id": hiring_request.ceo_decision_by_id,
                    "at": hiring_request.ceo_decision_at.isoformat(),
                    "from_status": "pending_ceo",
                    "to_status": "approved" if approved else "rejected",
                    "reason": hiring_request.ceo_decision_note or "",
                    "recommendation": "",
                }
            )
        offer.date_of_birth = hiring_request.date_of_birth
        offer.cv_file = hiring_request.cv_file
        offer.submitted_at = hiring_request.submitted_at
        offer.ceo_decision_by_id = hiring_request.ceo_decision_by_id
        offer.ceo_decision_at = hiring_request.ceo_decision_at
        offer.ceo_decision_reason = hiring_request.ceo_decision_note or ""
        offer.approval_events = events
        offer.save(
            update_fields=[
                "date_of_birth",
                "cv_file",
                "submitted_at",
                "ceo_decision_by",
                "ceo_decision_at",
                "ceo_decision_reason",
                "approval_events",
            ]
        )

    content_type = ContentType.objects.filter(app_label="job_offers", model="hiringrequest").first()
    if content_type:
        WorkflowInstance.objects.filter(content_type_id=content_type.id).delete()
        content_type.delete()
    WorkflowDefinition.objects.filter(key="hiring_request").delete()
    Notification.objects.filter(
        models.Q(related_object_type="job_offers.hiringrequest") | models.Q(event_key__startswith="hiring_request.")
    ).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0008_alter_workflowaction_action"),
        ("employees", "0016_merge_0014_alter_employeeprofile_employment_status_0015_database_tenant_integrity"),
        ("hr_reference", "0002_department_company_position_company_sponsor_company_and_more"),
        ("in_app_notifications", "0002_notificationdelivery"),
        ("invites", "0006_merge_0005_invite_company_0005_invite_employee_profile"),
        ("job_offers", "0006_joboffer_department_ref_joboffer_position_ref"),
        ("organization", "0002_organizationscope"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="joboffer",
            name="approval_events",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="joboffer",
            name="approval_status",
            field=models.CharField(
                choices=[
                    ("draft", "Draft"),
                    ("pending_ceo", "Pending CEO"),
                    ("approved", "Approved"),
                    ("changes_requested", "Changes Requested"),
                    ("rejected", "Rejected"),
                ],
                db_index=True,
                default="draft",
                max_length=24,
            ),
        ),
        migrations.AddField(
            model_name="joboffer",
            name="ceo_decision_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="joboffer",
            name="ceo_decision_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="decided_job_offers",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="joboffer",
            name="ceo_decision_reason",
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name="joboffer",
            name="ceo_recommendation",
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name="joboffer",
            name="cv_file",
            field=models.FileField(
                blank=True,
                storage=employees.storage.PrivateUploadStorage(),
                upload_to="job_offer_cvs/",
            ),
        ),
        migrations.AddField(
            model_name="joboffer",
            name="date_of_birth",
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="joboffer",
            name="submitted_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.RunPython(preserve_offers_and_remove_hiring_request_data, migrations.RunPython.noop),
        migrations.RunSQL(
            sql="SET CONSTRAINTS ALL IMMEDIATE",
            reverse_sql="SET CONSTRAINTS ALL IMMEDIATE",
        ),
        migrations.RemoveIndex(model_name="hiringrequest", name="job_offers__company_be4aa4_idx"),
        migrations.RemoveIndex(model_name="hiringrequest", name="job_offers__company_3f2e1e_idx"),
        migrations.RemoveConstraint(
            model_name="hiringrequest",
            name="unique_hiring_request_reference_company",
        ),
        migrations.RemoveConstraint(
            model_name="hiringrequest",
            name="hiring_request_reference_not_blank",
        ),
        migrations.RemoveConstraint(
            model_name="hiringrequest",
            name="hiring_request_salary_nonnegative",
        ),
        migrations.RemoveField(model_name="joboffer", name="hiring_request"),
        migrations.DeleteModel(name="HiringRequest"),
        migrations.AddIndex(
            model_name="joboffer",
            index=models.Index(fields=["company", "approval_status"], name="job_offers__company_8ac224_idx"),
        ),
    ]
