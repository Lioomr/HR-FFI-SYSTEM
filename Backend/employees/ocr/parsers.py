"""Field extraction and validation for Arabic/English employee identity documents.

Every parser returns the fields it could read plus the warnings that stop a
document from being marked `success`. Nothing here writes to the database and
nothing is copied into employee master data - HR always confirms a value before
it becomes profile truth.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime

from ..models import EmployeeDocument
from .mrz import MrzResult, parse_td3

ARABIC_INDIC_DIGITS = "٠١٢٣٤٥٦٧٨٩"
EASTERN_ARABIC_DIGITS = "۰۱۲۳۴۵۶۷۸۹"
_DIGIT_TRANSLATION = str.maketrans(
    ARABIC_INDIC_DIGITS + EASTERN_ARABIC_DIGITS,
    "0123456789" * 2,
)

DATE_FORMATS = (
    "%d/%m/%Y",
    "%d-%m-%Y",
    "%d.%m.%Y",
    "%Y/%m/%d",
    "%Y-%m-%d",
    "%d %b %Y",
    "%d %B %Y",
    "%b %d %Y",
    "%d/%m/%y",
)

# A document field must never be populated with one of the labels printed next
# to it.  This matters particularly for passport layouts whose header row has
# adjacent cells, for example ``Date of Issue | Date of Expiry``.  OCR can join
# those cells into one line; a permissive capture would otherwise save "Date of
# Expiry" as the issue date.
DATE_FIELD_NAMES = frozenset(
    {
        "date_of_birth",
        "issue_date",
        "expiry_date",
        "iqama_expiry_date",
        "exit_before_raw",
    }
)
_DATE_VALUE_PATTERN = (
    r"(?:[0-9٠-٩۰-۹]{1,4}[/-][0-9٠-٩۰-۹]{1,2}[/-][0-9٠-٩۰-۹]{1,4}"
    r"|[0-9٠-٩۰-۹]{1,2}\s+[A-Za-z]{3,9}\s+[0-9٠-٩۰-۹]{4}"
    r"|[A-Za-z]{3,9}\s+[0-9٠-٩۰-۹]{1,2}\s*,?\s+[0-9٠-٩۰-۹]{4})"
)
_KNOWN_FIELD_LABELS = (
    r"Full\s*Name|Name|Nationality|Date\s*of\s*Birth|Birth\s*Date|DOB|"
    r"Date\s*of\s*Issue|Issue\s*Date|Date\s*of\s*Expiry|Expiry\s*Date|Expires|"
    r"Profession|Occupation|Employer|Sponsor|Passport\s*(?:Number|No\.?|#)|"
    r"Iqama\s*Expiry|ID\s*Expiry|Iqama\s*(?:Number|No\.?|#)|"
    r"(?:National\s*)?ID\s*(?:Number|No\.?|#)?|Visa\s*(?:Number|No\.?|#)|"
    r"Exit\s*Before|Visa\s*Duration|"
    r"الاسم|اﻻسم|الجنسية|تاريخ\s*الميلاد|تاريخ\s*الإصدار|تاريخ\s*الاصدار|"
    r"تاريخ\s*الانتهاء|تاريخ\s*الإنتهاء|المهنة|الوظيفة|صاحب\s*العمل|الكفيل|"
    r"رقم\s*(?:الجواز|الهوية|الإقامة|الاقامة|التأشيرة|التاشيرة)"
)
_PLACEHOLDER_OR_HEADING_VALUES = frozenset(
    {
        "-",
        "n/a",
        "na",
        "none",
        "nil",
        "unknown",
        "not available",
        "passport",
        "identity card",
        "national identity",
        "kingdom of saudi arabia",
        "المملكة العربية السعودية",
    }
)

# A Hijri year on a Saudi card - readable, but not a Gregorian expiry we can act on.
_HIJRI_YEAR = re.compile(r"\b1[34]\d{2}\b")

SAUDI_ID_LENGTH = 10
IQAMA_LEADING_DIGIT = "2"
SAUDI_ID_LEADING_DIGIT = "1"

MIN_VISA_DURATION_DAYS = 1
MAX_VISA_DURATION_DAYS = 1095

# Identity documents never carry a Gregorian year outside this window, so a date
# that lands outside it is an OCR error or a Hijri date, not a usable value.
MIN_PLAUSIBLE_YEAR = 1900
MAX_PLAUSIBLE_YEAR = 2100


@dataclass
class ParseResult:
    fields: dict[str, str] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    checks: dict[str, bool] = field(default_factory=dict)
    valid: bool = False


def normalize_digits(value: str) -> str:
    return (value or "").translate(_DIGIT_TRANSLATION)


def parse_date(raw_value: str) -> date | None:
    value = normalize_digits(raw_value or "").strip().replace("،", "").strip(" :|")
    if not value:
        return None
    for fmt in DATE_FORMATS:
        try:
            return _plausible(datetime.strptime(value, fmt).date())
        except ValueError:
            continue
    try:
        return _plausible(date.fromisoformat(value))
    except ValueError:
        return None


def _plausible(value: date | None) -> date | None:
    if value is None or not (MIN_PLAUSIBLE_YEAR <= value.year <= MAX_PLAUSIBLE_YEAR):
        return None
    return value


def looks_hijri(value: str) -> bool:
    return bool(_HIJRI_YEAR.search(normalize_digits(value or "")))


def first_match(pattern: str, text: str) -> str:
    match = re.search(pattern, text, flags=re.IGNORECASE | re.MULTILINE)
    return match.group(1).strip(" :|\t-") if match else ""


def label_value(text: str, labels: str, value_pattern: str = r"[^\n|]+") -> str:
    """Read the value printed after a label, on any line that carries one.

    Bilingual pages are OCR'd by two models whose line segmentation differs, so
    the same field can appear several times - once as a full row, once as
    fragments. Every candidate is scored and the cleanest one wins, instead of
    trusting whichever the regex happened to reach first.
    """

    # Horizontal whitespace only: "\s*" would let a label on its own line swallow
    # the whole of the next line, which bilingual layouts produce constantly.
    candidates = [
        _strip_leading_label(match.group(1), labels)
        for match in re.finditer(
            rf"(?:{labels})[ \t]*[:|]?[ \t]*({value_pattern})", text, flags=re.IGNORECASE | re.MULTILINE
        )
    ]
    candidates = [candidate for candidate in candidates if candidate and not is_field_label_or_boilerplate(candidate)]
    if not candidates:
        return ""
    return max(candidates, key=_value_quality)


def label_date_value(text: str, labels: str) -> str:
    """Read a date only when an actual date immediately follows its own label.

    Unlike :func:`label_value`, this deliberately does not capture arbitrary
    text after a date label.  It prevents adjacent column headings from being
    mistaken for values and lets ``parse_date`` be the final plausibility gate.
    """

    candidates = [
        match.group(1).strip(" :|\t-")
        for match in re.finditer(
            rf"(?:{labels})[ \t]*[:|]?[ \t]*({_DATE_VALUE_PATTERN})",
            text,
            flags=re.IGNORECASE | re.MULTILINE,
        )
    ]
    candidates = [candidate for candidate in candidates if parse_date(candidate)]
    if not candidates:
        return ""
    return max(candidates, key=_value_quality)


def is_field_label_or_boilerplate(value: str) -> bool:
    """Whether OCR text is a label, heading, or placeholder rather than data."""

    cleaned = (value or "").strip(" :|\t-")
    if not cleaned:
        return True
    if cleaned.casefold() in _PLACEHOLDER_OR_HEADING_VALUES:
        return True
    # Reject both a bare label ("Date of Expiry") and an unstripped nested
    # label ("Date of Expiry: 01 Jan 2030").  The latter must never migrate
    # into a different field merely because two OCR cells were merged.
    return bool(re.match(rf"^(?:{_KNOWN_FIELD_LABELS})(?:[ \t]*[:|\-]|$)", cleaned, flags=re.IGNORECASE))


def sanitize_extracted_fields(document_type: str, fields: dict[str, str] | object) -> dict[str, str]:
    """Return the UI-safe subset of OCR suggestions.

    The parser invokes this before persistence.  Serializers invoke it again
    for historic rows created before these guards existed, so an old bad OCR
    value is never offered to HR as a suggestion.  The document type parameter
    is intentionally part of the public helper: field rules can remain type
    aware as formats are added without moving validation into presentation code.
    """

    del document_type  # Reserved for document-specific field rules.
    if not isinstance(fields, dict):
        return {}

    cleaned: dict[str, str] = {}
    for raw_key, raw_value in fields.items():
        if not isinstance(raw_key, str) or raw_key.startswith("_"):
            continue
        value = str(raw_value or "").strip()
        if is_field_label_or_boilerplate(value):
            continue
        if raw_key in DATE_FIELD_NAMES and not parse_date(value):
            continue
        cleaned[raw_key] = value
    return cleaned


def _strip_leading_label(value: str, labels: str) -> str:
    """Drop a label the capture swallowed, e.g. "Nationality:EGYPT" -> "EGYPT".

    OCR frequently loses the space after the colon, which lets an earlier
    alternative in the label group match and leave the rest of the label inside
    the value.
    """

    cleaned = (value or "").strip(" :|\t-")
    for _ in range(2):
        stripped = re.sub(rf"^[ \t]*(?:{labels})[ \t]*[:|]?[ \t]*", "", cleaned, flags=re.IGNORECASE)
        if stripped == cleaned:
            break
        cleaned = stripped.strip(" :|\t-")
    return cleaned


def _value_quality(value: str) -> tuple:
    """Rank candidate readings: prefer real content, penalise OCR noise."""

    alphanumerics = [char for char in value if char.isalnum()]
    noise = sum(1 for char in value if not (char.isalnum() or char.isspace() or char in ".,/-:"))
    return (len(alphanumerics) > 0, -noise, len(alphanumerics))


def strip_trailing_noise(value: str) -> str:
    """Remove trailing gibberish tokens from a free-text value.

    The English model transcribes Arabic script next to a Latin value as short
    mixed-case nonsense ("... TESTCASE ewYI"). A trailing token that mixes cases
    or is mostly non-letters is never part of a printed name.
    """

    tokens = (value or "").split()
    while len(tokens) > 1:
        last = tokens[-1]
        letters = [char for char in last if char.isalpha()]
        mixed_case = bool(letters) and not (last.isupper() or last.istitle() or last.islower())
        mostly_symbols = bool(last) and len(letters) < len(last) / 2
        if len(last) <= 5 and (mixed_case or mostly_symbols):
            tokens.pop()
            continue
        break
    return " ".join(tokens)


def saudi_id_checksum_valid(number: str) -> bool:
    """Luhn variant used by Saudi national ID and Iqama numbers."""

    digits = normalize_digits(number)
    if not re.fullmatch(r"\d{10}", digits):
        return False
    total = 0
    for index, char in enumerate(digits[:9]):
        value = int(char)
        if index % 2 == 0:
            value *= 2
            if value > 9:
                value -= 9
        total += value
    return (10 - (total % 10)) % 10 == int(digits[9])


def _clean(fields: dict[str, str]) -> dict[str, str]:
    return {key: str(value).strip() for key, value in fields.items() if value and str(value).strip()}


def _common_identity_labels(text: str) -> dict[str, str]:
    patterns = {
        "full_name": r"Full\s*Name|Name|الاسم|اﻻسم",
        "nationality": r"Nationality|الجنسية",
        "date_of_birth": r"Date\s*of\s*Birth|Birth\s*Date|DOB|تاريخ\s*الميلاد",
        "issue_date": r"Date\s*of\s*Issue|Issue\s*Date|تاريخ\s*الإصدار|تاريخ\s*الاصدار",
        "expiry_date": r"Date\s*of\s*Expiry|Expiry\s*Date|Expires|تاريخ\s*الانتهاء|تاريخ\s*الإنتهاء",
        "profession": r"Profession|Occupation|المهنة|الوظيفة",
        "employer": r"Employer|Sponsor|صاحب\s*العمل|الكفيل",
    }
    values = {
        key: label_date_value(text, labels) if key in DATE_FIELD_NAMES else label_value(text, labels)
        for key, labels in patterns.items()
    }
    for key in ("full_name", "nationality", "profession", "employer"):
        if values.get(key):
            values[key] = strip_trailing_noise(values[key])
    return sanitize_extracted_fields("identity", _clean(values))


def _fallback_latin_name(text: str) -> str:
    candidate = first_match(r"^\s*([A-Z]{2,}(?:\s+[A-Z]{2,}){2,})\s*$", text)
    return candidate if candidate and re.fullmatch(r"[A-Z][A-Z ]{7,}", candidate) else ""


def _fallback_nationality(text: str) -> str:
    if re.search(r"^\s*مصر\s*$", text, flags=re.MULTILINE):
        return "Egypt"
    if re.search(r"\bEGYPT(?:IAN)?\b", text, flags=re.IGNORECASE):
        return "Egyptian"
    return ""


def parse_passport(text: str) -> ParseResult:
    mrz: MrzResult = parse_td3(text)
    fields = dict(mrz.fields)
    warnings = list(mrz.warnings)
    checks = dict(mrz.checks)

    for key, value in _common_identity_labels(text).items():
        fields.setdefault(key, value)
    printed_number = label_value(text, r"Passport\s*(?:Number|No\.?|#)|رقم\s*الجواز", r"[A-Z0-9< -]{5,20}")
    if printed_number and not fields.get("passport_number"):
        fields["passport_number"] = printed_number.replace(" ", "").replace("<", "")
    if not fields.get("full_name"):
        fallback = _fallback_latin_name(text)
        if fallback:
            fields["full_name"] = fallback

    for key in ("date_of_birth", "issue_date", "expiry_date"):
        value = fields.get(key)
        if value and not parse_date(value):
            warnings.append(f"Passport {key.replace('_', ' ')} could not be read as a valid date.")
            fields.pop(key, None)

    # Do not swap or infer these values.  A passport issue date cannot be after
    # its expiry, and birth/issue dates cannot be in the future.  Removing a
    # conflicting OCR suggestion is safer than presenting a plausible-looking
    # but semantically wrong value to HR.
    today = date.today()
    birth = parse_date(fields.get("date_of_birth", ""))
    issue = parse_date(fields.get("issue_date", ""))
    expiry = parse_date(fields.get("expiry_date", ""))
    if birth and birth > today:
        warnings.append("Passport date of birth is in the future and was omitted.")
        fields.pop("date_of_birth", None)
        birth = None
    if issue and issue > today:
        warnings.append("Passport issue date is in the future and was omitted.")
        fields.pop("issue_date", None)
        issue = None
    if issue and expiry and issue > expiry:
        warnings.append("Passport issue date is after the expiry date and was omitted.")
        fields.pop("issue_date", None)
        issue = None
    if birth and issue and birth > issue:
        warnings.append("Passport date of birth is after the issue date and was omitted.")
        fields.pop("date_of_birth", None)

    fields = sanitize_extracted_fields(EmployeeDocument.DocumentType.PASSPORT, fields)

    required = ("passport_number", "full_name", "nationality", "date_of_birth", "expiry_date")
    missing = [name for name in required if not fields.get(name)]
    if missing:
        warnings.append(f"Could not extract: {_humanize(missing)}.")

    if not mrz.found:
        valid = False
    elif not mrz.field_checks_passed:
        valid = False
    else:
        valid = not missing

    expiry = parse_date(fields.get("expiry_date", ""))
    if expiry and expiry < date.today():
        warnings.append("The passport expiry date is in the past.")

    return ParseResult(fields=fields, warnings=warnings, checks=checks, valid=valid)


def parse_national_identity(document_type: str, text: str) -> ParseResult:
    """Iqama and Saudi ID share a layout; only the leading ID digit differs."""

    fields = _common_identity_labels(text)
    warnings: list[str] = []
    checks: dict[str, bool] = {}

    if not fields.get("full_name"):
        fallback = _fallback_latin_name(text)
        if fallback:
            fields["full_name"] = fallback
    if not fields.get("nationality"):
        fallback = _fallback_nationality(text)
        if fallback:
            fields["nationality"] = fallback
    if not fields.get("profession"):
        profession = first_match(r"^\s*((?:عامل|مهندس|فني|طبيب|مدير|سائق)[^\n]*)$", text)
        if profession:
            fields["profession"] = profession

    number = label_value(
        text,
        r"(?:Iqama|Residence|ID|Identity|National\s*ID)\s*(?:Number|No\.?|#)?|رقم\s*(?:الهوية|الإقامة|الاقامة)",
        r"[0-9٠-٩۰-۹ -]{8,20}",
    )
    if not number:
        number = first_match(r"(?<!\d)([0-9٠-٩۰-۹]{10})(?!\d)", text)
    number = re.sub(r"\D", "", normalize_digits(number)) if number else ""
    if number:
        fields["iqama_number"] = number

    expiry_raw = label_value(
        text,
        r"Iqama\s*Expiry|ID\s*Expiry|Expiry\s*Date|Date\s*of\s*Expiry|تاريخ\s*انتهاء\s*(?:الهوية|الإقامة|الاقامة)",
    )
    if not expiry_raw:
        expiry_raw = first_match(
            r"([0-9٠-٩۰-۹]{1,4}[/-][0-9٠-٩۰-۹]{1,2}[/-][0-9٠-٩۰-۹]{1,4})\s*(?:تاريخ\s*)?(?:الانتهاء|الإنتهاء)",
            text,
        )
    if not expiry_raw:
        expiry_raw = fields.get("expiry_date", "")
    if expiry_raw:
        fields["iqama_expiry_date"] = normalize_digits(expiry_raw)

    expected_leading = (
        SAUDI_ID_LEADING_DIGIT if document_type == EmployeeDocument.DocumentType.SAUDI_ID else IQAMA_LEADING_DIGIT
    )
    label = "Saudi ID" if document_type == EmployeeDocument.DocumentType.SAUDI_ID else "Iqama"

    format_ok = bool(number) and len(number) == SAUDI_ID_LENGTH
    if number and not format_ok:
        warnings.append(f"The {label} number is not a 10-digit identity number.")
    if format_ok and not number.startswith(expected_leading):
        format_ok = False
        warnings.append(
            f"The {label} number does not start with {expected_leading} as expected for this document type."
        )
    checks["id_format"] = format_ok

    if format_ok:
        checksum_ok = saudi_id_checksum_valid(number)
        checks["id_checksum"] = checksum_ok
        if not checksum_ok:
            warnings.append(f"The {label} number failed its checksum; confirm the digits before use.")
    else:
        checks["id_checksum"] = False

    expiry_value = fields.get("iqama_expiry_date", "")
    expiry = parse_date(expiry_value)
    checks["expiry_parsed"] = bool(expiry)
    if expiry_value and not expiry:
        if looks_hijri(expiry_value):
            warnings.append("The expiry date appears to be a Hijri date; enter the Gregorian date manually.")
        else:
            warnings.append("The expiry date could not be read as a valid date.")
    if expiry and expiry < date.today():
        warnings.append("The document expiry date is in the past.")

    required = ("iqama_number", "full_name", "nationality", "iqama_expiry_date")
    missing = [name for name in required if not fields.get(name)]
    if missing:
        warnings.append(f"Could not extract: {_humanize(missing)}.")

    fields = sanitize_extracted_fields(document_type, fields)
    missing = [name for name in required if not fields.get(name)]
    valid = not missing and checks["id_format"] and checks["id_checksum"] and checks["expiry_parsed"]
    return ParseResult(fields=fields, warnings=warnings, checks=checks, valid=valid)


def parse_visa(text: str) -> ParseResult:
    warnings: list[str] = []
    checks: dict[str, bool] = {}

    visa_number = first_match(r"Visa\s*(?:Number|No\.?|#)\s*[:|]?\s*([A-Za-z0-9-]{4,20})", text)
    if not visa_number:
        visa_number = first_match(r"رقم\s*(?:التأشيرة|التاشيرة)\s*[:|]?\s*([A-Za-z0-9-]{4,20})", text)
    exit_before_raw = first_match(
        r"Exit\s*Before\s*[:|]?\s*([0-9٠-٩۰-۹]{1,4}[/-][0-9٠-٩۰-۹]{1,2}[/-][0-9٠-٩۰-۹]{1,4})", text
    )
    if not exit_before_raw:
        exit_before_raw = first_match(
            r"(?:الخروج\s*قبل|تاريخ\s*الخروج)\s*[:|]?\s*([0-9٠-٩۰-۹]{1,4}[/-][0-9٠-٩۰-۹]{1,2}[/-][0-9٠-٩۰-۹]{1,4})",
            text,
        )
    duration_raw = first_match(r"Visa\s*Duration\s*[:|]?\s*([0-9٠-٩۰-۹]{1,4})", text)
    if not duration_raw:
        duration_raw = first_match(r"مدة\s*(?:التأشيرة|التاشيرة)\s*[:|]?\s*([0-9٠-٩۰-۹]{1,4})", text)

    fields = sanitize_extracted_fields(
        EmployeeDocument.DocumentType.VISA,
        {
            "visa_number": visa_number,
            "exit_before_raw": normalize_digits(exit_before_raw),
            "visa_duration_raw": normalize_digits(duration_raw),
        },
    )

    number_ok = bool(re.fullmatch(r"[A-Za-z0-9-]{4,20}", fields.get("visa_number", "")))
    checks["visa_number_format"] = number_ok
    if fields.get("visa_number") and not number_ok:
        warnings.append("The visa number format is not recognised.")

    exit_before = parse_date(fields.get("exit_before_raw", ""))
    checks["exit_before_parsed"] = bool(exit_before)
    if fields.get("exit_before_raw") and not exit_before:
        warnings.append("The visa exit date could not be read as a valid date.")

    duration_text = fields.get("visa_duration_raw", "")
    duration = int(duration_text) if duration_text.isdigit() else None
    duration_ok = duration is not None and MIN_VISA_DURATION_DAYS <= duration <= MAX_VISA_DURATION_DAYS
    checks["visa_duration_valid"] = duration_ok
    if duration_text and not duration_ok:
        warnings.append(
            f"The visa duration must be a number between {MIN_VISA_DURATION_DAYS} and {MAX_VISA_DURATION_DAYS} days."
        )

    missing = [name for name in ("visa_number", "exit_before_raw", "visa_duration_raw") if not fields.get(name)]
    if missing:
        warnings.append(f"Could not extract: {_humanize(missing)}.")

    valid = not missing and number_ok and bool(exit_before) and duration_ok
    result = ParseResult(fields=fields, warnings=warnings, checks=checks, valid=valid)
    result.fields["_exit_before"] = exit_before.isoformat() if exit_before else ""
    result.fields["_visa_duration"] = str(duration) if duration is not None else ""
    return result


def _humanize(names: list[str]) -> str:
    labels = {
        "iqama_number": "ID Number",
        "iqama_expiry_date": "Expiry Date",
        "exit_before_raw": "Exit Before",
        "visa_duration_raw": "Visa Duration",
        "visa_number": "Visa Number",
    }
    return ", ".join(labels.get(name, name.replace("_", " ").title()) for name in names)


def parse_document(document_type: str, text: str) -> ParseResult:
    if document_type == EmployeeDocument.DocumentType.PASSPORT:
        return parse_passport(text)
    if document_type == EmployeeDocument.DocumentType.VISA:
        return parse_visa(text)
    return parse_national_identity(document_type, text)
