"""HR payroll-run PDF report.

Presentation only: every figure comes from the stored run, items, lines and the
read-only DTO helpers. Money is Decimal throughout; nothing is recalculated
except department subtotals, which are plain sums of the displayed rows.
The document is rendered in the active request language (English or Arabic).
"""

import io
import re
from collections import Counter, defaultdict
from decimal import ROUND_HALF_UP, Decimal
from fractions import Fraction
from xml.sax.saxutils import escape

from arabic_reshaper import ArabicReshaper
from arabic_reshaper.ligatures import LIGATURES
from bidi.algorithm import get_display
from django.db.models import prefetch_related_objects
from django.utils import timezone
from django.utils.translation import get_language
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas as pdf_canvas
from reportlab.platypus import (
    CondPageBreak,
    Image,
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from core.pdf import PALETTE, build_signature_stamp_block, font_pair, get_logo_path

from . import dto
from .i18n import translated as t

ZERO = Decimal(0)
CENT = Decimal("0.01")
PAGE = landscape(A4)
SIDE_MARGIN = 12 * mm
# SimpleDocTemplate frames keep 6pt padding on each side.
WIDTH = PAGE[0] - 2 * SIDE_MARGIN - 12
PADDING = 4
PROVISION_TYPES = (
    "MEDICAL",
    "ID_COST",
    "AIR_TICKET",
    "LEAVE_PROVISION",
    "EOS_PROVISION",
    "ACCOMMODATION_COST",
    "GOSI_COMPANY",
)
BASE_SETTINGS = (
    ("absence_base", "payroll.pdf.absence_base"),
    ("gosi_base", "payroll.pdf.gosi_base"),
    ("leave_base", "payroll.pdf.leave_base"),
    ("eos_base", "payroll.pdf.eos_base"),
    ("overtime_base", "payroll.pdf.overtime_base"),
)
ARABIC = re.compile("[؀-ۿ]")
WHITE = colors.white
ORANGE = PALETTE["primary_orange"]
LIGHT = PALETTE["light_orange"]
SOFT = PALETTE["soft_orange"]
GRID = PALETTE["grid_orange"]
BORDER = PALETTE["border_orange"]
DARK = PALETTE["dark_text"]
MUTED = PALETTE["muted_text"]


def money(value):
    """Display a money value (Decimal or DTO decimal string); None stays None."""

    return None if value is None else f"{Decimal(value):,.2f}"


def share(value):
    """Display an ExactShare at two decimals; mark it when the fraction repeats."""

    exact = Fraction(Decimal(value["numerator"])) / int(value["denominator"])
    shown = (Decimal(exact.numerator) / Decimal(exact.denominator)).quantize(CENT, ROUND_HALF_UP)
    return ("≈ " if Fraction(shown) != exact else "") + f"{shown:,.2f}"


def rate(value):
    percent = (Decimal(value) * 100).quantize(Decimal("0.0001")).normalize()
    return f"{percent:f}%"


class Writer:
    """Fonts, shaping and table mirroring for one document language."""

    def __init__(self):
        self.rtl = (get_language() or "en").lower().startswith("ar")
        self.regular, self.bold = font_pair()
        # Only use ligatures the font can draw: DejaVu has no glyph for e.g. the Allah ligature (U+FDF2),
        # which reportlab would print as an empty box inside names such as "Abdullah".
        glyphs = getattr(getattr(pdfmetrics.getFont(self.regular), "face", None), "charToGlyph", {})
        self.reshaper = ArabicReshaper(
            configuration={
                name: all(ord(char) in glyphs for form in forms for char in form or "")
                for name, (_, forms) in LIGATURES
            }
        )

    def shape(self, text):
        """Shape Arabic letters and reorder for display, like core.pdf.shape_ar but font-aware."""

        value = str(text or "").strip()
        if not ARABIC.search(value):
            return value
        return get_display(self.reshaper.reshape(value))

    def style(self, size=7.5, bold=False, color=DARK, align=None, leading=None):
        if align is None:
            align = TA_RIGHT if self.rtl else TA_LEFT
        return ParagraphStyle(
            "PayrollReport",
            fontName=self.bold if bold else self.regular,
            fontSize=size,
            leading=leading or size * 1.3,
            textColor=color,
            alignment=align,
        )

    def lines(self, text, width, style):
        """Wrap Arabic text in logical order, then shape each visual line."""

        text = " ".join(str(text if text is not None else "").split())
        if not ARABIC.search(text):
            return [escape(text)]
        lines, current = [], ""
        for word in text.split(" "):
            candidate = f"{current} {word}".strip()
            if current and stringWidth(self.shape(candidate), style.fontName, style.fontSize) > width:
                lines.append(current)
                current = word
            else:
                current = candidate
        lines.append(current)
        return [escape(self.shape(line)) for line in lines]

    def para(self, text, width, size=7.5, bold=False, color=DARK, align=None):
        style = self.style(size, bold, color, align)
        parts = text if isinstance(text, (list, tuple)) else [text]
        rendered = [line for part in parts for line in self.lines(part, width - 2 * PADDING, style)]
        return Paragraph("<br/>".join(rendered) or "&nbsp;", style)

    def heading(self, text, size=12):
        return self.para(text, WIDTH, size=size, bold=True)

    def note(self, text, width=WIDTH):
        return self.para(text, width, size=7, color=MUTED)

    def table(self, rows, widths, commands=(), header_rows=1, font_size=7.5):
        count = len(widths)
        rows = [[self.shape(cell) if isinstance(cell, str) else cell for cell in row] for row in rows]

        def flip(col):
            return count - 1 - (col if col >= 0 else count + col)

        commands = list(commands)
        if self.rtl:
            rows = [list(reversed(row)) for row in rows]
            widths = list(reversed(widths))
            commands = [
                (name, (flip(end[0]), start[1]), (flip(start[0]), end[1]), *rest)
                for name, start, end, *rest in commands
            ]
            # A span draws its first cell; after mirroring the content sits in its last cell.
            for name, (first, top), (last, bottom), *_ in commands:
                if name == "SPAN":
                    for index in range(top % len(rows), bottom % len(rows) + 1):
                        rows[index][first], rows[index][last] = rows[index][last], rows[index][first]
        table = Table(rows, colWidths=widths, repeatRows=header_rows)
        base = [
            ("FONTNAME", (0, 0), (-1, -1), self.regular),
            ("FONTSIZE", (0, 0), (-1, -1), font_size),
            ("TEXTCOLOR", (0, 0), (-1, -1), DARK),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("BOX", (0, 0), (-1, -1), 0.6, BORDER),
            ("INNERGRID", (0, 0), (-1, -1), 0.25, GRID),
            ("LEFTPADDING", (0, 0), (-1, -1), PADDING),
            ("RIGHTPADDING", (0, 0), (-1, -1), PADDING),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ]
        if header_rows:
            base += [
                ("BACKGROUND", (0, 0), (-1, header_rows - 1), ORANGE),
                ("TEXTCOLOR", (0, 0), (-1, header_rows - 1), WHITE),
                ("FONTNAME", (0, 0), (-1, header_rows - 1), self.bold),
            ]
        table.setStyle(TableStyle(base + commands))
        return table

    def header_cells(self, labels, widths):
        return [
            self.para(label, width, bold=True, color=WHITE, align=TA_CENTER)
            for label, width in zip(labels, widths, strict=True)
        ]


class _Collected:
    """Plain data for the report, gathered once with a bounded number of queries."""

    def __init__(self, run, items):
        from .models import PayrollAdjustment, PayrollRun

        self.run = run
        self.items = list(items)
        self.model = isinstance(run, PayrollRun)
        self.legacy = bool(getattr(run, "legacy_calculation", True))
        self.status = str(getattr(run, "status", "") or "DRAFT")
        self.lines = {}
        self.adjustments = Counter()
        self.blocking = defaultdict(list)
        self.validation = {"errors": [], "warnings": [], "infos": [], "counts": {"errors": 0, "warnings": 0}}
        self.excluded = 0
        self.rents = []
        self.settings = getattr(run, "settings_snapshot", None) or {}
        self.company_name = ""
        if self.model:
            prefetch_related_objects(self.items, "lines")
            self.lines = {item.pk: sorted(item.lines.all(), key=lambda line: line.pk) for item in self.items}
            self.totals = dto.run_totals(run, self.items)
            self.validation = dto.validation(run)
            self.excluded = self.validation["excluded_employees_checked"]
            self.adjustments = Counter(
                PayrollAdjustment.objects.filter(run=run, item_id__in=[item.pk for item in self.items]).values_list(
                    "item_id", flat=True
                )
            )
            for issue in self.validation["errors"]:
                if issue.get("employee") and issue["employee"].get("item_id"):
                    self.blocking[issue["employee"]["item_id"]].append(issue["message"])
            self.rents = [dto.rent_dto(a) for a in run.rent_allocations.select_related("run").order_by("rent_id")]
            self.company_name = run.company.name if run.company_id else ""
        else:
            self.totals = {
                "total_net": dto.amount(getattr(run, "total_net", ZERO)),
                "total_gross": dto.amount(sum((self.gross(item) for item in self.items), ZERO)),
                "total_additions": None,
                "total_deductions": dto.amount(sum((item.total_deductions or ZERO for item in self.items), ZERO)),
                "total_provisions": None,
                "total_company_cost": None,
                "cost_incomplete": True,
            }

    def gross(self, item):
        if self.legacy:
            return (item.basic_salary or ZERO) + (item.total_allowances or ZERO)
        return item.gross_salary

    def item_lines(self, item):
        return self.lines.get(getattr(item, "pk", None), [])

    def executive(self, item):
        return bool((getattr(item, "input_snapshot", None) or {}).get("source", {}).get("executive_exempt"))


def build_payroll_report_pdf(run, items):
    writer = Writer()
    data = _Collected(run, items)
    status_label = t("payroll.status." + data.status.lower())
    run_period = dto.run_dto(run)
    period_day_count = run_period["calendar_days"] or int(run_period["period_end"][-2:])
    period = (
        f"{run_period['period_start']} – {run_period['period_end']} "
        f"({period_day_count} {t('payroll.pdf.calendar_days')})"
    )
    generated = timezone.localtime(timezone.now()).strftime("%Y-%m-%d %H:%M")
    title = t("payroll.pdf.run_report_title")

    story = _summary(writer, data, title, period, status_label, generated)
    story += _register(writer, data)
    if data.items:
        story += _exceptions(writer, data)
        story += _provisions(writer, data)
        story += _accommodation(writer, data)
    story += _notes_and_approval(writer, data)

    furniture = {
        "start": " | ".join(part for part in (data.company_name, title) if part),
        "end": f"{period} | {status_label}",
        "generated": f"{t('payroll.pdf.generated_at')} {generated}",
    }
    return _render(story, writer, furniture, title)


def _summary(w, data, title, period, status_label, generated):
    run = data.run
    totals = data.totals
    story = [_corporate_header(w, data.company_name, title, f"{period} | {status_label}"), Spacer(1, 6)]

    if data.status in ("COMPLETED", "PAID"):
        state = t("payroll.finalize_state.finalized")
    elif data.status == "DRAFT":
        counts = data.validation["counts"]
        state = "{}: {}".format(
            t("payroll.pdf.blocked") if counts["errors"] else t("payroll.pdf.ready_to_finalize"),
            t("payroll.pdf.validation_counts").format(errors=counts["errors"], warnings=counts["warnings"]),
        )
    else:
        state = t("payroll.finalize_state.not_finalized")

    label_w, value_w = 42 * mm, WIDTH / 2 - 42 * mm
    pairs = [
        (t("payroll.pdf.period"), period, t("payroll.pdf.status"), status_label),
        (t("payroll.pdf.run_id"), str(run.id), t("payroll.pdf.generated_at"), generated),
        (
            t("payroll.pdf.employees_included"),
            str(len(data.items)),
            t("payroll.pdf.employees_excluded"),
            str(data.excluded),
        ),
    ]
    rows = [
        [
            w.para(a, label_w, bold=True),
            w.para(b, value_w),
            w.para(c, label_w, bold=True),
            w.para(d, value_w),
        ]
        for a, b, c, d in pairs
    ]
    rows.append(
        [w.para(t("payroll.pdf.validation_status"), label_w, bold=True), w.para(state, WIDTH - label_w), "", ""]
    )
    story.append(
        w.table(
            rows,
            [label_w, value_w, label_w, value_w],
            [
                ("SPAN", (1, 3), (3, 3)),
                ("BACKGROUND", (0, 0), (0, -1), SOFT),
                ("BACKGROUND", (2, 0), (2, -2), SOFT),
            ],
            header_rows=0,
        )
    )
    if data.legacy and data.model:
        story += [Spacer(1, 6), _banner(w, t("payroll.pdf.legacy_banner"))]

    story += [Spacer(1, 8), w.heading(t("payroll.pdf.key_figures"), 11), Spacer(1, 3)]
    unavailable = t("payroll.pdf.not_available_legacy") if data.legacy else t("payroll.pdf.not_available")
    figures = [
        (t("payroll.field.gross_salary"), totals["total_gross"]),
        (t("payroll.field.total_additions"), totals["total_additions"]),
        (t("payroll.field.total_deductions"), totals["total_deductions"]),
        (t("payroll.field.net_salary"), totals["total_net"]),
        (t("payroll.pdf.provisions"), totals["total_provisions"]),
        (t("payroll.field.total_company_cost"), totals["total_company_cost"]),
    ]
    card_w = WIDTH / 3
    cards = []
    for label, value in figures:
        shown = money(value)
        cards.append(
            [
                w.para(label, card_w, size=8, color=MUTED),
                w.para(shown, card_w, size=14, bold=True) if shown else w.para(unavailable, card_w, size=9),
            ]
        )
    story.append(
        w.table(
            [cards[:3], cards[3:]],
            [card_w] * 3,
            [("BACKGROUND", (0, 0), (-1, -1), SOFT), ("TOPPADDING", (0, 0), (-1, -1), 6)],
            header_rows=0,
        )
    )
    notes = [t("payroll.pdf.amounts_in_sar"), t("payroll.pdf.provisions_note")]
    if totals["cost_incomplete"] and not data.legacy:
        notes.insert(0, _cost_incomplete_note(data))
    story += [Spacer(1, 3)] + [w.note(text) for text in notes]

    issues = data.validation["errors"] + data.validation["warnings"] + data.validation["infos"]
    if issues:
        story += [Spacer(1, 8), w.heading(t("payroll.pdf.validation_issues"), 11), Spacer(1, 3)]
        groups = {}
        for issue in issues:
            key = (issue.get("message_key") or issue["code"], issue["severity"])
            group = groups.setdefault(key, {"messages": set(), "employees": set(), "run": False})
            group["messages"].add(issue["message"])
            if issue.get("employee"):
                group["employees"].add(issue["employee"].get("employee_profile_id"))
            else:
                group["run"] = True
        widths = [WIDTH - 70 * mm, 30 * mm, 40 * mm]
        rows = [
            w.header_cells(
                [t("payroll.pdf.issue"), t("payroll.pdf.severity"), t("payroll.pdf.employees_affected")], widths
            )
        ]
        order = {"error": 0, "warning": 1, "info": 2}
        for (key, severity), group in sorted(groups.items(), key=lambda kv: (order.get(kv[0][1], 3), kv[0][0])):
            messages = group["messages"]
            message = (
                next(iter(messages))
                if len(messages) == 1
                else re.sub(r"\{\w+\}", "...", t(key) if key.startswith("payroll.") else next(iter(messages)))
            )
            affected = str(len(group["employees"])) if group["employees"] else t("payroll.pdf.whole_run")
            rows.append(
                [
                    w.para(message, widths[0]),
                    w.para(t("payroll.validation_severity." + severity), widths[1], align=TA_CENTER),
                    w.para(affected, widths[2], align=TA_CENTER),
                ]
            )
        story.append(w.table(rows, widths))
    return story


def _cost_incomplete_note(data):
    counts = Counter(
        line.type
        for item in data.items
        for line in data.item_lines(item)
        if line.category == "PROVISION" and line.amount is None
    )
    parts = []
    medical_missing = data.settings.get("annual_medical_invoice") is None and not data.settings.get(
        "no_medical_insurance"
    )
    for kind in PROVISION_TYPES:
        if counts[kind]:
            part = t("payroll.pdf.unknown_for_employees").format(label=t(dto.LINE_KEYS[kind]), count=counts[kind])
            if kind == "MEDICAL" and medical_missing:
                part += f" ({t('payroll.pdf.medical_invoice_missing')})"
            parts.append(part)
    return t("payroll.pdf.cost_incomplete_note").format(details="; ".join(parts) or t("payroll.pdf.not_available"))


def _register(w, data):
    widths = [22 * mm, WIDTH - 203 * mm, 56 * mm, 25 * mm, 25 * mm, 25 * mm, 25 * mm, 25 * mm]
    labels = [
        t("payroll.pdf.employee_id"),
        t("payroll.pdf.employee_name"),
        t("payroll.pdf.department"),
        t("payroll.pdf.gross"),
        t("payroll.pdf.additions"),
        t("payroll.pdf.deductions"),
        t("payroll.pdf.net"),
        t("payroll.pdf.company_cost"),
    ]
    story = [PageBreak(), w.heading(t("payroll.pdf.employee_register")), w.note(t("payroll.pdf.amounts_in_sar"))]
    story.append(Spacer(1, 4))
    rows = [w.header_cells(labels, widths)]
    commands = [("ALIGN", (3, 1), (-1, -1), "RIGHT")]
    if not data.items:
        rows.append([w.para(t("payroll.pdf.no_employees"), WIDTH, align=TA_CENTER)] + [""] * 7)
        commands.append(("SPAN", (0, 1), (-1, 1)))
        story.append(w.table(rows, widths, commands))
        return story

    na = t("payroll.pdf.not_available")
    no_department = t("payroll.pdf.no_department")
    groups = defaultdict(list)
    for item in data.items:
        groups[" ".join((item.department or "").split())].append(item)
    ordered = sorted(groups, key=lambda name: (not name, name.casefold()))
    grand = [ZERO] * 5
    incomplete_marker = False

    def figures(item):
        cost = None if data.legacy else item.total_company_cost
        additions = None if data.legacy else item.total_additions
        return [data.gross(item), additions, item.total_deductions, item.net_salary, cost]

    for name in ordered:
        members = sorted(groups[name], key=lambda i: ((i.employee_name or "").casefold(), str(i.employee_id)))
        subtotal = [ZERO] * 5
        for item in members:
            values = figures(item)
            row_cells = [money(v) if v is not None else na for v in values]
            if not data.legacy and getattr(item, "cost_incomplete", False):
                row_cells[4] += " *"
                incomplete_marker = True
            rows.append(
                [
                    w.para(item.employee_id or "-", widths[0]),
                    w.para(item.employee_name or "-", widths[1]),
                    w.para(name or no_department, widths[2]),
                    *row_cells,
                ]
            )
            subtotal = [s + (v or ZERO) for s, v in zip(subtotal, values, strict=True)]
        grand = [g + s for g, s in zip(grand, subtotal, strict=True)]
        label = t("payroll.pdf.subtotal").format(department=name or no_department, count=len(members))
        rows.append([w.para(label, sum(widths[:3]), bold=True), "", ""] + _total_cells(subtotal, data.legacy, na))
        commands += [
            ("SPAN", (0, len(rows) - 1), (2, len(rows) - 1)),
            ("BACKGROUND", (0, len(rows) - 1), (-1, len(rows) - 1), LIGHT),
            ("FONTNAME", (3, len(rows) - 1), (-1, len(rows) - 1), w.bold),
        ]
    label = t("payroll.pdf.grand_total").format(count=len(data.items))
    rows.append([w.para(label, sum(widths[:3]), bold=True, color=WHITE), "", ""] + _total_cells(grand, data.legacy, na))
    commands += [
        ("SPAN", (0, -1), (2, -1)),
        ("BACKGROUND", (0, -1), (-1, -1), DARK),
        ("TEXTCOLOR", (0, -1), (-1, -1), WHITE),
        ("FONTNAME", (3, -1), (-1, -1), w.bold),
    ]
    story.append(w.table(rows, widths, commands))
    if incomplete_marker:
        story += [Spacer(1, 3), w.note(t("payroll.pdf.known_subtotal_marker"))]
    if data.legacy:
        story += [Spacer(1, 3), w.note(t("payroll.pdf.legacy_register_note"))]
    return story


def _total_cells(values, legacy, na):
    gross, additions, deductions, net, cost = values
    return [
        money(gross),
        na if legacy else money(additions),
        money(deductions),
        money(net),
        na if legacy else money(cost),
    ]


def _exceptions(w, data):
    widths = [22 * mm, 52 * mm, 42 * mm, 58 * mm, WIDTH - 174 * mm]
    story = [CondPageBreak(60 * mm), Spacer(1, 10), w.heading(t("payroll.pdf.exceptions"))]
    story += [w.note(t("payroll.pdf.exceptions_intro")), Spacer(1, 4)]
    rows = [
        w.header_cells(
            [
                t("payroll.pdf.employee_id"),
                t("payroll.pdf.employee_name"),
                t("payroll.pdf.department"),
                t("payroll.pdf.details"),
                t("payroll.pdf.notes"),
            ],
            widths,
        )
    ]
    no_department = t("payroll.pdf.no_department")
    for item in sorted(data.items, key=lambda i: ((i.employee_name or "").casefold(), str(i.employee_id))):
        lines = data.item_lines(item)
        amounts, notes = [], []
        for line in lines:
            label = dto.line_dto(line, compact=True)["label"]
            if line.category in ("ADDITION", "DEDUCTION") and line.amount:
                sign = "+" if line.category == "ADDITION" else "-"
                amounts.append(f"{label}: {sign}{money(line.amount)}")
            if line.uncollected_amount:
                notes.append(f"{label}, {t('payroll.field.carry_forward')}: {money(line.uncollected_amount)}")
        if not lines and item.total_deductions:
            label = t(dto.LINE_KEYS["PREVIOUS_TOTAL_DEDUCTIONS"])
            amounts.append(f"{label}: -{money(item.total_deductions)}")
        reason = getattr(item, "zero_salary_reason", None)
        if reason:
            detail = getattr(item, "zero_salary_reason_detail", None)
            text = f"{t('payroll.adjustment.zero_salary_reason')}: {t('payroll.zero_salary_reason.' + reason)}"
            notes.append(f"{text} - {detail}" if detail else text)
        decision = getattr(item, "suspended_pay_decision", None)
        if decision:
            notes.append(
                f"{t('payroll.pdf.suspended_decision')}: {t('payroll.suspended_pay_decision.' + decision.lower())}"
            )
        if data.adjustments[getattr(item, "pk", None)]:
            notes.append(t("payroll.pdf.manual_adjustments").format(count=data.adjustments[item.pk]))
        blocking = data.blocking.get(getattr(item, "pk", None), [])
        notes += [f"{t('payroll.validation_severity.error')}: {message}" for message in dict.fromkeys(blocking)]
        if not (amounts or notes):
            continue
        unknown = [dto.line_dto(line, compact=True)["label"] for line in lines if line.amount is None]
        if unknown:
            notes.append(f"{t('payroll.pdf.not_available')}: {', '.join(unknown)}")
        if data.executive(item):
            notes.append(t("payroll.pdf.executive"))
        rows.append(
            [
                w.para(item.employee_id or "-", widths[0]),
                w.para(item.employee_name or "-", widths[1]),
                w.para(" ".join((item.department or "").split()) or no_department, widths[2]),
                w.para(amounts or "-", widths[3]),
                w.para(notes or "-", widths[4]),
            ]
        )
    if len(rows) == 1:
        story.append(w.para(t("payroll.pdf.no_exceptions"), WIDTH, size=9))
        return story
    story.append(
        w.table(
            rows, widths, [("VALIGN", (0, 1), (-1, -1), "TOP"), ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, SOFT])]
        )
    )
    return story


