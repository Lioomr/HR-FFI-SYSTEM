from datetime import date, timedelta
from django.db.models import Sum
from .models import LeaveType, LeaveRequest, LeaveBalanceSnapshot
from employees.models import EmployeeProfile

def get_leave_days(start_date, end_date):
    """
    Calculate number of days between start and end (inclusive).
    Place holder for future holiday/weekend logic.
    """
    if start_date > end_date:
        return 0
    return (end_date - start_date).days + 1

def calculate_overlap_days(req_start, req_end, year):
    """
    Calculate days of a request that fall within a specific year.
    """
    year_start = date(year, 1, 1)
    year_end = date(year, 12, 31)
    
    # Intersection
    actual_start = max(req_start, year_start)
    actual_end = min(req_end, year_end)
    
    return get_leave_days(actual_start, actual_end)

def calculate_leave_balance(user, year):
    """
    Calculate balances for all leave types for a user in a given year.
    Returns a dict keyed by leave_type_id or a list of dicts.
    """
    # 1. Try to get hire date for recursion base case
    try:
        profile = user.employee_profile
        hire_year = profile.hire_date.year if profile.hire_date else year
    except EmployeeProfile.DoesNotExist:
        # Should not happen for valid employees, but handle gracefully
        hire_year = year

    if year < hire_year:
        return [] # No balances before hire

    leave_types = LeaveType.objects.filter(is_active=True)
    balances = []

    for lt in leave_types:
        # Used
        # Filter requests that overlap with the year
        # Logic: req_start <= year_end AND req_end >= year_start
        year_start = date(year, 1, 1)
        year_end = date(year, 12, 31)
        
        requests = LeaveRequest.objects.filter(
            employee=user,
            leave_type=lt,
            status=LeaveRequest.RequestStatus.APPROVED,
            start_date__lte=year_end,
            end_date__gte=year_start
        )
        
        used = 0
        for req in requests:
            used += calculate_overlap_days(req.start_date, req.end_date, year)
            
        # Opening Balance (Carry-over)
        opening = 0
        if lt.allow_carry_over:
            # Check for snapshot first (MVP optimization/persistence)
            # For now, we compute dynamically as per prompt "Snapshots can be recomputed on demand"
            # But creating a snapshot would be good. 
            # We strictly follow "compute previous year remaining" if no snapshot.
            
            # Base case: if year == hire_year, opening is 0 (unless we migrated data, but assume 0)
            if year > hire_year:
                # Recurse for previous year
                prev_year = year - 1
                prev_balances = calculate_leave_balance(user, prev_year)
                
                # Extract remaining from previous year's calculation
                # prev_balances is a list of dicts, find the matching leave_type
                prev_remaining = 0
                for bal in prev_balances:
                     if bal['leave_type_id'] == lt.id:
                         prev_remaining = float(bal['remaining'])
                         break
                
                # Apply max_carry_over
                if lt.max_carry_over is not None:
                    # Convert Decimal to float for comparison if needed, or stick to one type
                    opening = min(prev_remaining, float(lt.max_carry_over))
                else:
                    opening = prev_remaining

        # Quota
        quota = float(lt.annual_quota)
        
        remaining = opening + quota - used
        
        balances.append({
            "leave_type_id": lt.id,
            "leave_type_name": lt.name,
            "opening_balance": f"{opening:.1f}", # Format as string for API consistency
            "used": f"{used:.1f}",
            "remaining": f"{remaining:.1f}"
        })
        
    return balances
