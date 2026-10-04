from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("leaves", "0028_annualleavepaymentrequest_employee_preference")]

    operations = [
        migrations.AddField(
            model_name="leaverequest",
            name="reference_no",
            field=models.CharField(blank=True, editable=False, max_length=40, null=True, unique=True),
        ),
        migrations.AddField(
            model_name="leaverequest",
            name="reference_sequence",
            field=models.PositiveIntegerField(blank=True, editable=False, null=True),
        ),
        migrations.AddConstraint(
            model_name="leaverequest",
            constraint=models.UniqueConstraint(
                fields=("employee_profile", "reference_sequence"), name="unique_leave_employee_reference_sequence"
            ),
        ),
    ]
