import os

import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from django.contrib.auth import get_user_model  # noqa: E402

User = get_user_model()
email = "testuser@example.com"
password = "password123"

if not User.objects.filter(email=email).exists():
    print(f"Creating user {email}...")
    User.objects.create_user(email=email, password=password, full_name="Test User")
    print("User created.")
else:
    print("User already exists.")
