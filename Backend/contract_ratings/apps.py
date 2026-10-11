from django.apps import AppConfig


class ContractRatingsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "contract_ratings"

    def ready(self):
        from .document_integrity import register

        register()
