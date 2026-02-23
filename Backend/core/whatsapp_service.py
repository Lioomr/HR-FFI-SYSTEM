from core.services.whatsapp_service import (
    WhatsAppService,
    WHATSAPP_TEMPLATE_REGISTRY,
    get_template_info,
    resolve_template_key,
)


class BirdWhatsAppTemplateService(WhatsAppService):
    def send_template(
        self,
        *,
        phone_number: str,
        template_key: str | None = None,
        variables: dict,
        language: str = "en",
        context: dict | None = None,
    ) -> dict:
        resolved_template = resolve_template_key(
            template_name=template_key,
            event=(context or {}).get("event"),
            template_variables=variables,
        )
        if not resolved_template:
            return {
                "sent": False,
                "provider": "bird_whatsapp",
                "status_code": None,
                "reason": "No matching WhatsApp template found for the provided payload.",
            }

        result = self.send_template_message(
            phone_number=phone_number,
            template_name=resolved_template,
            template_variables=variables,
            language=language,
        )
        if result.get("success"):
            return {
                "sent": True,
                "provider": "bird_whatsapp",
                "status_code": result.get("status_code"),
                "template_key": resolved_template,
            }
        return {
            "sent": False,
            "provider": "bird_whatsapp",
            "status_code": result.get("status_code"),
            "reason": result.get("error"),
            "template_key": resolved_template,
        }


def send_whatsapp_notification(
    phone_number: str,
    template_name: str,
    template_params: list,
    language: str = "en",
) -> dict:
    spec = WHATSAPP_TEMPLATE_REGISTRY.get(template_name)
    if not spec:
        return {
            "sent": False,
            "provider": "bird_whatsapp",
            "reason": f"Unknown WhatsApp template key: {template_name}",
        }

    if len(template_params) != len(spec.variable_order):
        return {
            "sent": False,
            "provider": "bird_whatsapp",
            "reason": (
                f"Template '{template_name}' expects {len(spec.variable_order)} params, "
                f"got {len(template_params)}."
            ),
        }

    variables = {name: value for name, value in zip(spec.variable_order, template_params, strict=False)}
    result = WhatsAppService().send_template_message(
        phone_number=phone_number,
        template_name=template_name,
        template_variables=variables,
        language=language,
    )
    if result.get("success"):
        return {"sent": True, "provider": "bird_whatsapp", "status_code": result.get("status_code")}
    return {
        "sent": False,
        "provider": "bird_whatsapp",
        "status_code": result.get("status_code"),
        "reason": result.get("error"),
    }
