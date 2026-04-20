from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.contrib.contenttypes.models import ContentType
from django.test import TestCase
from django.utils import timezone

from assets.models import Asset, AssetAssignment
from core.models import DelegationRule, RequestObligation, WorkflowDefinition, WorkflowInstance
from core.services import BUSINESS_TRIP_CODE, sync_leave_obligations
from employees.models import EmployeeProfile
from leaves.models import LeaveRequest, LeaveType
from organization.models import OrganizationNode

User = get_user_model()


class BusinessTripObligationsTests(TestCase):
    def setUp(self):
        self.company = OrganizationNode.objects.create(
            code="BT-COMP",
            name="Business Trip Co",
            node_type=OrganizationNode.NodeType.COMPANY,
        )
        self.employee_group, _ = Group.objects.get_or_create(name="Employee")

        self.employee = User.objects.create_user(email="traveller@example.com", password="password")
        self.employee.groups.add(self.employee_group)
        self.delegate = User.objects.create_user(email="delegate@example.com", password="password")
        self.delegate.groups.add(self.employee_group)

        self.profile = EmployeeProfile.objects.create(
            user=self.employee,
            company=self.company,
            employee_id="BT-EMP-001",
            full_name="Business Traveller",
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        )
        self.business_trip_type = LeaveType.objects.create(
            company=self.company,
            name="Business Trip",
            code=BUSINESS_TRIP_CODE,
            requires_ceo_approval=True,
        )
        self.annual_type = LeaveType.objects.create(company=self.company, name="Annual", code="ANNUAL")

    def _leave(self, leave_type=None, **extra):
        start_date = timezone.localdate() + timedelta(days=10)
        defaults = {
            "employee": self.employee,
            "employee_profile": self.profile,
            "company": self.company,
            "leave_type": leave_type or self.business_trip_type,
            "start_date": start_date,
            "end_date": start_date + timedelta(days=3),
            "status": LeaveRequest.RequestStatus.PENDING_CEO,
            "reason": "Trip",
        }
        defaults.update(extra)
        return LeaveRequest.objects.create(**defaults)

    def test_normal_leave_creates_no_business_trip_obligations(self):
        leave_request = self._leave(leave_type=self.annual_type)

        summary = sync_leave_obligations(leave_request, actor=self.employee)

        self.assertEqual(summary["total"], 0)
        self.assertFalse(
            RequestObligation.objects.filter(parent_object_id=leave_request.pk).exists()
        )

    def test_business_trip_asset_obligation_resolves_after_assignment_return(self):
        asset = Asset.objects.create(
            company=self.company,
            name_en="Travel Laptop",
            type=Asset.AssetType.OTHER,
            status=Asset.AssetStatus.ASSIGNED,
            flexible_attributes={"category": "laptop"},
            must_return_before_travel=True,
        )
        assignment = AssetAssignment.objects.create(
            asset=asset,
            employee=self.profile,
            assigned_by=self.employee,
            is_active=True,
        )
        leave_request = self._leave()

        summary = sync_leave_obligations(leave_request, actor=self.employee)

        self.assertEqual(summary["blocking_open"], 1)
        obligation = RequestObligation.objects.get(
            parent_object_id=leave_request.pk,
            type=RequestObligation.ObligationType.ASSET_RETURN,
        )
        self.assertEqual(obligation.status, RequestObligation.Status.OPEN)
        self.assertEqual(obligation.company, self.company)

        assignment.is_active = False
        assignment.returned_at = timezone.now()
        assignment.save(update_fields=["is_active", "returned_at", "updated_at"])
        asset.status = Asset.AssetStatus.AVAILABLE
        asset.save(update_fields=["status", "updated_at"])

        summary = sync_leave_obligations(leave_request, actor=self.employee)

        obligation.refresh_from_db()
        self.assertEqual(summary["blocking_open"], 0)
        self.assertEqual(obligation.status, RequestObligation.Status.RESOLVED)

    def test_pending_approval_obligation_resolves_when_delegate_covers_trip(self):
        other_leave = self._leave(
            leave_type=self.annual_type,
            start_date=date.today() + timedelta(days=1),
            end_date=date.today() + timedelta(days=2),
        )
        definition = WorkflowDefinition.objects.create(
            key="business_trip_test",
            name="Business Trip Test",
            module_key="leaves",
        )
        WorkflowInstance.objects.create(
            definition=definition,
            content_type=ContentType.objects.get_for_model(LeaveRequest),
            object_id=other_leave.pk,
            status=WorkflowInstance.Status.IN_REVIEW,
            current_stage="manager",
            current_approver_role="manager",
            current_actor_user=self.employee,
            submitted_by=self.delegate,
        )
        leave_request = self._leave()

        summary = sync_leave_obligations(leave_request, actor=self.employee)

        self.assertEqual(summary["blocking_open"], 1)
        obligation = RequestObligation.objects.get(
            parent_object_id=leave_request.pk,
            type=RequestObligation.ObligationType.PENDING_APPROVALS,
        )
        self.assertEqual(obligation.status, RequestObligation.Status.OPEN)

        leave_request.delegated_to = self.delegate
        leave_request.save(update_fields=["delegated_to", "updated_at"])

        summary = sync_leave_obligations(leave_request, actor=self.employee)

        obligation.refresh_from_db()
        self.assertEqual(summary["blocking_open"], 0)
        self.assertEqual(obligation.status, RequestObligation.Status.RESOLVED)
        self.assertTrue(
            DelegationRule.objects.filter(
                from_user=self.employee,
                to_user=self.delegate,
                is_active=True,
            ).exists()
        )
