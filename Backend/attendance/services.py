import logging
from collections import defaultdict
from datetime import datetime, timedelta

from django.db import transaction
from django.utils import timezone

from .biotime_client import BioTimeClient
from .models import AttendanceRecord, BioTimeConfig, BioTimeEmployeeMap

logger = logging.getLogger(__name__)


class BioTimeIntegrationError(Exception):
    """Raised when BioTime data cannot be loaded safely."""


class SyncBioTimeService:
    """Import BioTime transactions without changing user-managed attendance."""

    @staticmethod
    def _result(**overrides):
        result = {
            "processed": 0,
            "created": 0,
            "updated": 0,
            "skipped": 0,
            "unmapped": 0,
            "invalid": 0,
        }
        result.update(overrides)
        return result

    @staticmethod
    def _parse_punch_time(value):
        if not isinstance(value, str) or not value.strip():
            return None

        value = value.strip()
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            try:
                parsed = datetime.strptime(value, "%Y-%m-%d %H:%M:%S")
            except ValueError:
                return None

        if timezone.is_naive(parsed):
            return timezone.make_aware(parsed, timezone.get_current_timezone())
        return parsed

    @classmethod
    def execute(cls, days_back=1):
        counts = cls._result()
        config = BioTimeConfig.get_solo()

        if not config.is_active:
            logger.info("BioTime sync skipped because the integration is disabled.")
            return False, {**counts, "message": "Sync is disabled in settings."}

        if not all([config.server_ip, config.server_port, config.username, config.password]):
            logger.error("BioTime sync failed because the configuration is incomplete.")
            return False, {**counts, "message": "BioTime configuration is incomplete."}

        client = BioTimeClient(
            server_ip=config.server_ip,
            server_port=config.server_port,
            username=config.username,
            password=config.password,
        )
        if not client.test_connection():
            logger.error("BioTime sync authentication failed: %s", client.last_error)
            return False, {**counts, "message": "Failed to connect to BioTime Server."}

        end_time = timezone.now()
        start_time = (
            config.last_sync_time - timedelta(minutes=5)
            if config.last_sync_time
            else end_time - timedelta(days=days_back)
        )
        transactions = client.get_transactions(
            start_time=start_time.strftime("%Y-%m-%d 00:00:00"),
            end_time=end_time.strftime("%Y-%m-%d 23:59:59"),
        )

        if transactions is None:
            logger.error("BioTime sync transaction request failed: %s", client.last_error)
            return False, {**counts, "message": "Unable to fetch BioTime transactions."}

        with transaction.atomic():
            result = cls.ingest_transactions(transactions)
            config.last_sync_time = timezone.now()
            config.save(update_fields=["last_sync_time", "updated_at"])
        return True, {**result, "message": "BioTime sync completed."}

    @classmethod
    def ingest_transactions(cls, transactions):
        """Process transactions fetched by either AWS or the office-side agent."""
        counts = cls._result()
        grouped = defaultdict(lambda: defaultdict(list))
        terminal_codes = defaultdict(set)
        for raw_transaction in transactions:
            emp_code = str(raw_transaction.get("emp_code") or "").strip()
            punch_time = cls._parse_punch_time(raw_transaction.get("punch_time"))
            if not emp_code or not punch_time or raw_transaction.get("is_attendance", True) in (False, 0, "0"):
                counts["invalid"] += 1
                continue
            grouped[emp_code][punch_time.date()].append(punch_time)
            terminal_sn = str(raw_transaction.get("terminal_sn") or "").strip()
            if terminal_sn:
                terminal_codes[(emp_code, punch_time.date())].add(terminal_sn)

        mappings = {
            mapping.biotime_emp_code: mapping.employee_profile
            for mapping in BioTimeEmployeeMap.objects.select_related("employee_profile").filter(
                employee_profile__company_id__isnull=False,
                employee_profile__company__node_type="company",
                employee_profile__company__is_active=True,
                employee_profile__is_archived=False,
            )
        }

        with transaction.atomic():
            for emp_code, dates in grouped.items():
                employee_profile = mappings.get(emp_code)
                if not employee_profile:
                    counts["unmapped"] += len(dates)
                    logger.warning(
                        "BioTime employee code %s is not mapped; skipped %s day(s).", emp_code, len(dates)
                    )
                    continue

                for record_date, punches in dates.items():
                    counts["processed"] += 1
                    check_in_at = min(punches)
                    check_out_at = max(punches) if len(punches) > 1 else None
                    terminal_sn = ",".join(sorted(terminal_codes[(emp_code, record_date)]))

                    record, created = AttendanceRecord.objects.get_or_create(
                        employee_profile=employee_profile,
                        date=record_date,
                        defaults={
                            "check_in_at": check_in_at,
                            "check_out_at": check_out_at,
                            "source": AttendanceRecord.Source.SYSTEM,
                            "status": AttendanceRecord.Status.PRESENT,
                            "biotime_emp_code": emp_code,
                            "biotime_terminal_sn": terminal_sn,
                        },
                    )
                    if created:
                        counts["created"] += 1
                        try:
                            from job_offers.starting_work_service import generate_starting_work_acknowledgment

                            generate_starting_work_acknowledgment(record, received_from_biotime=True)
                        except Exception:
                            logger.exception(
                                "starting_work_acknowledgment_generation_failed",
                                extra={"attendance_record_id": record.id},
                            )
                        continue

                    if record.source != AttendanceRecord.Source.SYSTEM:
                        counts["skipped"] += 1
                        logger.info("BioTime skipped non-system attendance record %s.", record.pk)
                        continue

                    update_fields = []
                    if not record.check_in_at or check_in_at < record.check_in_at:
                        record.check_in_at = check_in_at
                        update_fields.append("check_in_at")
                    if check_out_at and (not record.check_out_at or check_out_at > record.check_out_at):
                        record.check_out_at = check_out_at
                        update_fields.append("check_out_at")
                    if record.biotime_emp_code != emp_code:
                        record.biotime_emp_code = emp_code
                        update_fields.append("biotime_emp_code")
                    if terminal_sn and record.biotime_terminal_sn != terminal_sn:
                        record.biotime_terminal_sn = terminal_sn
                        update_fields.append("biotime_terminal_sn")

                    if update_fields:
                        record.save(update_fields=[*update_fields, "updated_at"])
                        counts["updated"] += 1

                    acknowledgment = None
                    try:
                        from job_offers.starting_work_service import generate_starting_work_acknowledgment

                        acknowledgment = generate_starting_work_acknowledgment(record, received_from_biotime=True)
                    except Exception:
                        logger.exception(
                            "starting_work_acknowledgment_verification_hold_failed",
                            extra={"attendance_record_id": record.id},
                        )
                    if acknowledgment is None:
                        from job_offers.models import StartingWorkAcknowledgment

                        acknowledgment = StartingWorkAcknowledgment.objects.filter(
                            employee_profile=record.employee_profile
                        ).first()
                    record.refresh_from_db(fields=["status", "source", "is_overridden"])
                    if (
                        record.source == AttendanceRecord.Source.SYSTEM
                        and not record.is_overridden
                        and (acknowledgment is None or acknowledgment.status == "approved")
                        and record.status != AttendanceRecord.Status.PRESENT
                    ):
                        record.status = AttendanceRecord.Status.PRESENT
                        record.save(update_fields=["status", "updated_at"])
                        if not update_fields:
                            counts["updated"] += 1
                    elif not update_fields:
                        counts["skipped"] += 1

        logger.info("BioTime sync completed: %s", counts)
        return counts

    @classmethod
    def get_unmapped_users(cls):
        config = BioTimeConfig.get_solo()
        if not all([config.server_ip, config.server_port, config.username, config.password]):
            logger.error("Cannot load BioTime employees because configuration is incomplete.")
            raise BioTimeIntegrationError("BioTime configuration is incomplete.")

        client = BioTimeClient(config.server_ip, config.server_port, config.username, config.password)
        device_employees = client.get_employees()
        if device_employees is None:
            logger.error("Unable to load BioTime employees: %s", client.last_error)
            raise BioTimeIntegrationError("Unable to fetch BioTime employees.")

        mapped_codes = set(BioTimeEmployeeMap.objects.values_list("biotime_emp_code", flat=True))
        employees = []
        for employee in device_employees:
            emp_code = str(employee.get("emp_code") or "").strip()
            if not emp_code or emp_code in mapped_codes:
                continue
            department = employee.get("dept_name") or employee.get("department") or ""
            if isinstance(department, dict):
                department = department.get("dept_name") or ""
            employees.append(
                {
                    "emp_code": emp_code,
                    "first_name": employee.get("first_name") or "",
                    "last_name": employee.get("last_name") or "",
                    "department": department,
                }
            )
        return employees
