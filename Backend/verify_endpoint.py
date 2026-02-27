import os
import sys

import django
import requests

# Setup Django
sys.path.append(os.getcwd())
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from django.contrib.auth import get_user_model  # noqa: E402
from django.contrib.auth.models import Group  # noqa: E402

User = get_user_model()
email = "hr_manager_test@example.com"
password = "password123"

# Create HR Manager User if not exists
if not User.objects.filter(email=email).exists():
    user = User.objects.create_user(email=email, password=password, full_name="Test HR Manager")
    group, _ = Group.objects.get_or_create(name="HRManager")
    user.groups.add(group)
    user.save()
    print(f"Created user: {email}")
else:
    user = User.objects.get(email=email)
    # Ensure role
    group, _ = Group.objects.get_or_create(name="HRManager")
    if not user.groups.filter(name="HRManager").exists():
        user.groups.add(group)
        print("Added HRManager role to existing user.")

# Get Token
login_url = "http://localhost:8000/auth/login"
response = requests.post(login_url, json={"email": email, "password": password})

if response.status_code != 200:
    print(f"Login failed: {response.text}")
    sys.exit(1)

token = response.json()["data"]["token"]
print("Login successful. Token obtained.")

# Test /users endpoint
users_url = "http://localhost:8000/users?page_size=1000"
headers = {"Authorization": f"Bearer {token}"}

print(f"Testing GET {users_url}...")
response = requests.get(users_url, headers=headers)

print(f"Status Code: {response.status_code}")
if response.status_code == 200:
    # Print first few users to verify structure
    data = response.json()
    items = data.get("data", {}).get("results", []) or data.get("data", {}).get("items", [])
    print(f"Successfully retrieved {len(items)} users.")
    if items:
        print("Sample user:", items[0])
else:
    print("Error Response:", response.text)
