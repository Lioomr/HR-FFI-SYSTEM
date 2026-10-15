from datetime import timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.test import TestCase
from django.utils import timezone
from in_app_notifications.models import Notification
from organization.models import OrganizationNode, UserOrganizationAccess
from rest_framework import status
from rest_framework.test import APIClient

from .contract_expiry import EXECUTIVE_CONTRACT_MESSAGE, ensure_contract_decision, process_contract_expiry
from .models import ContractDecision, EmployeeProfile

User = get_user_model()


class ExecutiveContractExpiryTests(TestCase):
    """Executives (CEO, General Manager) get no decision: HR is only informed as the contract nears its end."""

    def setUp(self):
        self.company = OrganizationNode.objects.create(
            code="EXEC-CONTRACT", name="Exec Contract", node_type=OrganizationNode.NodeType.COMPANY, is_active=True
        )
        self.hr = User.objects.create_user(email="exec-contract-hr@example.com", password="password")
        self.hr.groups.add(Group.objects.get_or_create(name="HRManager")[0])
        UserOrganizationAccess.objects.create(user=self.hr, organization=self.company)
        self.ceo = User.objects.create_user(email="exec-contract-ceo@example.com", password="password")
        self.ceo.groups.add(Group.objects.get_or_create(name="CEO")[0])
        self.ceo_profile = self._profile("EXEC-C-CEO", user=self.ceo)
        self.gm = self._profile("EXEC-C-GM", job_title="General Manager")
        self.expiry = self.gm.contract_expiry

    def _profile(self, employee_id, *, user=None, job_title="Staff"):
        return EmployeeProfile.objects.create(
            user=user,
            company=self.company,
            employee_id=employee_id,
            full_name=employee_id,
            job_title=job_title,
            contract_date=timezone.localdate() - timedelta(days=275),
            contract_expiry=timezone.localdate() + timedelta(days=90),
            basic_salary=Decimal("1000.00"),
            total_salary=Decimal("1000.00"),
        )

    def test_hr_gets_one_informational_notice_per_milestone_and_no_decision(self):
        for days_left in (90, 90, 65, 59, 30):
            process_contract_expiry(today=self.expiry - timedelta(days=days_left), now=timezone.now())

        self.assertFalse(ContractDecision.objects.exists())
        notices = Notification.objects.filter(recipient=self.hr, event_key="contract.expiry").order_by("id")
        gm_notices = [notice for notice in notices if notice.metadata.get("employee_profile_id") == self.gm.id]
        self.assertEqual([notice.metadata["milestone"] for notice in gm_notices], ["90_DAY", "65_DAY"])
        for notice in gm_notices:
            self.assertTrue(notice.action_url.startswith(f"/hr/employees/{self.gm.id}"))
            self.assertFalse(notice.metadata["requires_action"])
            self.assertEqual(notice.metadata["i18n"]["key"], "contract.executive_expiry_notice")
            self.assertNotIn("action required", notice.title.lower())
        self.assertEqual(
            gm_notices[0].deduplication_key, f"contract.expiry:top_tier:{self.gm.id}:{self.expiry.isoformat()}:90_DAY"
        )
        self.gm.refresh_from_db()
        self.assertEqual(self.gm.contract_expiry, self.expiry)

    def test_legacy_open_decision_is_cancelled_and_never_auto_renewed(self):
        decision = ContractDecision.objects.create(
            employee_profile=self.ceo_profile,
            company=self.company,
            original_contract_date=self.ceo_profile.contract_date,
            original_contract_expiry=self.ceo_profile.contract_expiry,
            status=ContractDecision.Status.PENDING_HR,
        )

        summary = process_contract_expiry(today=self.expiry - timedelta(days=59), now=timezone.now())
        process_contract_expiry(today=self.expiry - timedelta(days=59), now=timezone.now())

        decision.refresh_from_db()
        self.ceo_profile.refresh_from_db()
        self.assertEqual(summary["cancelled"], 1)
        self.assertEqual(summary["auto_renewed"], 0)
        self.assertEqual(decision.status, ContractDecision.Status.CANCELLED)
        self.assertEqual(decision.failure_reason, EXECUTIVE_CONTRACT_MESSAGE)
        self.assertEqual(self.ceo_profile.contract_expiry, self.expiry)
        with self.assertRaisesMessage(ValueError, EXECUTIVE_CONTRACT_MESSAGE):
            ensure_contract_decision(self.ceo_profile)

    def test_hr_cannot_submit_a_contract_decision_for_an_executive(self):
        client = APIClient()
        client.force_authenticate(self.hr)
        client.credentials(HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id))
        response = client.post(
            f"/api/employees/{self.gm.id}/contract-decisions/", {"decision_type": "RENEW"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY, response.data)
        self.assertIn(EXECUTIVE_CONTRACT_MESSAGE, str(response.data))
        self.assertFalse(ContractDecision.objects.exists())
