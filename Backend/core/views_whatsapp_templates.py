from __future__ import annotations

from typing import Any

from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView

from accounts.permissions import IsSystemAdmin
from audit.utils import audit
from core.models import WhatsAppMessageTemplate
from core.responses import error, success
from core.services.messaging_providers import EvolutionWhatsAppProvider
from core.services.whatsapp_template_library import (
    ensure_known_template_key,
    get_template_definition,
    list_template_definitions,
    render_body_template,
    render_configured_template_message,
)
from employees.permissions import IsHRManagerOrAdmin


def _serialize_template(definition) -> dict[str, Any]:
    override = WhatsAppMessageTemplate.objects.filter(key=definition.key).first()
    return {
        "key": definition.key,
        "title": definition.title,
        "description": definition.description,
        "variables": list(definition.variables),
        "sample_variables": definition.sample_variables,
        "default_body": definition.default_body,
        "body": override.body if override else definition.default_body,
        "customized": bool(override),
        "updated_at": override.updated_at.isoformat() if override else None,
        "updated_by": getattr(override.updated_by, "email", None) if override and override.updated_by_id else None,
    }


class WhatsAppTemplateListView(APIView):
    permission_classes = [IsAuthenticated, IsHRManagerOrAdmin]

    def get(self, request):
        items = [_serialize_template(definition) for definition in list_template_definitions()]
        return success({"items": items, "count": len(items)})


class WhatsAppTemplateDetailView(APIView):
    permission_classes = [IsAuthenticated, IsHRManagerOrAdmin]

    def patch(self, request, key: str):
        if not ensure_known_template_key(key):
            return error("Not found", errors=["Unknown WhatsApp template."], status=404)

        body = str(request.data.get("body") or "").strip()
        if not body:
            return error("Validation error", errors={"body": ["Template body is required."]}, status=422)

        template, _ = WhatsAppMessageTemplate.objects.update_or_create(
            key=key,
            defaults={"body": body, "updated_by": request.user},
        )
        audit(
            request,
            "whatsapp_template_updated",
            entity="WhatsAppMessageTemplate",
            entity_id=template.id,
            metadata={"template_key": key},
        )
        definition = get_template_definition(key)
        return success(_serialize_template(definition), status=200)


class WhatsAppTemplateResetView(APIView):
    permission_classes = [IsAuthenticated, IsHRManagerOrAdmin]

    def post(self, request, key: str):
        if not ensure_known_template_key(key):
            return error("Not found", errors=["Unknown WhatsApp template."], status=404)
        deleted, _ = WhatsAppMessageTemplate.objects.filter(key=key).delete()
        audit(
            request,
            "whatsapp_template_reset",
            entity="WhatsAppMessageTemplate",
            entity_id=0,
            metadata={"template_key": key, "deleted": deleted},
        )
        definition = get_template_definition(key)
        return success(_serialize_template(definition))


class WhatsAppTemplatePreviewView(APIView):
    permission_classes = [IsAuthenticated, IsHRManagerOrAdmin]

    def post(self, request, key: str):
        definition = get_template_definition(key)
        if not definition:
            return error("Not found", errors=["Unknown WhatsApp template."], status=404)

        variables = request.data.get("variables")
        if not isinstance(variables, dict):
            variables = definition.sample_variables

        body = request.data.get("body")
        if isinstance(body, str) and body.strip():
            preview = render_body_template(body, variables)
        else:
            preview = render_configured_template_message(key, variables)
        return success({"preview": preview, "variables": variables})


class WhatsAppTemplateTestView(APIView):
    permission_classes = [IsAuthenticated, IsSystemAdmin]

    def post(self, request, key: str):
        definition = get_template_definition(key)
        if not definition:
            return error("Not found", errors=["Unknown WhatsApp template."], status=404)

        phone_number = str(request.data.get("phone_number") or "").strip()
        if not phone_number:
            return error("Validation error", errors={"phone_number": ["phone_number is required."]}, status=422)

        variables = request.data.get("variables")
        if not isinstance(variables, dict):
            variables = definition.sample_variables

        body = request.data.get("body")
        if isinstance(body, str) and body.strip():
            text = render_body_template(body, variables)
        else:
            text = render_configured_template_message(key, variables)

        result = EvolutionWhatsAppProvider().send_text(phone_number=phone_number, text=text, event=f"template_test:{key}")
        return success(result)
