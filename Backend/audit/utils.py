from django.conf import settings

from .models import AuditLog


def get_client_ip(request):
    remote_addr = request.META.get("REMOTE_ADDR")
    trusted_proxies = set(getattr(settings, "TRUSTED_PROXY_IPS", []))
    if remote_addr and remote_addr in trusted_proxies:
        xff = request.META.get("HTTP_X_FORWARDED_FOR")
        if xff:
            return xff.split(",")[0].strip()
    return remote_addr


def audit(request, action, entity="", entity_id="", metadata=None, actor=None):
    """
    Creates an audit log record.
    Required fields (Phase 1):
    - who (actor)
    - action
    - entity + entity_id
    - timestamp (created_at)
    - ip address
    """
    AuditLog.objects.create(
        actor=actor or (request.user if request and request.user.is_authenticated else None),
        action=action,
        entity=entity or "",
        entity_id=str(entity_id) if entity_id else "",
        ip_address=get_client_ip(request) if request else None,
        metadata=metadata or {},
    )
