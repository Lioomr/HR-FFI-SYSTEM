import os
import sys
from datetime import date

import django

# Setup Django environment
sys.path.append(os.getcwd())
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from django.contrib.auth import get_user_model  # noqa: E402

from employees.models import EmployeeProfile  # noqa: E402

User = get_user_model()
email = "testuser@example.com"

try:
    user = User.objects.get(email=email)
    print(f"User found: {user.email}")

    # Check if we need to provide employee_id manually
    # Since we didn't find any auto-generation logic in obvious places, providing one is safer.
    profile, created = EmployeeProfile.objects.get_or_create(
        user=user,
        defaults={
            "employee_id": "EMP-TEST-001",
            "job_title": "Software Engineer",
            "department": "Engineering",
            "hire_date": date(2023, 1, 1),  # Corrected field name
            # "phone_number": "1234567890", # Assuming optional or not needed based on previous error
        },
    )

    if created:
        print(f"Created EmployeeProfile for {user.email} (ID: {profile.id})")
    else:
        print(f"EmployeeProfile already exists for {user.email} (ID: {profile.id})")

except User.DoesNotExist:
    print(f"User {email} not found. Please run create_test_user.py first.")
except Exception as e:
    print(f"Error creating profile: {e}")
