import re

_SEQUENTIAL_EMPLOYEE_CODE = re.compile(r"^[A-Z][A-Z0-9_]*-[0-9]{4}$")


def is_sequential_employee_code(employee_code: str) -> bool:
    return bool(_SEQUENTIAL_EMPLOYEE_CODE.fullmatch(employee_code or ""))


def format_leave_reference(employee_code: str, sequence: int) -> str:
    if not is_sequential_employee_code(employee_code) or sequence < 1:
        raise ValueError("A sequential employee code and positive request sequence are required.")
    return f"LV-{employee_code}{sequence:02d}"
