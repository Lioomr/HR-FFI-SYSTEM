from rest_framework.throttling import UserRateThrottle


class PayrollFinalizeThrottle(UserRateThrottle):
    scope = "payroll_finalize"


class PayrollGeneratePayslipsThrottle(UserRateThrottle):
    scope = "payroll_generate_payslips"


class PayrollExportThrottle(UserRateThrottle):
    scope = "payroll_export"
