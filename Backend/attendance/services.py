from datetime import datetime, timedelta
from django.utils import timezone
from .models import BioTimeConfig, BioTimeEmployeeMap, AttendanceRecord
from .biotime_client import BioTimeClient

import logging
logger = logging.getLogger(__name__)

class SyncBioTimeService:
    """
    Service responsible for coordinating the sync of attendance 
    transactions from BioTime 8.5 to Django AttendanceRecords.
    """
    
    @classmethod
    def execute(cls, days_back=1):
        config = BioTimeConfig.get_solo()
        
        if not config.is_active:
            logger.info("BioTime sync is disabled in configuration.")
            return False, "Sync is disabled in settings."

        if not config.server_ip or not config.username:
            return False, "BioTime configuration is incomplete."
            
        client = BioTimeClient(
            server_ip=config.server_ip,
            server_port=config.server_port,
            username=config.username,
            password=config.password
        )

        # Authenticate and confirm connectivity
        if not client.test_connection():
            return False, "Failed to connect to BioTime Server."

        # Compute time range
        end_time = timezone.now()
        start_time = end_time - timedelta(days=days_back)
        
        start_str = start_time.strftime("%Y-%m-%d 00:00:00")
        end_str = end_time.strftime("%Y-%m-%d 23:59:59")

        transactions = client.get_transactions(start_time=start_str, end_time=end_str)
        
        if not transactions:
            return True, "No transactions found in this period."

        # Group transactions by employee and date
        # Expected structure: { emp_code: { date_string: [list of timestamps] } }
        grouped_data = {}
        for t in transactions:
            emp_code = str(t.get("emp_code"))
            punch_time_str = t.get("punch_time") # "2019-03-04 09:50:00"
            
            if not punch_time_str:
                continue
                
            punch_time = datetime.strptime(punch_time_str, "%Y-%m-%d %H:%M:%S")
            # Make punch_time aware relying on timezone.now() tz
            punch_time = timezone.make_aware(punch_time, timezone.get_current_timezone())
            punch_date = punch_time.date()
            
            if emp_code not in grouped_data:
                grouped_data[emp_code] = {}
            if punch_date not in grouped_data[emp_code]:
                grouped_data[emp_code][punch_date] = []
                
            grouped_data[emp_code][punch_date].append(punch_time)

        # Mapping and saving
        processed_count = 0
        unmapped_count = 0
        
        # Preload the map 
        mappings = {
            m.biotime_emp_code: m.employee_profile 
            for m in BioTimeEmployeeMap.objects.select_related("employee_profile").all()
        }

        for emp_code, dates in grouped_data.items():
            if emp_code not in mappings:
                unmapped_count += 1
                continue
                
            employee_profile = mappings[emp_code]
            
            for date_obj, punches in dates.items():
                punches.sort()
                check_in_at = punches[0]
                check_out_at = punches[-1] if len(punches) > 1 else None
                
                # Create or Update attendance record
                record, created = AttendanceRecord.objects.get_or_create(
                    employee_profile=employee_profile,
                    date=date_obj,
                    defaults={
                        "check_in_at": check_in_at,
                        "check_out_at": check_out_at,
                        "source": AttendanceRecord.Source.SYSTEM,
                        "status": AttendanceRecord.Status.PRESENT 
                    }
                )
                
                # If record exists, update times if needed
                if not created and record.source == AttendanceRecord.Source.SYSTEM:
                    updated = False
                    
                    if not record.check_in_at or check_in_at < record.check_in_at:
                        record.check_in_at = check_in_at
                        updated = True
                        
                    if record.check_out_at is None and check_out_at is not None:
                        record.check_out_at = check_out_at
                        updated = True
                    elif record.check_out_at and check_out_at and check_out_at > record.check_out_at:
                        record.check_out_at = check_out_at
                        updated = True
                        
                    if updated:
                        record.save()
                        
                processed_count += 1

        config.last_sync_time = timezone.now()
        config.save()
        
        message = f"Synced {processed_count} dates. Unmapped codes: {unmapped_count}"
        return True, message

    @classmethod
    def get_unmapped_users(cls):
        """
        Fetch all employees from the device, and check which ones are NOT mapped 
        in our local database.
        """
        config = BioTimeConfig.get_solo()
        if not config.is_active and not config.server_ip:
            return []
            
        client = BioTimeClient(
            server_ip=config.server_ip,
            server_port=config.server_port,
            username=config.username,
            password=config.password
        )
        
        device_employees = client.get_employees()
        
        existing_mappings = list(BioTimeEmployeeMap.objects.values_list("biotime_emp_code", flat=True))
        
        unmapped = []
        for emp in device_employees:
            emp_code = str(emp.get("emp_code"))
            if emp_code not in existing_mappings:
                unmapped.append({
                    "emp_code": emp_code,
                    "first_name": emp.get("first_name", ""),
                    "last_name": emp.get("last_name", ""),
                    "department": emp.get("dept_name", "")
                })
                
        return unmapped