def _provisions(w, data):
    story = [CondPageBreak(70 * mm), Spacer(1, 10), w.heading(t("payroll.pdf.provisions"))]
    if data.legacy:
        return story + [w.para(t("payroll.pdf.provisions_legacy"), WIDTH)]
    known, known_count, unknown = defaultdict(lambda: ZERO), Counter(), Counter()
    for item in data.items:
        for line in data.item_lines(item):
            if line.category == "PROVISION":
                if line.amount is None:
                    unknown[line.type] += 1
                else:
                    known[line.type] += line.amount
                    known_count[line.type] += 1
    widths = [80 * mm, 45 * mm, 80 * mm]
    rows = [
        w.header_cells(
            [t("payroll.line_category.provision"), t("payroll.pdf.amount"), t("payroll.pdf.availability")], widths
        )
    ]
    for kind in PROVISION_TYPES:
        availability = (
            t("payroll.pdf.not_available_for").format(count=unknown[kind])
            if unknown[kind]
            else t("payroll.pdf.complete")
        )
        all_unknown = unknown[kind] and not known_count[kind]
        rows.append(
            [
                w.para(t(dto.LINE_KEYS[kind]), widths[0]),
                t("payroll.pdf.not_available") if all_unknown else money(known[kind]),
                w.para(availability, widths[2], color=DARK if unknown[kind] else MUTED),
            ]
        )
    total = data.totals["total_provisions"]
    rows.append(
        [
            w.para(t("payroll.pdf.total_provisions"), widths[0], bold=True),
            money(total) if total is not None else t("payroll.pdf.not_available"),
            "",
        ]
    )
    commands = [
        ("ALIGN", (1, 1), (1, -1), "RIGHT"),
        ("BACKGROUND", (0, -1), (-1, -1), LIGHT),
        ("FONTNAME", (1, -1), (1, -1), w.bold),
    ]
    story += [Spacer(1, 4), w.table(rows, widths, commands)]
    if any(unknown.values()):
        story += [Spacer(1, 3), w.note(t("payroll.pdf.provisions_unknown_note"))]
    return story


