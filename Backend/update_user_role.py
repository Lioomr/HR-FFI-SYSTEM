import os
import django
import sys

sys.path.append(os.getcwd())
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group

User = get_user_model()
email = 'testuser@example.com'

try:
    user = User.objects.get(email=email)
    
    # Ensure Group exists
    group, _ = Group.objects.get_or_create(name='SystemAdmin')
    
    # Clear existing groups and add SystemAdmin
    user.groups.clear()
    user.groups.add(group)
    
    # Also set the role field if it exists, for consistency/frontend usage if any
    if hasattr(user, 'role'):
        user.role = 'SystemAdmin'
        user.save()

    print(f"Added {email} to SystemAdmin group")
except User.DoesNotExist:
    print(f"User {email} not found")
except Exception as e:
    print(f"Error: {e}")
