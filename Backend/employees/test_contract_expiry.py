from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.test import TestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from organization.models import OrganizationNode, UserOrganizationAccess

from .contract_expiry import (
    auto_renew_decision,
    ensure_contract_decision,
    finalize_decision,
    notify_hr_final,
    notify_manual_resolution,
    process_contract_expiry,
    submit_decision,
)
from .models import ContractDecision, EmployeeProfile

User = get_user_model()


class ContractExpiryWorkflowTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.company = OrganizationNode.objects.create(
            code="CONTRACT-TEST",
            name="Contract Test Company",
            node_type=OrganizationNode.NodeType.COMPANY,
            is_active=True,
        )
        self.hr = User.objects.create_user(email="contract-hr@example.com", password="password")
        self.hr.groups.add(Group.objects.create(name="HRManager"))
        self.ceo = User.objects.create_user(email="contract-ceo@example.com", password="password")
        self.ceo.groups.add(Group.objects.create(name="CEO"))
        self.ceo_profile = EmployeeProfile.objects.create(
            user=self.ceo,
            company=self.company,
            employee_id="CONTRACT-CEO",
            full_name="Contract CEO",
        )
        UserOrganizationAccess.objects.create(user=self.hr, organization=self.company)
        self.employee = User.objects.create_user(email="contract-employee@example.com", password="password")
        self.profile = EmployeeProfile.objects.create(
            user=self.employee,
            company=self.company,
            employee_id="CONTRACT-001",
            full_name="Contract Employee",
            contract_date=timezone.localdate() - timedelta(days=365),
            contract_expiry=timezone.localdate() + timedelta(days=90),
            basic_salary=Decimal("1000.00"),
            transportation_allowance=Decimal("100.00"),
            accommodation_allowance=Decimal("200.00"),
        )

    @patch("employees.contract_expiry.notify_hr_milestone")
    def test_milestones_are_created_once(self, notify):
        notify.return_value = 0
        today = self.profile.contract_expiry - timedelta(days=90)
        process_contract_expiry(today=today, now=timezone.now())
        process_contract_expiry(today=today, now=timezone.now())

        decision = ContractDecision.objects.get(employee_profile=self.profile)
        self.assertEqual(notify.call_count, 1)
        self.assertIn("90_DAY", decision.notification_milestones)

    @patch("employees.contract_expiry.notify_hr_milestone")
    def test_failed_milestone_persistence_is_retried(self, notify):
        notify.return_value = None
        today = self.profile.contract_expiry - timedelta(days=90)

        process_contract_expiry(today=today, now=timezone.now())
        decision = ContractDecision.objects.get(employee_profile=self.profile)

        self.assertEqual(notify.call_count, 1)
        self.assertNotIn("90_DAY", decision.notification_milestones)

    @patch("employees.contract_expiry.notify_ceo_pending")
    def test_hr_submission_enters_ceo_workflow_and_can_be_approved(self, notify):
        decision, _ = ensure_contract_decision(self.profile)
        submitted = submit_decision(
            decision.id,
            actor=self.hr,
            decision_type=ContractDecision.DecisionType.RENEW,
            proposed_contract_expiry=self.profile.contract_expiry + timedelta(days=365),
        )
        self.assertEqual(submitted.status, ContractDecision.Status.PENDING_CEO)
        self.assertEqual(submitted.ceo_reminder_count, 1)
        notify.assert_called_once_with(submitted)

        approved = finalize_decision(submitted.id, actor=self.ceo, comment="Approved")
        self.profile.refresh_from_db()
        self.assertEqual(approved.status, ContractDecision.Status.APPROVED)
        self.assertEqual(self.profile.contract_expiry, submitted.proposed_contract_expiry)

    def test_renewal_with_changes_preserves_and_updates_terms(self):
        decision, _ = ensure_contract_decision(self.profile)
        submitted = submit_decision(
            decision.id,
            actor=self.hr,
            decision_type=ContractDecision.DecisionType.RENEW_WITH_CHANGES,
            proposed_terms={"basic_salary": "1500.00"},
        )

        approved = finalize_decision(submitted.id, actor=self.ceo)
        self.profile.refresh_from_db()

        self.assertEqual(approved.status, ContractDecision.Status.APPROVED)
        self.assertEqual(self.profile.basic_salary, Decimal("1500.00"))
        self.assertEqual(self.profile.transportation_allowance, Decimal("100.00"))

    def test_proposed_expiry_before_implicit_start_is_rejected(self):
        decision, _ = ensure_contract_decision(self.profile)

        with self.assertRaisesMessage(ValueError, "Proposed contract expiry"):
            submit_decision(
                decision.id,
                actor=self.hr,
                decision_type=ContractDecision.DecisionType.RENEW,
                proposed_contract_expiry=self.profile.contract_expiry,
            )

        decision.refresh_from_db()
        self.assertEqual(decision.status, ContractDecision.Status.PENDING_HR)

    @patch("employees.contract_expiry._dispatch")
    def test_stale_ceo_approval_requires_manual_resolution(self, dispatch):
        decision, _ = ensure_contract_decision(self.profile)
        submit_decision(decision.id, actor=self.hr, decision_type=ContractDecision.DecisionType.RENEW)
        original_expiry = self.profile.contract_expiry
        self.profile.basic_salary = Decimal("1200.00")
        self.profile.save(update_fields=["basic_salary", "updated_at"])

        result = finalize_decision(decision.id, actor=self.ceo)

        self.profile.refresh_from_db()
        self.assertEqual(result.status, ContractDecision.Status.MANUAL_RESOLUTION_REQUIRED)
        self.assertEqual(self.profile.contract_expiry, original_expiry)
        self.assertIsNone(result.final_notification_sent_at)

        dispatch.return_value = {"notification": object(), "created": True}
        self.assertEqual(notify_manual_resolution(result), 2)
        result.refresh_from_db()
        self.assertIsNotNone(result.final_notification_sent_at)

    @patch("employees.contract_expiry._dispatch")
    def test_final_notification_retries_after_a_delivery_failure(self, dispatch):
        decision, _ = ensure_contract_decision(self.profile)
        submit_decision(decision.id, actor=self.hr, decision_type=ContractDecision.DecisionType.RENEW)
        finalized = finalize_decision(decision.id, actor=self.ceo)

        dispatch.return_value = {"notification": None, "created": False}
        self.assertIsNone(notify_hr_final(finalized))
        finalized.refresh_from_db()
        self.assertEqual(finalized.final_notification_attempts, 1)
        self.assertIsNone(finalized.final_notification_sent_at)

        finalized.last_final_notification_attempt_at = timezone.now() - timedelta(hours=2)
        finalized.save(update_fields=["last_final_notification_attempt_at", "updated_at"])
        dispatch.return_value = {"notification": object(), "created": True}
        self.assertEqual(notify_hr_final(finalized), 1)
        finalized.refresh_from_db()
        self.assertEqual(finalized.final_notification_attempts, 2)
        self.assertIsNotNone(finalized.final_notification_sent_at)

    @patch("employees.contract_expiry.notify_ceo_pending")
    def test_ceo_reminder_is_persisted_once_per_interval(self, notify):
        notify.return_value = 0
        decision, _ = ensure_contract_decision(self.profile)
        submit_decision(decision.id, actor=self.hr, decision_type=ContractDecision.DecisionType.RENEW)
        notify.reset_mock()
        decision.refresh_from_db()
        decision.last_ceo_reminder_at = timezone.now() - timedelta(hours=11)
        decision.save(update_fields=["last_ceo_reminder_at", "updated_at"])

        now = timezone.now()
        process_contract_expiry(today=timezone.localdate(), now=now)
        process_contract_expiry(today=timezone.localdate(), now=now)

        decision.refresh_from_db()
        self.assertEqual(notify.call_count, 1)
        self.assertEqual(decision.ceo_reminder_count, 2)

    @patch("employees.contract_expiry.notify_hr_final")
    def test_pending_ceo_decision_auto_approves_after_48_hours(self, notify):
        decision, _ = ensure_contract_decision(self.profile)
        submit_decision(decision.id, actor=self.hr, decision_type=ContractDecision.DecisionType.RENEW)
        decision.refresh_from_db()
        decision.ceo_deadline = timezone.now() - timedelta(minutes=1)
        decision.save(update_fields=["ceo_deadline", "updated_at"])

        summary = process_contract_expiry(today=timezone.localdate(), now=timezone.now())

        decision.refresh_from_db()
        self.assertEqual(decision.status, ContractDecision.Status.AUTO_APPROVED)
        self.assertEqual(summary["auto_approved"], 1)
        notify.assert_called_once()

    @patch("employees.contract_expiry.notify_hr_final")
    def test_no_hr_action_auto_renews_and_is_idempotent(self, notify):
        self.profile.contract_expiry = timezone.localdate()
        self.profile.save(update_fields=["contract_expiry", "updated_at"])
        decision, _ = ensure_contract_decision(self.profile)

        first, changed = auto_renew_decision(decision.id)
        second, changed_again = auto_renew_decision(decision.id)

        self.profile.refresh_from_db()
        self.assertTrue(changed)
        self.assertFalse(changed_again)
        self.assertEqual(first.status, ContractDecision.Status.AUTO_RENEWED)
        self.assertEqual(second.status, ContractDecision.Status.AUTO_RENEWED)
        self.assertTrue(first.automatic_renewal)
        self.assertEqual(first.automatic_renewal_reason, "HR took no action before contract expiry.")
        self.assertEqual(self.profile.contract_date, timezone.localdate() + timedelta(days=1))
        self.assertEqual(self.profile.contract_expiry, timezone.localdate() + timedelta(days=365))

    @patch("employees.contract_expiry.notify_manual_resolution")
    def test_invalid_original_duration_fails_without_changing_profile(self, notify_failure):
        self.profile.contract_expiry = timezone.localdate()
        self.profile.contract_date = timezone.localdate()
        self.profile.save(update_fields=["contract_date", "contract_expiry", "updated_at"])
        decision, _ = ensure_contract_decision(self.profile)

        process_contract_expiry(today=timezone.localdate(), now=timezone.now())
        result = ContractDecision.objects.get(pk=decision.pk)

        self.profile.refresh_from_db()
        self.assertEqual(result.status, ContractDecision.Status.AUTO_RENEWAL_FAILED)
        self.assertEqual(self.profile.contract_expiry, decision.original_contract_expiry)
        notify_failure.assert_called_once()

    def test_approved_termination_archives_and_disables_login(self):
        decision, _ = ensure_contract_decision(self.profile)
        submit_decision(decision.id, actor=self.hr, decision_type=ContractDecision.DecisionType.TERMINATE)

        finalize_decision(decision.id, actor=self.ceo)

        self.profile.refresh_from_db()
        self.employee.refresh_from_db()
        self.assertTrue(self.profile.is_archived)
        self.assertEqual(self.profile.archive_reason, EmployeeProfile.ArchiveReason.END_OF_CONTRACT)
        self.assertFalse(self.employee.is_active)

    def test_contract_decision_api_enforces_roles_and_ceo_approval(self):
        self.client.force_authenticate(user=self.hr)
        response = self.client.post(
            f"/api/employees/{self.profile.id}/contract-decisions/",
            {"decision_type": ContractDecision.DecisionType.RENEW},
            format="json",
            secure=True,
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        decision_id = response.data["data"]["id"]
        self.assertEqual(response.data["data"]["status"], ContractDecision.Status.PENDING_CEO)

        self.client.force_authenticate(user=self.employee)
        forbidden = self.client.post(
            f"/api/employees/contract-decisions/{decision_id}/approve/", {}, format="json", secure=True
        )
        self.assertEqual(forbidden.status_code, status.HTTP_403_FORBIDDEN)

        self.client.force_authenticate(user=self.ceo)
        pending = self.client.get("/api/employees/contract-decisions/?status=PENDING_CEO", secure=True)
        self.assertEqual(pending.status_code, status.HTTP_200_OK)
        self.assertEqual(pending.data["data"]["items"][0]["id"], decision_id)
        approved = self.client.post(
            f"/api/employees/contract-decisions/{decision_id}/approve/",
            {"comment": "Approved through API"},
            format="json",
            secure=True,
        )
        self.assertEqual(approved.status_code, status.HTTP_200_OK)
        self.assertEqual(approved.data["data"]["status"], ContractDecision.Status.APPROVED)

        duplicate = self.client.post(
            f"/api/employees/contract-decisions/{decision_id}/approve/",
            {},
            format="json",
            secure=True,
        )
        self.assertEqual(duplicate.status_code, status.HTTP_403_FORBIDDEN)

    def test_contract_decision_api_is_tenant_scoped(self):
        other_company = OrganizationNode.objects.create(
            code="CONTRACT-OTHER",
            name="Other Contract Company",
            node_type=OrganizationNode.NodeType.COMPANY,
            is_active=True,
        )
        other_hr = User.objects.create_user(email="other-contract-hr@example.com", password="password")
        other_hr.groups.add(Group.objects.get(name="HRManager"))
        UserOrganizationAccess.objects.create(user=other_hr, organization=other_company)

        self.client.force_authenticate(user=other_hr)
        response = self.client.post(
            f"/api/employees/{self.profile.id}/contract-decisions/",
            {"decision_type": ContractDecision.DecisionType.TERMINATE},
            format="json",
            secure=True,
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
