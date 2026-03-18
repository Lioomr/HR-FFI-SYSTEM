from django.db import migrations


def rename_exceptional_to_unpaid(apps, schema_editor):
    LeaveType = apps.get_model("leaves", "LeaveType")
    LeaveRequest = apps.get_model("leaves", "LeaveRequest")
    LeaveBalanceSnapshot = apps.get_model("leaves", "LeaveBalanceSnapshot")
    LeaveBalanceAdjustment = apps.get_model("leaves", "LeaveBalanceAdjustment")

    exceptional = LeaveType.objects.filter(code="EXCEPTIONAL").first()
    unpaid = LeaveType.objects.filter(code="UNPAID").first()

    if exceptional and unpaid:
        LeaveRequest.objects.filter(leave_type_id=exceptional.pk).update(leave_type_id=unpaid.pk)
        LeaveBalanceSnapshot.objects.filter(leave_type_id=exceptional.pk).update(leave_type_id=unpaid.pk)
        LeaveBalanceAdjustment.objects.filter(leave_type_id=exceptional.pk).update(leave_type_id=unpaid.pk)
        LeaveType.objects.filter(pk=unpaid.pk).exclude(name="Unpaid Leave").update(name="Unpaid Leave")
        LeaveType.objects.filter(pk=unpaid.pk).exclude(is_paid=False).update(is_paid=False)
        LeaveType.objects.filter(pk=exceptional.pk).delete()
        return

    if exceptional:
        exceptional.code = "UNPAID"
        exceptional.name = "Unpaid Leave"
        exceptional.is_paid = False
        exceptional.save(update_fields=["code", "name", "is_paid", "updated_at"])

    if unpaid:
        changed = False
        if unpaid.name != "Unpaid Leave":
            unpaid.name = "Unpaid Leave"
            changed = True
        if unpaid.is_paid:
            unpaid.is_paid = False
            changed = True
        if changed:
            unpaid.save(update_fields=["name", "is_paid", "updated_at"])


class Migration(migrations.Migration):
    dependencies = [
        ("leaves", "0010_leavebalanceadjustment_employee_profile_nullable_employee"),
    ]

    operations = [
        migrations.RunPython(rename_exceptional_to_unpaid, migrations.RunPython.noop),
    ]
