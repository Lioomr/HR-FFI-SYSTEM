from django.apps import AppConfig


class JobOffersConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "job_offers"

    def ready(self):
        from .document_integrity import register

        register()
