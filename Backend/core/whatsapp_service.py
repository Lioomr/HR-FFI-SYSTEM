from core.services.whatsapp_service import WHATSAPP_TEMPLATE_REGISTRY, WhatsAppService


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
            "provider": "evolution_whatsapp",
            "reason": f"Unknown WhatsApp template key: {template_name}",
        }

    if len(template_params) != len(spec.variable_order):
        return {
            "sent": False,
            "provider": "evolution_whatsapp",
            "reason": (
                f"Template '{template_name}' expects {len(spec.variable_order)} params, got {len(template_params)}."
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
        return {
            "sent": True,
            "provider": result.get("provider", "evolution_whatsapp"),
            "status_code": result.get("status_code"),
        }
    return {
        "sent": False,
        "provider": result.get("provider", "evolution_whatsapp"),
        "status_code": result.get("status_code"),
        "reason": result.get("error"),
    }
