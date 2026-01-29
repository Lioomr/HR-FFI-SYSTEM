from rest_framework.throttling import UserRateThrottle


class EmployeeImportThrottle(UserRateThrottle):
    scope = "employee_import"
