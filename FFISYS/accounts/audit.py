from .models import AuditLog


def log_action(actor, action, target="", ip=None):
    AuditLog.objects.create(
        actor=actor,
        action=action,
        target=target,
        ip_address=ip,
    )
