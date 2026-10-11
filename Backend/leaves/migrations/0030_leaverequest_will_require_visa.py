from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("leaves", "0029_leave_request_public_reference")]

    operations = [
        migrations.AddField(
            model_name="leaverequest",
            name="will_require_visa",
            field=models.BooleanField(
                blank=True,
                help_text="Whether the employee expects to require a visa for this leave. Null for earlier requests.",
                null=True,
            ),
        ),
    ]
