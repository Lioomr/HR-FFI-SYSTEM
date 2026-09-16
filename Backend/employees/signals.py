"""Best-effort cache invalidation for the employee list response cache.

This is deliberately narrow: it only reacts to EmployeeProfile writes (not
every related model -- Department/Position renames, LeaveRequest changes,
etc. -- that could also change what the list looks like). The short TTL on
the employee list cache (``settings.EMPLOYEE_LIST_CACHE_SECONDS``, see
``employees/views.py``) already bounds staleness from those other write
paths; this signal is only a nicer-UX bump so an HR user who just edited a
profile sees the change immediately instead of waiting out the TTL.
"""

from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from core.response_cache import bump_cache_version

from .cache import employee_list_cache_version_key
from .models import EmployeeProfile


@receiver(post_save, sender=EmployeeProfile)
def bump_employee_list_cache_on_save(sender, instance, **kwargs):
    if instance.company_id:
        bump_cache_version(employee_list_cache_version_key(instance.company_id))


@receiver(post_delete, sender=EmployeeProfile)
def bump_employee_list_cache_on_delete(sender, instance, **kwargs):
    if instance.company_id:
        bump_cache_version(employee_list_cache_version_key(instance.company_id))
