from django.db import migrations


def seed_catalog(apps, schema_editor):
    from penalties.catalog import CATALOG

    model = apps.get_model("penalties", "PenaltyCatalog")
    model.objects.bulk_create([model(**row) for row in CATALOG], ignore_conflicts=True)


def unseed_catalog(apps, schema_editor):
    model = apps.get_model("penalties", "PenaltyCatalog")
    model.objects.filter(
        code__in=[f"W{n:02d}" for n in range(1, 17)]
        + [f"O{n:02d}" for n in range(1, 19)]
        + [f"B{n:02d}" for n in range(1, 17)]
    ).delete()


class Migration(migrations.Migration):
    dependencies = [("penalties", "0001_initial")]
    operations = [migrations.RunPython(seed_catalog, unseed_catalog)]
