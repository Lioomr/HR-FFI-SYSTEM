from django.db import migrations


def seed_business_trip_leave_type(apps, schema_editor):
    LeaveType = apps.get_model("leaves", "LeaveType")
    OrganizationNode = apps.get_model("organization", "OrganizationNode")
    companies = OrganizationNode.objects.filter(node_type="company", is_active=True)
    for company in companies:
        leave_type, created = LeaveType.objects.get_or_create(
            company=company,
            code="BUSINESS_TRIP",
            defaults={
                "name": "Business Trip",
                "is_paid": True,
                "requires_ceo_approval": True,
                "is_active": True,
                "annual_quota": 0,
            },
        )
        update_fields = []
        if not leave_type.requires_ceo_approval:
            leave_type.requires_ceo_approval = True
            update_fields.append("requires_ceo_approval")
        if not leave_type.is_active:
            leave_type.is_active = True
            update_fields.append("is_active")
        if not leave_type.name:
            leave_type.name = "Business Trip"
            update_fields.append("name")
        if update_fields:
            leave_type.save(update_fields=update_fields)


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("organization", "0001_initial"),
        ("leaves", "0014_leave_delegation_approval"),
    ]

    operations = [
        migrations.RunPython(seed_business_trip_leave_type, noop_reverse),
    ]
