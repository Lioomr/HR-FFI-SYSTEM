"""Migrations 0012/0013 on production-shaped data (duplicates, expired rows)."""

import json
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db import IntegrityError, connection, transaction
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase
from django.utils import timezone

from employees.models import EmployeeProfile
from organization.models import OrganizationNode, OrganizationScope, OrganizationScopeMembership

User = get_user_model()

BEFORE = [("core", "0011_workflow_public_references")]
AFTER = [("core", "0013_remove_crosscompanymanagerassignment_end_at")]
CAPABILITIES_BEFORE = AFTER
CAPABILITIES_AFTER = [("core", "0014_cross_company_manager_permission_and_rating_capabilities")]
# Later tests need the fully migrated schema (and the newest capability guard).
LATEST = CAPABILITIES_AFTER


def _migrate(targets):
    executor = MigrationExecutor(connection)
    executor.loader.build_graph()
    executor.migrate(targets)


class _MigrationTestBase(TransactionTestCase):
    def setUp(self):
        self.company_a = OrganizationNode.objects.create(
            code="MIG_A", name="Migration A", node_type=OrganizationNode.NodeType.COMPANY
        )
        self.company_b = OrganizationNode.objects.create(
            code="MIG_B", name="Migration B", node_type=OrganizationNode.NodeType.COMPANY
        )
        self.scope = OrganizationScope.objects.create(code="MIG_ALL", name="All Active Companies")
        for company in (self.company_a, self.company_b):
            OrganizationScopeMembership.objects.create(scope=self.scope, company=company)
        self.profiles = {}
        for key, company in (("emp1", self.company_a), ("emp2", self.company_a), ("mgr", self.company_b)):
            user = User.objects.create_user(email=f"{key}@migration.test", password="StrongPass123!")
            self.profiles[key] = EmployeeProfile.objects.create(
                user=user, company=company, employee_id=f"MIG-{key}", full_name=key
            )

    def tearDown(self):
        _migrate(LATEST)

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        # TransactionTestCase flushes every table after each test, including rows
        # seeded by data migrations that later tests rely on. Put them back.
        serialized = getattr(connection, "_test_serialized_contents", None)
        if serialized:
            connection.creation.deserialize_db_from_string(serialized)
        else:
            from organization.services import seed_default_organization

            seed_default_organization()


class CrossCompanyManagerMigrationTests(_MigrationTestBase):
    def _insert_old_row(self, employee, *, end_at, start_at=None):
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO core_crosscompanymanagerassignment
                    (employee_id, manager_profile_id, scope_id, start_at, end_at, capabilities, reason,
                     is_active, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s::jsonb, '', TRUE, NOW(), NOW())
                RETURNING id
                """,
                [
                    employee.pk,
                    self.profiles["mgr"].pk,
                    self.scope.pk,
                    start_at or timezone.now() - timedelta(days=10),
                    end_at,
                    '["employees.view", "leaves.approve", "attendance.approve"]',
                ],
            )
            return cursor.fetchone()[0]

    def _row(self, assignment_id):
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT is_active, revoked_at IS NOT NULL FROM core_crosscompanymanagerassignment WHERE id = %s",
                [assignment_id],
            )
            return cursor.fetchone()

    def test_forward_keeps_newest_active_row_ends_expired_rows_and_enforces_uniqueness(self):
        _migrate(BEFORE)
        future = timezone.now() + timedelta(days=300)
        older_duplicate = self._insert_old_row(self.profiles["emp1"], end_at=future)
        newest = self._insert_old_row(self.profiles["emp1"], end_at=future)
        expired = self._insert_old_row(
            self.profiles["emp2"],
            end_at=timezone.now() - timedelta(days=1),
            start_at=timezone.now() - timedelta(days=5),
        )

        _migrate(AFTER)

        self.assertEqual(self._row(older_duplicate), (False, True))
        self.assertEqual(self._row(newest), (True, False))
        self.assertEqual(self._row(expired), (False, True))
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name = 'core_crosscompanymanagerassignment' AND column_name = 'end_at'"
            )
            self.assertIsNone(cursor.fetchone())
        with self.assertRaises(IntegrityError), transaction.atomic(), connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO core_crosscompanymanagerassignment
                    (employee_id, manager_profile_id, scope_id, start_at, capabilities, reason,
                     is_active, created_at, updated_at)
                VALUES (%s, %s, %s, NOW(), '["employees.view"]'::jsonb, '', TRUE, NOW(), NOW())
                """,
                [self.profiles["emp1"].pk, self.profiles["mgr"].pk, self.scope.pk],
            )

    def test_forward_is_a_no_op_on_an_empty_table_and_reverse_restores_end_at(self):
        _migrate(BEFORE)
        _migrate(AFTER)
        _migrate(BEFORE)
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT is_nullable FROM information_schema.columns "
                "WHERE table_name = 'core_crosscompanymanagerassignment' AND column_name = 'end_at'"
            )
            self.assertEqual(cursor.fetchone(), ("NO",))


