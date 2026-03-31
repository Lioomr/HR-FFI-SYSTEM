from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0001_initial"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="UserPreference",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("scope", models.CharField(max_length=100)),
                ("key", models.CharField(max_length=100)),
                ("value", models.JSONField(blank=True, default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="preferences",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "ordering": ["scope", "key", "id"],
            },
        ),
        migrations.AddConstraint(
            model_name="userpreference",
            constraint=models.UniqueConstraint(
                fields=("user", "scope", "key"),
                name="core_userpref_unique_user_scope_key",
            ),
        ),
        migrations.AddIndex(
            model_name="userpreference",
            index=models.Index(fields=["user", "scope"], name="core_userpref_user_scope_idx"),
        ),
    ]