def _accommodation(w, data):
    if not data.rents:
        return []
    widths = [69 * mm, 30 * mm, 38 * mm, 30 * mm, 30 * mm, 30 * mm, WIDTH - 227 * mm]
    labels = [
        t("payroll.pdf.property"),
        t("payroll.pdf.monthly_rent")
        if data.run.period_basis == "LEGACY_FULL_MONTH"
        else f"{t('payroll.pdf.monthly_rent')} × {data.run.calendar_days}/30",
        t("payroll.pdf.allocated_payroll"),
        t("payroll.rent.vacant_unallocated"),
        t("payroll.rent.not_in_payroll"),
        t("payroll.rent.rounding_difference"),
        t("payroll.pdf.reconciled"),
    ]
    rows = [w.header_cells(labels, widths)]
    for rent in data.rents:
        rows.append(
            [
                w.para(rent["rent_name"] or "-", widths[0]),
                share(rent["period_rent"]),
                money(rent["in_payroll_rounded"]),
                share(rent["vacant_unallocated_raw"]),
                share(rent["not_in_payroll_raw"]),
                share(rent["rounding_difference"]),
                t("payroll.pdf.yes") if rent["raw_reconciliation"]["matches"] else t("payroll.pdf.no"),
            ]
        )
    commands = [("ALIGN", (1, 1), (-2, -1), "RIGHT"), ("ALIGN", (-1, 1), (-1, -1), "CENTER")]
    return [
        CondPageBreak(60 * mm),
        Spacer(1, 10),
        w.heading(t("payroll.pdf.accommodation_summary")),
        Spacer(1, 4),
        w.table(rows, widths, commands),
        Spacer(1, 3),
        w.note(t("payroll.pdf.rounding_note")),
    ]


