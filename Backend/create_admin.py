import os
import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from django.contrib.auth import get_user_model

User = get_user_model()
email = "admin@example.com"
password = "password123"

if not User.objects.filter(email=email).exists():
    print(f"Creating superuser {email}...")
    User.objects.create_superuser(email=email, password=password, full_name="System Admin")
    print("Superuser created.")
else:
    print("Superuser already exists.")
