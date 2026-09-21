from datetime import date
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.contenttypes.models import ContentType
from django.core.exceptions import ValidationError
from rest_framework import status
from rest_framework.test import APITestCase

from core.models import WorkflowAction
from employees.models import EmployeeProfile
from leaves.models import LeaveRequest, LeaveType
from leaves.services import (
    DELEGATE_NOT_ASSIGNABLE_MESSAGE,
    DELEGATE_UNAVAILABLE_MESSAGE,
    SELF_DELEGATE_MESSAGE,
    LeaveTransitionError,
    apply_delegate_approval,
    apply_delegate_assignment,
)
from organization.models import OrganizationNode
from organization.services import get_default_company

User = get_user_model()

Status = LeaveRequest.RequestStatus
REQUESTS_URL = "/api/leaves/leave-requests/"


class LateAlternativeEmployeeTests(APITestCase):
    def setUp(self):
        self.company = get_default_company()
        self.leave_type, _ = LeaveType.objects.get_or_create(
            company=self.company, code="ANNUAL", defaults={"name": "Annual Leave", "is_active": True}
        )
        self.employee = self._user("late-delegate-employee@example.com", "EMP-LATE-1")
        self.delegate = self._user("late-delegate-delegate@example.com", "EMP-LATE-2")
        self.replacement = self._user("late-delegate-replacement@example.com", "EMP-LATE-3")

    def _user(self, email, employee_id):
        user = User.objects.create_user(email=email, password="password")
        EmployeeProfile.objects.create(
            user=user,
            company=self.company,
            employee_id=employee_id,
            department="Ops",
            job_title="Staff",
            hire_date=date(2021, 1, 1),
        )
        return user

    def _leave(self, *, status):
        return LeaveRequest.objects.create(
            employee=self.employee,
            employee_profile=self.employee.employee_profile,
            company=self.company,
            leave_type=self.leave_type,
            start_date=date(2027, 6, 1),
            end_date=date(2027, 6, 3),
            status=status,
        )

    def test_added_alternative_employee_approves_before_request_returns_to_its_stage(self):
        leave = self._leave(status=Status.PENDING_CEO)

        transition = apply_delegate_assignment(leave, actor=self.employee, delegated_to=self.delegate, note="Cover me")

        leave.refresh_from_db()
        self.assertEqual(transition.from_status, Status.PENDING_CEO)
        self.assertEqual(
            (leave.status, leave.delegate_return_status, leave.delegated_to, leave.delegation_note),
            (Status.PENDING_DELEGATE, Status.PENDING_CEO, self.delegate, "Cover me"),
        )
        assignment = WorkflowAction.objects.get(
            workflow__content_type=ContentType.objects.get_for_model(LeaveRequest),
            workflow__object_id=leave.id,
            action=WorkflowAction.Action.REASSIGN,
        )
        self.assertEqual((assignment.from_stage, assignment.to_stage), ("ceo", "delegate"))

        apply_delegate_approval(leave, actor=self.delegate)

        leave.refresh_from_db()
        self.assertEqual((leave.status, leave.delegate_return_status), (Status.PENDING_CEO, ""))

    def test_replacing_alternative_employee_keeps_the_return_stage(self):
        leave = self._leave(status=Status.PENDING_HR)
        apply_delegate_assignment(leave, actor=self.employee, delegated_to=self.delegate)

        apply_delegate_assignment(leave, actor=self.employee, delegated_to=self.replacement)

        leave.refresh_from_db()
        self.assertEqual(
            (leave.status, leave.delegate_return_status, leave.delegated_to),
            (Status.PENDING_DELEGATE, Status.PENDING_HR, self.replacement),
        )

    def test_alternative_employee_cannot_be_added_once_decided_or_be_the_requester(self):
        for current in (Status.PENDING_HR_COMPLETION, Status.APPROVED, Status.REJECTED, Status.CANCELLED):
            with self.subTest(status=current):
                with self.assertRaisesMessage(LeaveTransitionError, DELEGATE_NOT_ASSIGNABLE_MESSAGE):
                    apply_delegate_assignment(
                        self._leave(status=current), actor=self.employee, delegated_to=self.delegate
                    )

        with self.assertRaisesMessage(LeaveTransitionError, SELF_DELEGATE_MESSAGE):
            apply_delegate_assignment(
                self._leave(status=Status.PENDING_HR), actor=self.employee, delegated_to=self.employee
            )

    def test_alternative_employee_can_belong_to_another_company(self):
        other_company = OrganizationNode.objects.create(
            code="LATE-DELEGATE-OTHER",
            name="Late Delegate Other",
            node_type=OrganizationNode.NodeType.COMPANY,
        )
        cross_company_delegate = User.objects.create_user(
            email="late-delegate-cross-company@example.com",
            password="password",
        )
        EmployeeProfile.objects.create(
            user=cross_company_delegate,
            company=other_company,
            employee_id="EMP-LATE-CROSS",
            full_name="Cross Company Delegate",
            department="Ops",
            job_title="Staff",
            hire_date=date(2021, 1, 1),
        )
        leave = self._leave(status=Status.PENDING_HR)

        transition = apply_delegate_assignment(
            leave,
            actor=self.employee,
            delegated_to=cross_company_delegate,
            note="Cross-company coverage",
        )

        leave.refresh_from_db()
        self.assertEqual(transition.from_status, Status.PENDING_HR)
        self.assertEqual(leave.status, Status.PENDING_DELEGATE)
        self.assertEqual(leave.delegated_to, cross_company_delegate)

    def test_alternative_employee_must_be_active_and_linked(self):
        inactive_user = User.objects.create_user(
            email="late-delegate-inactive@example.com",
            password="password",
            is_active=False,
        )
        EmployeeProfile.objects.create(
            user=inactive_user,
            company=self.company,
            employee_id="EMP-LATE-INACTIVE",
            full_name="Inactive Delegate",
            department="Ops",
            job_title="Staff",
            hire_date=date(2021, 1, 1),
        )
        unlinked_user = User.objects.create_user(email="late-delegate-unlinked@example.com", password="password")

        for delegate in (inactive_user, unlinked_user):
            with self.subTest(delegate=delegate.email):
                with self.assertRaisesMessage(LeaveTransitionError, DELEGATE_UNAVAILABLE_MESSAGE):
                    apply_delegate_assignment(
                        self._leave(status=Status.PENDING_HR), actor=self.employee, delegated_to=delegate
                    )

    @patch("leaves.services.notify_delegation_assigned")
    def test_set_delegate_endpoint_sends_request_to_alternative_employee(self, notify):
        leave = self._leave(status=Status.PENDING_HR)
        self.client.force_authenticate(user=self.employee)

        response = self.client.post(
            f"{REQUESTS_URL}{leave.id}/set-delegate/",
            {"delegated_to": self.delegate.id, "delegation_note": "Please cover"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data["data"]["status"], Status.PENDING_DELEGATE)
        notify.assert_called_once()


class CrossCompanyAlternativeEmployeeAPITests(APITestCase):
    def setUp(self):
        self.company = OrganizationNode.objects.create(
            code="LEAVE-DELEGATOR-CO",
            name="Leave Delegator Co",
            node_type=OrganizationNode.NodeType.COMPANY,
        )
        self.delegate_company = OrganizationNode.objects.create(
            code="LEAVE-DELEGATE-CO",
            name="Leave Delegate Co",
            node_type=OrganizationNode.NodeType.COMPANY,
        )
        self.leave_type = LeaveType.objects.create(
            company=self.company,
            code="ANNUAL",
            name="Annual Leave",
            is_active=True,
        )
        self.employee = self._user("leave-cross-employee@example.com", self.company, "EMP-XCO-1")
        self.delegate = self._user("leave-cross-delegate@example.com", self.delegate_company, "EMP-XCO-2")
        self.other_delegate = self._user("leave-cross-other@example.com", self.delegate_company, "EMP-XCO-3")

    def _user(self, email, company, employee_id, *, is_active=True, employment_status=None):
        user = User.objects.create_user(email=email, password="password", is_active=is_active)
        EmployeeProfile.objects.create(
            user=user,
            company=company,
            employee_id=employee_id,
            full_name=email.split("@")[0],
            department="Ops",
            job_title="Staff",
            hire_date=date(2021, 1, 1),
            employment_status=employment_status or EmployeeProfile.EmploymentStatus.ACTIVE,
        )
        return user

    def _pending_delegated_leave(self, delegate=None):
        return LeaveRequest.objects.create(
            employee=self.employee,
            employee_profile=self.employee.employee_profile,
            company=self.company,
            leave_type=self.leave_type,
            start_date=date(2027, 7, 1),
            end_date=date(2027, 7, 3),
            status=Status.PENDING_DELEGATE,
            delegated_to=delegate or self.delegate,
            delegation_note="Please cover while I am away.",
        )

    @patch("leaves.views.notify_delegation_assigned")
    def test_employee_can_create_leave_with_cross_company_delegate(self, notify):
        self.client.force_authenticate(user=self.employee)

        response = self.client.post(
            REQUESTS_URL,
            {
                "leave_type": self.leave_type.id,
                "start_date": "2027-07-01",
                "end_date": "2027-07-03",
                "reason": "Family trip",
                "delegated_to": self.delegate.id,
                "delegation_note": "Cross-company coverage",
            },
            format="json",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(response.data["data"]["status"], Status.PENDING_DELEGATE)
        self.assertEqual(response.data["data"]["delegated_to"]["id"], self.delegate.id)
        self.assertEqual(response.data["data"]["company_id"], self.company.id)
        notify.assert_called_once()

    def test_cross_company_delegate_can_list_and_retrieve_only_assigned_requests(self):
        assigned = self._pending_delegated_leave()
        other_assigned = self._pending_delegated_leave(delegate=self.other_delegate)
        self.client.force_authenticate(user=self.delegate)

        inbox_response = self.client.get("/api/leaves/employee/delegated-leave-requests/")
        detail_response = self.client.get(f"{REQUESTS_URL}{assigned.id}/")
        other_detail_response = self.client.get(f"{REQUESTS_URL}{other_assigned.id}/")

        self.assertEqual(inbox_response.status_code, status.HTTP_200_OK, inbox_response.data)
        self.assertEqual([item["id"] for item in inbox_response.data["data"]["items"]], [assigned.id])
        self.assertEqual(detail_response.status_code, status.HTTP_200_OK, detail_response.data)
        self.assertEqual(detail_response.data["data"]["id"], assigned.id)
        self.assertEqual(other_detail_response.status_code, status.HTTP_404_NOT_FOUND)

    def test_cross_company_delegate_can_approve_and_reject_assigned_request(self):
        approval = self._pending_delegated_leave()
        rejection = self._pending_delegated_leave()
        self.client.force_authenticate(user=self.delegate)

        approve_response = self.client.post(f"{REQUESTS_URL}{approval.id}/delegate-approve/", {}, format="json")
        reject_response = self.client.post(
            f"{REQUESTS_URL}{rejection.id}/delegate-reject/",
            {"comment": "Coverage conflict"},
            format="json",
        )

        self.assertEqual(approve_response.status_code, status.HTTP_200_OK, approve_response.data)
        approval.refresh_from_db()
        self.assertEqual(approval.status, Status.PENDING_HR)
        self.assertEqual(approval.delegate_decision_by, self.delegate)
        self.assertEqual(reject_response.status_code, status.HTTP_200_OK, reject_response.data)
        rejection.refresh_from_db()
        self.assertEqual(rejection.status, Status.REJECTED)
        self.assertEqual(rejection.delegate_decision_by, self.delegate)

    def test_cross_company_delegate_cannot_act_on_unassigned_request(self):
        leave = self._pending_delegated_leave(delegate=self.other_delegate)
        self.client.force_authenticate(user=self.delegate)

        response = self.client.post(f"{REQUESTS_URL}{leave.id}/delegate-approve/", {}, format="json")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_inactive_and_unlinked_delegates_are_rejected_by_api(self):
        inactive = self._user(
            "leave-cross-inactive@example.com",
            self.delegate_company,
            "EMP-XCO-INACTIVE",
            is_active=False,
        )
        unlinked = User.objects.create_user(email="leave-cross-unlinked@example.com", password="password")
        self.client.force_authenticate(user=self.employee)

        for delegate in (inactive, unlinked):
            with self.subTest(delegate=delegate.email):
                response = self.client.post(
                    REQUESTS_URL,
                    {
                        "leave_type": self.leave_type.id,
                        "start_date": "2027-08-01",
                        "end_date": "2027-08-02",
                        "reason": "Coverage check",
                        "delegated_to": delegate.id,
                    },
                    format="json",
                    HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
                )

                self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY, response.data)

    def test_model_rejects_inactive_delegate_even_without_serializer(self):
        inactive = self._user(
            "leave-cross-model-inactive@example.com",
            self.delegate_company,
            "EMP-XCO-MODEL-INACTIVE",
            is_active=False,
        )

        with self.assertRaises(ValidationError):
            self._pending_delegated_leave(delegate=inactive)