def _notes_and_approval(w, data):
    story = [CondPageBreak(80 * mm), Spacer(1, 10), w.heading(t("payroll.pdf.notes_settings")), Spacer(1, 4)]
    settings = data.settings
    if settings:
        pairs = []
        for key, label in BASE_SETTINGS:
            base = settings.get(key) or {}
            value = t("payroll.salary_base." + str(base.get("type", "")).lower()) if base.get("type") else "-"
            if base.get("fixed_amount") is not None:
                value = f"{value}: {money(base['fixed_amount'])}"
            pairs.append((t(label), value))
        pairs.append(
            (
                t("payroll.pdf.gosi_rates"),
                f"{rate(settings.get('saudi_gosi_rate', '0'))} / {rate(settings.get('foreign_gosi_rate', '0'))}",
            )
        )
        if settings.get("no_medical_insurance"):
            medical = t("payroll.pdf.no_medical_insurance")
        elif settings.get("annual_medical_invoice") is None:
            medical = t("payroll.pdf.not_configured")
        else:
            medical = money(settings["annual_medical_invoice"])
        pairs += [
            (t("payroll.pdf.medical_invoice"), medical),
            (t("payroll.pdf.id_cost"), _optional_money(settings.get("monthly_foreign_id_cost"))),
            (t("payroll.pdf.air_ticket"), _optional_money(settings.get("annual_air_ticket"))),
            (
                t("payroll.pdf.provision_proration"),
                t("payroll.provision_proration." + str(settings.get("provision_proration", "FULL_MONTH")).lower()),
            ),
            (
                t("payroll.field.require_manual_absence_confirmation"),
                t("payroll.pdf.yes") if settings.get("require_manual_absence_confirmation") else t("payroll.pdf.no"),
            ),
            (t("payroll.pdf.settings_revision"), str(settings.get("settings_revision", 0))),
        ]
        if len(pairs) % 2:
            pairs.append(("", ""))
        label_w, value_w = 60 * mm, WIDTH / 2 - 60 * mm
        rows = [
            [
                w.para(pairs[i][0], label_w, bold=True),
                w.para(pairs[i][1], value_w),
                w.para(pairs[i + 1][0], label_w, bold=True),
                w.para(pairs[i + 1][1], value_w),
            ]
            for i in range(0, len(pairs), 2)
        ]
        story.append(
            w.table(
                rows,
                [label_w, value_w, label_w, value_w],
                [("BACKGROUND", (0, 0), (0, -1), SOFT), ("BACKGROUND", (2, 0), (2, -1), SOFT)],
                header_rows=0,
            )
        )
    else:
        story.append(w.para(t("payroll.pdf.settings_legacy"), WIDTH))

    assumptions = {}
    for item in data.items:
        result = (getattr(item, "input_snapshot", None) or {}).get("result", {})
        for key in result.get("assumptions", []):
            if key != "payroll.assumption.provision_proration_pending":
                assumptions[key] = None
    closing = [Spacer(1, 6), w.heading(t("payroll.pdf.assumptions"), 10), Spacer(1, 2)]
    closing += [w.para(f"- {text}", WIDTH) for text in [t("payroll.pdf.basis_note"), *map(t, assumptions)]]
    closing += [Spacer(1, 10), w.heading(t("payroll.pdf.approval"), 10), Spacer(1, 4), _signature(w)]
    story.append(KeepTogether(closing))
    return story


