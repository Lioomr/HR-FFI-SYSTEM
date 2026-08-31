from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.test import TransactionTestCase

from attendance.models import BioTimeEmployeeMap
from employees.models import EmployeeProfile
from leaves.models import (
    AnnualLeavePaymentRequest,
    LeaveBalanceAdjustment,
    LeaveBalanceSnapshot,
    LeaveRequest,
    LeaveType,
)
from organization.models import OrganizationNode

User = get_user_model()


class DatabaseTenantIntegrityTests(TransactionTestCase):
    def setUp(self):
        self.company_a = OrganizationNode.objects.create(
            code="DB_SCOPE_A",
            name="Database Scope A",
            node_type=OrganizationNode.NodeType.COMPANY,
        )
        self.company_b = OrganizationNode.objects.create(
            code="DB_SCOPE_B",
            name="Database Scope B",
            node_type=OrganizationNode.NodeType.COMPANY,
        )
        self.head_office = OrganizationNode.objects.create(
            code="DB_SCOPE_HEAD",
            name="Database Scope Head Office",
            node_type=OrganizationNode.NodeType.HEAD_OFFICE,
        )
        self.user_a = User.objects.create_user(email="db-a@scope.test", password="password")
        self.user_b = User.objects.create_user(email="db-b@scope.test", password="password")
        self.profile_a = EmployeeProfile.objects.create(
            user=self.user_a,
            company=self.company_a,
            employee_id="DB-A-001",
            full_name="Database A",
        )
        self.profile_b = EmployeeProfile.objects.create(
            user=self.user_b,
            company=self.company_b,
            employee_id="DB-B-001",
            full_name="Database B",
        )
        self.leave_type_a = LeaveType.objects.create(company=self.company_a, name="Annual A", code="ANNUAL_A")
        self.leave_type_b = LeaveType.objects.create(company=self.company_b, name="Annual B", code="ANNUAL_B")

    def test_employee_bulk_create_and_queryset_update_cannot_bypass_company_constraints(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            EmployeeProfile.objects.bulk_create(
                [EmployeeProfile(employee_id="DB-NULL-001", full_name="Invalid Null Company")]
            )

        with self.assertRaises(IntegrityError), transaction.atomic():
            EmployeeProfile.objects.bulk_create(
                [
                    EmployeeProfile(
                        employee_id="DB-HEAD-001",
                        full_name="Invalid Head Office",
                        company=self.head_office,
                    )
                ]
            )

        with self.assertRaises(IntegrityError), transaction.atomic():
            EmployeeProfile.objects.filter(pk=self.profile_a.pk).update(company=None)

        with self.assertRaises(IntegrityError), transaction.atomic():
            EmployeeProfile.objects.filter(pk=self.profile_a.pk).update(
                company=self.head_office,
            )

        with self.assertRaises(IntegrityError), transaction.atomic():
            EmployeeProfile.objects.filter(pk=self.profile_b.pk).update(
                manager_profile=self.profile_a,
                manager=self.user_a,
            )

        self.profile_a.refresh_from_db()
        self.profile_b.refresh_from_db()
        self.assertEqual(self.profile_a.company_id, self.company_a.id)
        self.assertIsNone(self.profile_b.manager_profile_id)

    def test_company_reverse_guards_prevent_invalidating_existing_employees(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            OrganizationNode.objects.filter(pk=self.company_a.pk).update(is_active=False)

        with self.assertRaises(IntegrityError), transaction.atomic():
            OrganizationNode.objects.filter(pk=self.company_a.pk).update(
                node_type=OrganizationNode.NodeType.HEAD_OFFICE,
            )

    def test_leave_bulk_operations_cannot_insert_cross_company_relationships(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            LeaveRequest.objects.bulk_create(
                [
                    LeaveRequest(
                        employee=self.user_a,
                        employee_profile=self.profile_a,
                        company=self.company_a,
                        leave_type=self.leave_type_b,
                        start_date=date(2026, 1, 1),
                        end_date=date(2026, 1, 2),
                    )
                ]
            )

        with self.assertRaises(IntegrityError), transaction.atomic():
            LeaveRequest.objects.bulk_create(
                [
                    LeaveRequest(
                        employee=self.user_a,
                        employee_profile=self.profile_a,
                        company=self.company_a,
                        leave_type=self.leave_type_a,
                        delegated_to=self.user_b,
                        start_date=date(2026, 2, 1),
                        end_date=date(2026, 2, 2),
                    )
                ]
            )

        with self.assertRaises(IntegrityError), transaction.atomic():
            LeaveBalanceSnapshot.objects.bulk_create(
                [
                    LeaveBalanceSnapshot(
                        employee_profile=self.profile_a,
                        leave_type=self.leave_type_b,
                        year=2026,
                        opening_balance=Decimal("21.00"),
                        remaining=Decimal("21.00"),
                    )
                ]
            )

        with self.assertRaises(IntegrityError), transaction.atomic():
            LeaveBalanceAdjustment.objects.bulk_create(
                [
                    LeaveBalanceAdjustment(
                        employee=self.user_a,
                        employee_profile=self.profile_a,
                        company=self.company_a,
                        leave_type=self.leave_type_b,
                        adjustment_days=Decimal("1.00"),
                        year=2026,
                        reason="Invalid cross-company adjustment",
                    )
                ]
            )

    def test_leave_queryset_updates_and_reverse_updates_are_database_guarded(self):
        request = LeaveRequest.objects.create(
            employee=self.user_a,
            employee_profile=self.profile_a,
            company=self.company_a,
            leave_type=self.leave_type_a,
            start_date=date(2026, 3, 1),
            end_date=date(2026, 3, 2),
        )
        snapshot = LeaveBalanceSnapshot.objects.create(
            employee_profile=self.profile_a,
            leave_type=self.leave_type_a,
            year=2026,
            opening_balance=Decimal("21.00"),
            used=Decimal("2.00"),
            remaining=Decimal("19.00"),
        )
        before = (snapshot.opening_balance, snapshot.used, snapshot.remaining)

        with self.assertRaises(IntegrityError), transaction.atomic():
            LeaveRequest.objects.filter(pk=request.pk).update(company=self.company_b)

        with self.assertRaises(IntegrityError), transaction.atomic():
            LeaveType.objects.filter(pk=self.leave_type_a.pk).update(company=self.company_b)

        with self.assertRaises(IntegrityError), transaction.atomic():
            EmployeeProfile.objects.filter(pk=self.profile_a.pk).update(company=self.company_b)

        snapshot.refresh_from_db()
        self.assertEqual((snapshot.opening_balance, snapshot.used, snapshot.remaining), before)

    def test_annual_payment_and_biotime_bulk_operations_are_database_guarded(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            AnnualLeavePaymentRequest.objects.bulk_create(
                [
                    AnnualLeavePaymentRequest(
                        employee=self.user_a,
                        employee_profile=self.profile_a,
                        company=self.company_b,
                        cycle_start=date(2026, 1, 1),
                        cycle_end=date(2026, 12, 31),
                    )
                ]
            )

        archived_profile = EmployeeProfile.objects.create(
            company=self.company_a,
            employee_id="DB-ARCHIVED-001",
            full_name="Archived Mapping Target",
            is_archived=True,
        )
        with self.assertRaises(IntegrityError), transaction.atomic():
            BioTimeEmployeeMap.objects.bulk_create(
                [BioTimeEmployeeMap(employee_profile=archived_profile, biotime_emp_code="DB-ARCHIVED-BIO")]
            )

        mapping = BioTimeEmployeeMap.objects.create(
            employee_profile=self.profile_a,
            biotime_emp_code="DB-A-BIO",
        )
        with self.assertRaises(IntegrityError), transaction.atomic():
            EmployeeProfile.objects.filter(pk=self.profile_a.pk).update(is_archived=True)
        self.assertTrue(BioTimeEmployeeMap.objects.filter(pk=mapping.pk).exists())
