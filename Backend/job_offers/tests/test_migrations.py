import uuid
from datetime import date, timedelta
from decimal import Decimal

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.exceptions import FieldDoesNotExist
from django.db import connection, transaction
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase
from django.utils import timezone

from organization.models import OrganizationNode

from ..models import JobOffer as CurrentJobOffer


class HiringRequestRemovalMigrationTests(TransactionTestCase):
    required_job_offer_columns = {
        "approval_events",
        "approval_status",
        "ceo_decision_at",
        "ceo_decision_by_id",
        "ceo_decision_reason",
        "ceo_recommendation",
        "cv_file",
        "date_of_birth",
        "submitted_at",
    }
    migrate_from = [
        ("accounts", "0004_user_auth_token_version"),
        ("core", "0007_scope_membership_and_delegation_lifecycle"),
        ("in_app_notifications", "0002_notificationdelivery"),
        ("job_offers", "0006_joboffer_department_ref_joboffer_position_ref"),
    ]
    migrate_to = [
        ("accounts", "0004_user_auth_token_version"),
        ("core", "0008_alter_workflowaction_action"),
        ("in_app_notifications", "0002_notificationdelivery"),
        ("job_offers", "0008_startingworkacknowledgment_hr_verification"),
    ]

    def setUp(self):
        super().setUp()
        self._schema_transaction = transaction.atomic()
        self._schema_transaction.__enter__()
        self._schema_rolled_back = False
        # Cleanups run last-in-first-out: rollback restores the shared schema,
        # then the current-model write proves restoration succeeded.
        self.addCleanup(self._assert_current_job_offer_write)
        self.addCleanup(self._rollback_schema_changes)
        self.executor = MigrationExecutor(connection)
        self.executor.migrate(self.migrate_from)
        old_apps = self.executor.loader.project_state(self.migrate_from).apps
        self.offer_id = self._create_old_data(old_apps)
        self.executor = MigrationExecutor(connection)
        self.executor.migrate(self.migrate_to)
        self.new_apps = self.executor.loader.project_state(self.migrate_to).apps

    def _rollback_schema_changes(self):
        if self._schema_rolled_back:
            return
        transaction.set_rollback(True)
        self._schema_transaction.__exit__(None, None, None)
        self._schema_rolled_back = True

    def _assert_current_job_offer_write(self):
        with connection.cursor() as cursor:
            acknowledgment_columns = {
                column.name
                for column in connection.introspection.get_table_description(
                    cursor, "job_offers_startingworkacknowledgment"
                )
            }
        self.assertTrue(
            {
                "approved_by_id",
                "approved_at",
                "rejected_by_id",
                "rejected_at",
                "rejection_reason",
            }.issubset(acknowledgment_columns)
        )
        self.assertTrue(
            any(
                table.startswith("job_offers_startingworkacknowledgment_affected_attendance_")
                for table in connection.introspection.table_names()
            )
        )
        suffix = uuid.uuid4().hex[:12]
        user_model = get_user_model()
        user = user_model.objects.create_user(
            email=f"migration-cleanup-{suffix}@example.com",
            password="unused",
        )
        company = OrganizationNode.objects.create(
            code=f"MIG-CLEAN-{suffix}",
            name="Migration Cleanup Company",
            node_type=OrganizationNode.NodeType.COMPANY,
        )
        offer = CurrentJobOffer.objects.create(
            company=company,
            candidate_full_name="Post-migration Cleanup Candidate",
            candidate_email=f"candidate-{suffix}@example.com",
            date_of_birth=date(1991, 4, 5),
            position_title="Engineer",
            expiry_date=timezone.localdate() + timedelta(days=7),
            reference_number=f"JO-CLEAN-{suffix}",
            hr_signer_user=user,
            created_by=user,
            updated_by=user,
        )
        self.assertEqual(offer.date_of_birth, date(1991, 4, 5))
        offer.delete()
        company.delete()
        user.delete()

    def _assert_complete_job_offer_schema(self):
        tables = set(connection.introspection.table_names())
        self.assertIn("job_offers_joboffer", tables)
        self.assertNotIn("job_offers_hiringrequest", tables)
        with connection.cursor() as cursor:
            columns = {
                column.name for column in connection.introspection.get_table_description(cursor, "job_offers_joboffer")
            }
        self.assertTrue(self.required_job_offer_columns.issubset(columns))
        self.assertNotIn("hiring_request_id", columns)

    def _create_old_data(self, apps):
        user_app, user_model = settings.AUTH_USER_MODEL.split(".")
        User = apps.get_model(user_app, user_model)
        OrganizationNode = apps.get_model("organization", "OrganizationNode")
        HiringRequest = apps.get_model("job_offers", "HiringRequest")
        JobOffer = apps.get_model("job_offers", "JobOffer")
        ContentType = apps.get_model("contenttypes", "ContentType")
        WorkflowDefinition = apps.get_model("core", "WorkflowDefinition")
        WorkflowInstance = apps.get_model("core", "WorkflowInstance")
        Notification = apps.get_model("in_app_notifications", "Notification")

        suffix = uuid.uuid4().hex[:12]
        user = User.objects.create(
            email=f"migration-hr-{suffix}@example.com", full_name="Migration HR", password="unused"
        )
        company = OrganizationNode.objects.create(code=f"MIG-{suffix}", name="Migration Company", node_type="company")
        decided_at = timezone.now()
        hiring_request = HiringRequest.objects.create(
            company=company,
            reference_number="HRQ-MIGRATION-0001",
            candidate_full_name="Migration Candidate",
            candidate_email="migration.candidate@example.com",
            candidate_phone_number="+201001111111",
            nationality="Egyptian",
            date_of_birth="1990-02-03",
            proposed_salary=Decimal("10000.00"),
            cv_file="hiring_request_cvs/migration-candidate.pdf",
            status="converted",
            requested_by=user,
            submitted_at=decided_at - timedelta(days=1),
            ceo_decision_by=user,
            ceo_decision_at=decided_at,
            ceo_decision_note="Approved before migration",
            created_by=user,
            updated_by=user,
        )
        offer = JobOffer.objects.create(
            company=company,
            hiring_request=hiring_request,
            candidate_full_name="Migration Candidate",
            candidate_email="migration.candidate@example.com",
            position_title="Engineer",
            expiry_date=timezone.localdate() + timedelta(days=7),
            reference_number="JO-MIGRATION-0001",
            hr_signer_user=user,
            created_by=user,
            updated_by=user,
        )
        content_type, _ = ContentType.objects.get_or_create(app_label="job_offers", model="hiringrequest")
        definition = WorkflowDefinition.objects.create(
            key="hiring_request", name="Hiring Request Workflow", module_key="job_offers"
        )
        WorkflowInstance.objects.create(
            definition=definition,
            content_type=content_type,
            object_id=hiring_request.id,
            status="approved",
        )
        Notification.objects.create(
            recipient=user,
            company=company,
            title="Old hiring request",
            event_key="hiring_request.approved",
            related_object_type="job_offers.hiringrequest",
            related_object_id=str(hiring_request.id),
        )
        return offer.id

    def test_linked_offer_survives_with_cv_identity_and_approval_history(self):
        JobOffer = self.new_apps.get_model("job_offers", "JobOffer")
        offer = JobOffer.objects.get(pk=self.offer_id)
        self.assertEqual(offer.approval_status, "approved")
        self.assertEqual(offer.date_of_birth.isoformat(), "1990-02-03")
        self.assertEqual(offer.cv_file.name, "hiring_request_cvs/migration-candidate.pdf")
        self.assertEqual(offer.ceo_decision_reason, "Approved before migration")
        self.assertEqual([event["type"] for event in offer.approval_events], ["submit", "approve"])
        with self.assertRaises(FieldDoesNotExist):
            JobOffer._meta.get_field("hiring_request")

    def test_hiring_request_table_and_stale_workflow_notifications_are_removed(self):
        with self.assertRaises(LookupError):
            self.new_apps.get_model("job_offers", "HiringRequest")
        self.assertNotIn("job_offers_hiringrequest", connection.introspection.table_names())
        ContentType = self.new_apps.get_model("contenttypes", "ContentType")
        WorkflowDefinition = self.new_apps.get_model("core", "WorkflowDefinition")
        Notification = self.new_apps.get_model("in_app_notifications", "Notification")
        self.assertFalse(ContentType.objects.filter(app_label="job_offers", model="hiringrequest").exists())
        self.assertFalse(WorkflowDefinition.objects.filter(key="hiring_request").exists())
        self.assertFalse(Notification.objects.filter(event_key__startswith="hiring_request.").exists())