def _optional_money(value):
    return money(value) if value is not None else t("payroll.pdf.not_configured")


def _signature(w):
    lines = []
    for key, rule in (
        ("payroll.pdf.signature_name", "____________________"),
        ("payroll.pdf.signature_date", "____________________"),
        ("payroll.pdf.signature", "_______________"),
    ):
        text = f"{t(key)}: {rule}"
        lines.append(w.shape(text))
    headers = [
        t("payroll.pdf.prepared_by"),
        t("payroll.pdf.reviewed_by"),
        t("payroll.pdf.approved_by"),
        t("payroll.pdf.company_stamp"),
    ]
    return build_signature_stamp_block(
        total_width=WIDTH,
        headers=[w.shape(h) for h in headers],
        signer_lines=lines,
        fonts=(w.regular, w.bold),
        rtl=w.rtl,
    )


def _banner(w, text):
    table = Table([[w.para(text, WIDTH, size=9, bold=True)]], colWidths=[WIDTH])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), LIGHT),
                ("BOX", (0, 0), (-1, -1), 1, ORANGE),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    return table


def _corporate_header(w, company, title, subtitle):
    logo_w = 38 * mm
    text_w = WIDTH - logo_w
    path = get_logo_path()
    logo = Image(path, width=32 * mm, height=12 * mm) if path else ""
    text = [
        w.para(company or "-", text_w, size=10, color=MUTED),
        w.para(title, text_w, size=16, bold=True),
        w.para(subtitle, text_w, size=10, color=MUTED),
    ]
    return w.table(
        [[logo, text]],
        [logo_w, text_w],
        [
            ("BACKGROUND", (0, 0), (-1, -1), WHITE),
            ("BOX", (0, 0), (-1, -1), 1, ORANGE),
            ("INNERGRID", (0, 0), (-1, -1), 0, WHITE),
            ("TOPPADDING", (0, 0), (-1, -1), 8),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ],
        header_rows=0,
    )


