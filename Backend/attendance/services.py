import hashlib
import json
import logging
from datetime import datetime, timedelta
from datetime import timezone as datetime_timezone

from django.db import IntegrityError, transaction
from django.utils import timezone

from .biotime_client import BioTimeClient
from .calculation import AttendanceCalculationService, provider_punch_type
from .models import AttendanceDailyResult, AttendanceRecord, BioTimeConfig, BioTimeEmployeeMap, BioTimeRawPunch

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
            "raw_created": 0,
            "raw_duplicates": 0,
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
        """Persist immutable punches, then recalculate deterministic projections.

        This deliberately never updates a pre-existing AttendanceRecord. A new
        compatibility record is created only when no legacy row exists, so old
        HR override and Exit Permission anchors retain their original values.
        """
        counts = cls._result()
        parsed_transactions = []
        for raw_transaction in transactions:
            emp_code = str(raw_transaction.get("emp_code") or "").strip()
            punch_time = cls._parse_punch_time(raw_transaction.get("punch_time"))
            if not emp_code or not punch_time or raw_transaction.get("is_attendance", True) in (False, 0, "0"):
                counts["invalid"] += 1
                continue
            local_time = timezone.localtime(punch_time)
            parsed_transactions.append((emp_code, punch_time, local_time.date(), raw_transaction))

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
            affected_days = set()
            for emp_code, punch_time, attendance_date, raw_transaction in parsed_transactions:
                employee_profile = mappings.get(emp_code)
                if not employee_profile:
                    counts["unmapped"] += 1
                    logger.warning("BioTime employee code %s is not mapped; skipped punch.", emp_code)
                    continue
                terminal_sn = str(raw_transaction.get("terminal_sn") or "").strip()
                raw_type = provider_punch_type(raw_transaction)
                provider_id = str(
                    raw_transaction.get("id")
                    or raw_transaction.get("transaction_id")
                    or raw_transaction.get("punch_id")
                    or ""
                ).strip()
                identity = (
                    f"provider:{emp_code}:{provider_id}"
                    if provider_id
                    else json.dumps(
                        {
                            "emp_code": emp_code,
                            "occurred_at": punch_time.astimezone(datetime_timezone.utc).isoformat(),
                            "raw_punch_type": raw_type,
                            "terminal_sn": terminal_sn,
                        },
                        sort_keys=True,
                        separators=(",", ":"),
                    )
                )
                deduplication_key = hashlib.sha256(identity.encode("utf-8")).hexdigest()
                try:
                    with transaction.atomic():
                        _, created = BioTimeRawPunch.objects.get_or_create(
                            deduplication_key=deduplication_key,
                            defaults={
                                "company": employee_profile.company,
                                "employee_profile": employee_profile,
                                "attendance_date": attendance_date,
                                "occurred_at": punch_time,
                                "biotime_emp_code": emp_code,
                                "provider_punch_id": provider_id,
                                "raw_punch_type": raw_type,
                                "terminal_sn": terminal_sn,
                                "provider_payload": raw_transaction,
                            },
                        )
                except IntegrityError:
                    # A concurrent sync inserted the same unique evidence.
                    created = False
                if created:
                    counts["raw_created"] += 1
                    affected_days.add((employee_profile.pk, attendance_date))
                else:
                    counts["raw_duplicates"] += 1

            # ``mappings`` is keyed by BioTime code and already holds the profiles.
            profiles = {profile.pk: profile for profile in mappings.values()}
            codes_by_profile = {profile.pk: emp_code for emp_code, profile in mappings.items()}
            for profile_id, work_date in sorted(affected_days, key=lambda value: (value[0], value[1])):
                profile = profiles[profile_id]
                result_existed = AttendanceDailyResult.objects.filter(employee_profile=profile, date=work_date).exists()
                result = AttendanceCalculationService.recalculate(profile, work_date)
                counts["processed"] += 1
                counts["updated" if result_existed else "created"] += 1
                terminal_sn = ",".join(
                    sorted(
                        set(
                            BioTimeRawPunch.objects.filter(employee_profile=profile, attendance_date=work_date)
                            .exclude(terminal_sn="")
                            .values_list("terminal_sn", flat=True)
                        )
                    )
                )

                # Compatibility projection: create a new public legacy-shaped
                # row once, but never overwrite a historical row.
                record, record_created = AttendanceRecord.objects.get_or_create(
                    employee_profile=profile,
                    date=work_date,
                    defaults={
                        "check_in_at": result.first_check_in_at,
                        "check_out_at": result.final_check_out_at,
                        "source": AttendanceRecord.Source.SYSTEM,
                        "status": result.status_input,
                        "is_late_flagged": result.status_input == AttendanceRecord.Status.LATE,
                        "biotime_emp_code": codes_by_profile[profile_id],
                        "biotime_terminal_sn": terminal_sn,
                        "is_biotime_projection": True,
                    },
                )
                if record_created:
                    try:
                        from job_offers.starting_work_service import generate_starting_work_acknowledgment

                        generate_starting_work_acknowledgment(record, received_from_biotime=True)
                    except Exception:
                        logger.exception(
                            "starting_work_acknowledgment_generation_failed", extra={"attendance_record_id": record.id}
                        )
                elif record.is_biotime_projection and record.source == AttendanceRecord.Source.SYSTEM:
                    # We may refresh only the compatibility rows introduced by
                    # this foundation, and only while they are still SYSTEM
                    # rows. Historical SYSTEM rows are legacy data too and
                    # therefore remain untouched.
                    record.check_in_at = result.first_check_in_at
                    record.check_out_at = result.final_check_out_at
                    record.biotime_emp_code = codes_by_profile[profile_id]
                    record.biotime_terminal_sn = terminal_sn
                    record.save(
                        update_fields=["check_in_at", "check_out_at", "biotime_emp_code", "biotime_terminal_sn", "updated_at"]
                    )
                    counts["updated"] += 1
                else:
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
