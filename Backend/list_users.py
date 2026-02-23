import os
import django
import sys

sys.path.append(os.getcwd())
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from django.contrib.auth import get_user_model

User = get_user_model()
users = User.objects.all().order_by('id')

print(f"Total Users: {users.count()}")
print("-" * 100)
print(f"{'ID':<4} | {'Email':<30} | {'Is Superuser':<12} | {'Is Staff':<8} | {'Pro Groups'}")
print("-" * 100)

for user in users:
    groups = list(user.groups.values_list('name', flat=True))
    groups_str = ", ".join(groups) if groups else "No Groups"
    print(f"{user.id:<4} | {user.email:<30} | {str(user.is_superuser):<12} | {str(user.is_staff):<8} | {groups_str}")
print("-" * 100)