def _render(story, writer, furniture, title):
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=PAGE,
        leftMargin=SIDE_MARGIN,
        rightMargin=SIDE_MARGIN,
        topMargin=17 * mm,
        bottomMargin=15 * mm,
        title=title,
    )
    doc.build(story, canvasmaker=_numbered_canvas(writer, furniture))
    return buffer.getvalue()


def _numbered_canvas(writer, furniture):
    def text(value):
        return writer.shape(value)

    def draw(canvas, total):
        width, height = PAGE
        left, right = SIDE_MARGIN, width - SIDE_MARGIN
        page = t("payroll.pdf.page_of").format(page=canvas.getPageNumber(), total=total)
        canvas.saveState()
        canvas.setStrokeColor(ORANGE)
        canvas.setLineWidth(0.8)
        canvas.line(left, height - 12 * mm, right, height - 12 * mm)
        canvas.setFillColor(DARK)
        canvas.setFont(writer.bold, 8.5)
        start, end = (
            (canvas.drawRightString, canvas.drawString) if writer.rtl else (canvas.drawString, canvas.drawRightString)
        )
        start(right if writer.rtl else left, height - 10.5 * mm, text(furniture["start"]))
        canvas.setFont(writer.regular, 8.5)
        end(left if writer.rtl else right, height - 10.5 * mm, text(furniture["end"]))
        canvas.setFillColor(MUTED)
        canvas.setFont(writer.regular, 7.5)
        start(right if writer.rtl else left, 8 * mm, text(furniture["generated"]))
        end(left if writer.rtl else right, 8 * mm, text(page))
        canvas.restoreState()

    class NumberedCanvas(pdf_canvas.Canvas):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self._saved_pages = []

        def showPage(self):
            self._saved_pages.append(dict(self.__dict__))
            self._startPage()

        def save(self):
            total = len(self._saved_pages)
            for state in self._saved_pages:
                self.__dict__.update(state)
                draw(self, total)
                super().showPage()
            super().save()

    return NumberedCanvas
