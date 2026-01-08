from django.db import models
from django.contrib.auth.models import AbstractUser
from django.conf import settings
import uuid


class User(AbstractUser):
    ROLE_CHOICES = (
        ("ADMIN", "Admin"),
        ("HR", "HR"),
        ("EMPLOYEE", "Employee"),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(unique=True)
    role = models.CharField(max_length=20, choices=ROLE_CHOICES, default="EMPLOYEE")

    must_change_password = models.BooleanField(default=False)
    invite_expires_at = models.DateTimeField(null=True, blank=True)

    username = None
    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = []

    def __str__(self):
        return self.email


class AuditLog(models.Model):
    ACTION_CHOICES = (
        ("LOGIN", "Login"),
        ("LOGOUT", "Logout"),
        ("CREATE_USER", "Create User"),
        ("UPDATE_USER", "Update User"),
        ("CHANGE_PASSWORD", "Change Password"),
        ("DEACTIVATE_USER", "Deactivate User"),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="audit_actions",
    )
    action = models.CharField(max_length=50, choices=ACTION_CHOICES)
    target = models.CharField(max_length=255, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    timestamp = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.action} by {self.actor}"
