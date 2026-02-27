import os
import sys

import django

# Setup Django environment
sys.path.append(os.getcwd())
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from employees.models import EmployeeProfile  # noqa: E402

try:
    p = EmployeeProfile.objects.get(id=1)
    print(f"Employee found: {p}")
except EmployeeProfile.DoesNotExist:
    print("Employee with ID 1 does NOT exist.")
    print("Available employees:")
    for emp in EmployeeProfile.objects.all():
        print(f"ID: {emp.id}, User: {emp.user.email}")
