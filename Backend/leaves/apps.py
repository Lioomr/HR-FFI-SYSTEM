from django.apps import AppConfig


class LeavesConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "leaves"

    def ready(self):
        from .annual_document_integrity import register as register_annual_entitlements
        from .document_integrity import register

        register()
        register_annual_entitlements()
