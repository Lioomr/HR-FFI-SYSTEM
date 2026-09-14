"""Render fictional late-attendance notice references without database records."""

from __future__ import annotations

import os
import sys
from datetime import date
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "Backend"))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django  # noqa: E402

django.setup()

from django.utils import timezone  # noqa: E402

from attendance.late_notices import build_late_notice_pdf  # noqa: E402


def make_notice(level: int):
    now = timezone.now()
    occurrence = level if level < 4 else 4
    percent = {1: Decimal("0"), 2: Decimal("0.05"), 3: Decimal("0.10"), 4: Decimal("0.50")}[level]
    amount = {1: Decimal("0.00"), 2: Decimal("5.00"), 3: Decimal("10.00"), 4: Decimal("50.00")}[level]
    profile = SimpleNamespace(
        full_name_en="Sample Employee",
        full_name_ar="موظف تجريبي",
        full_name="Sample Employee",
        employee_id="EMP-00042",
    )
    result = SimpleNamespace(shift_start_at=now.replace(hour=9, minute=0), first_check_in_at=now.replace(hour=9, minute=30))
    violation = SimpleNamespace(result=result, date=date(2026, 9, 14), occurrence_number=occurrence, reason="outside_grace")
    return SimpleNamespace(
        violation=violation,
        company=SimpleNamespace(name="Sample Company", code="SAMPLE", logo=None),
        employee_profile=profile,
        notice_reference=f"LAN-SAMPLE-0000{level}",
        level=level,
        penalty_percent=percent,
        penalty_amount=amount,
        generated_at=now,
    )


for level in range(1, 5):
    output = Path(__file__).with_name(f"late-attendance-notice-level-{level}-reference.pdf")
    output.write_bytes(build_late_notice_pdf(make_notice(level)))
    print(output)
