import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

FINAL_DECISIONS = {"RENEW", "RENEW_WITH_CHANGES", "TERMINATE"}
RECOMMENDATION_TO_DECISION = {
    "CONTINUE_CONTRACT": "RENEW",
    "CONTINUE_WITH_CHANGES": "RENEW_WITH_CHANGES",
    "TERMINATE": "TERMINATE",
}


def migrate_legacy_ratings(apps, schema_editor):
    ContractRating = apps.get_model("contract_ratings", "ContractRating")
    for rating in ContractRating.objects.select_related("manager_response").iterator():
        rating.hr_comment_by_id = rating.hr_reviewed_by_id
        rating.hr_comment_submitted_at = rating.hr_decided_at

        decision = rating.ceo_selected_option if rating.ceo_selected_option in FINAL_DECISIONS else ""
        if not decision and rating.ceo_action == "ACCEPT" and rating.manager_response_id:
            decision = RECOMMENDATION_TO_DECISION.get(rating.manager_response.recommendation, "")

        if rating.status == "PENDING_HR":
            rating.status = "PENDING_CEO"
        elif rating.status == "APPROVED" and decision:
            rating.status = "DECIDED"
            rating.ceo_decision = decision
        elif rating.status in {"APPROVED", "REJECTED"}:
            rating.status = "MANUAL_RESOLUTION_REQUIRED"

        rating.save(
            update_fields=[
                "status",
                "ceo_decision",
                "hr_comment_by",
                "hr_comment_submitted_at",
            ]
        )


class Migration(migrations.Migration):
    dependencies = [("contract_ratings", "0001_initial")]

    operations = [
        migrations.AddField(
            model_name="contractrating",
            name="ceo_decision",
            field=models.CharField(
                blank=True,
                choices=[
                    ("RENEW", "Renew"),
                    ("RENEW_WITH_CHANGES", "Renew with changes"),
                    ("TERMINATE", "Terminate"),
                ],
                max_length=32,
            ),
        ),
        migrations.AddField(
            model_name="contractrating",
            name="hr_comment_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="+",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="contractrating",
            name="hr_comment_requested_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="contractrating",
            name="hr_comment_requested_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="+",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="contractrating",
            name="hr_comment_submitted_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.RunPython(migrate_legacy_ratings, migrations.RunPython.noop),
        migrations.RemoveField(model_name="contractrating", name="ceo_action"),
        migrations.RemoveField(model_name="contractrating", name="ceo_salary_override_reason"),
        migrations.RemoveField(model_name="contractrating", name="ceo_selected_option"),
        migrations.RemoveField(model_name="contractrating", name="hr_decided_at"),
        migrations.RemoveField(model_name="contractrating", name="hr_reviewed_by"),
        migrations.RemoveField(model_name="contractrating", name="salary_change_proposed"),
        migrations.RemoveField(model_name="contractratingresponse", name="other_change_notes"),
        migrations.RemoveField(model_name="contractratingresponse", name="proposed_job_title"),
        migrations.RemoveField(model_name="contractratingresponse", name="proposed_position_id"),
        migrations.RemoveField(model_name="contractratingresponse", name="proposed_terms"),
        migrations.RemoveField(model_name="contractratingresponse", name="recommendation"),
        migrations.RemoveField(model_name="contractratingresponse", name="recommended_change_types"),
        migrations.AlterField(
            model_name="contractrating",
            name="status",
            field=models.CharField(
                choices=[
                    ("PENDING_RESPONSES", "Awaiting both responses"),
                    ("WAITING_MANAGER", "Awaiting manager response"),
                    ("WAITING_EMPLOYEE", "Awaiting employee response"),
                    ("PENDING_CEO", "Pending CEO decision"),
                    ("DECIDED", "Decided"),
                    ("MANUAL_RESOLUTION_REQUIRED", "Manual resolution required"),
                ],
                db_index=True,
                default="PENDING_RESPONSES",
                max_length=32,
            ),
        ),
    ]
