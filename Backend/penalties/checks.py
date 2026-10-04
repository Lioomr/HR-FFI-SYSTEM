from django.core.checks import Error, register
from django.core.exceptions import ImproperlyConfigured

from .services import auto_warning_settle_hours, auto_warnings_effective_from, effective_from


@register()
def check_penalties_effective_from(app_configs, **kwargs):
    errors = []
    for check, error_id in (
        (effective_from, "penalties.E001"),
        (auto_warnings_effective_from, "penalties.E002"),
        (auto_warning_settle_hours, "penalties.E003"),
    ):
        try:
            check()
        except ImproperlyConfigured as exc:
            errors.append(Error(str(exc), id=error_id))
    return errors