class CrossCompanyManagerCapabilityMigrationTests(_MigrationTestBase):
    """0014 grants the permission-request and contract-rating capabilities."""

    NEW = {"permission_requests.approve", "contract_ratings.rate"}
    PROD_SHAPED = ["employees.view", "leaves.approve", "attendance.approve"]

    def _insert_row(self, employee, *, active=True):
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO core_crosscompanymanagerassignment
                    (employee_id, manager_profile_id, scope_id, start_at, capabilities, reason,
                     is_active, revoked_at, created_at, updated_at)
                VALUES (%s, %s, %s, NOW(), %s::jsonb, '', %s, %s, NOW(), NOW())
                RETURNING id
                """,
                [
                    employee.pk,
                    self.profiles["mgr"].pk,
                    self.scope.pk,
                    '["employees.view", "leaves.approve", "attendance.approve"]',
                    active,
                    None if active else timezone.now(),
                ],
            )
            return cursor.fetchone()[0]

    def _capabilities(self, assignment_id):
        with connection.cursor() as cursor:
            cursor.execute("SELECT capabilities FROM core_crosscompanymanagerassignment WHERE id = %s", [assignment_id])
            value = cursor.fetchone()[0]
        return value if isinstance(value, list) else json.loads(value)

    def test_forward_grants_the_new_capabilities_to_active_rows_only_and_is_idempotent(self):
        _migrate(CAPABILITIES_BEFORE)
        active = self._insert_row(self.profiles["emp1"])
        revoked = self._insert_row(self.profiles["emp2"], active=False)

        _migrate(CAPABILITIES_AFTER)

        self.assertEqual(set(self._capabilities(active)), set(self.PROD_SHAPED) | self.NEW)
        self.assertEqual(len(self._capabilities(active)), len(self.PROD_SHAPED) + len(self.NEW))
        self.assertEqual(self._capabilities(revoked), self.PROD_SHAPED)

        # Re-running the grant (reverse then forward) adds nothing twice.
        _migrate(CAPABILITIES_BEFORE)
        self.assertEqual(self._capabilities(active), self.PROD_SHAPED)
        _migrate(CAPABILITIES_AFTER)
        self.assertEqual(len(self._capabilities(active)), len(self.PROD_SHAPED) + len(self.NEW))

    def test_guard_accepts_the_new_capabilities_and_still_rejects_unknown_ones(self):
        _migrate(CAPABILITIES_AFTER)
        assignment_id = self._insert_row(self.profiles["emp1"])
        with connection.cursor() as cursor:
            cursor.execute(
                "UPDATE core_crosscompanymanagerassignment SET capabilities = %s::jsonb WHERE id = %s",
                ['["permission_requests.approve", "contract_ratings.rate"]', assignment_id],
            )
        with self.assertRaises(IntegrityError), transaction.atomic(), connection.cursor() as cursor:
            cursor.execute(
                "UPDATE core_crosscompanymanagerassignment SET capabilities = %s::jsonb WHERE id = %s",
                ['["payroll.approve"]', assignment_id],
            )

    def test_capability_migration_is_a_no_op_on_an_empty_table(self):
        _migrate(CAPABILITIES_BEFORE)
        _migrate(CAPABILITIES_AFTER)
        with connection.cursor() as cursor:
            cursor.execute("SELECT COUNT(*) FROM core_crosscompanymanagerassignment")
            self.assertEqual(cursor.fetchone()[0], 0)
