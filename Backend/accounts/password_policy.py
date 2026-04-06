import re

from django.contrib.auth.password_validation import CommonPasswordValidator, NumericPasswordValidator
from django.core.exceptions import ValidationError as DjangoValidationError


def get_password_policy():
    from admin_portal.models import SystemSettings

    settings_obj = SystemSettings.get_solo()
    return {
        "min_length": settings_obj.password_min_length,
        "require_upper": settings_obj.password_require_upper,
        "require_lower": settings_obj.password_require_lower,
        "require_number": settings_obj.password_require_number,
        "require_special": settings_obj.password_require_special,
    }


def validate_password_against_policy(password: str, user=None) -> None:
    policy = get_password_policy()
    errors: list[str] = []

    if len(password) < policy["min_length"]:
        errors.append(f"Password must be at least {policy['min_length']} characters long.")
    if policy["require_upper"] and not re.search(r"[A-Z]", password):
        errors.append("Password must contain at least one uppercase letter.")
    if policy["require_lower"] and not re.search(r"[a-z]", password):
        errors.append("Password must contain at least one lowercase letter.")
    if policy["require_number"] and not re.search(r"\d", password):
        errors.append("Password must contain at least one number.")
    if policy["require_special"] and not re.search(r"[^A-Za-z0-9]", password):
        errors.append("Password must contain at least one special character.")

    validators = [CommonPasswordValidator(), NumericPasswordValidator()]
    for validator in validators:
        try:
            validator.validate(password, user=user)
        except DjangoValidationError as exc:
            errors.extend(exc.messages)

    if errors:
        raise DjangoValidationError(errors)
