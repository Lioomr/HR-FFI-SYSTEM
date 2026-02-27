import os

import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from leaves.models import LeaveType  # noqa: E402

types = [
    {"name": "Annual Leave", "code": "ANNUAL", "days": 21, "is_paid": True},
    {"name": "Sick Leave", "code": "SICK", "days": 14, "is_paid": True},
    {"name": "Maternity Leave", "code": "MATERNITY", "days": 90, "is_paid": True},
    {"name": "Unpaid Leave", "code": "UNPAID", "days": 0, "is_paid": False},
    {"name": "Other", "code": "OTHER", "days": 0, "is_paid": True},
]

for t in types:
    obj, created = LeaveType.objects.get_or_create(
        code=t["code"],
        defaults={"name": t["name"], "annual_quota": t["days"], "is_paid": t["is_paid"], "is_active": True},
    )
    if created:
        print(f"Created {t['name']}")
    else:
        print(f"Exists {t['name']}")
