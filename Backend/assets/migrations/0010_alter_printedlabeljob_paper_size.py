from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("assets", "0009_alter_printedlabeljob_paper_size")]

    operations = [
        migrations.AlterField(
            model_name="printedlabeljob",
            name="paper_size",
            field=models.CharField(
                choices=[
                    ("2X1", "2x1 inch"),
                    ("4X6", "4x6 inch"),
                    ("50X30", "50x30 mm"),
                    ("40X30", "40x30 mm"),
                    ("60X40", "60x40 mm"),
                    ("A4_GRID", "A4 grid"),
                ],
                max_length=20,
            ),
        ),
    ]
