from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("payroll", "0011_nullable_assignment_actors")]
    operations = [
        migrations.AddField(model_name="payrollrunitem", name="is_active", field=models.BooleanField(default=True))
    ]
