"""ICAO 9303 TD3 machine readable zone parsing and check-digit validation."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime

MRZ_LINE_LENGTH = 44
_MIN_USABLE_LINE = 30
_FILLER = "<"

# OCR routinely confuses these glyphs inside the MRZ band, where the alphabet is
# restricted to A-Z, 0-9 and '<'. Repairing them per-position is what makes the
# check digits usable at all.
_DIGIT_FIXES = str.maketrans({"O": "0", "Q": "0", "D": "0", "I": "1", "L": "1", "S": "5", "B": "8", "G": "6", "Z": "2"})
_ALPHA_FIXES = str.maketrans({"0": "O", "1": "I", "5": "S", "8": "B", "2": "Z"})


@dataclass
class MrzResult:
    fields: dict[str, str] = field(default_factory=dict)
    checks: dict[str, bool] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    lines: list[str] = field(default_factory=list)

    @property
    def found(self) -> bool:
        return bool(self.lines)

    @property
    def field_checks_passed(self) -> bool:
        """Document number, birth date and expiry check digits all agree."""

        required = ("document_number", "date_of_birth", "expiry_date")
        return all(self.checks.get(name) for name in required)


def character_value(char: str) -> int:
    if char == _FILLER:
        return 0
    if char.isdigit():
        return int(char)
    if "A" <= char <= "Z":
        return ord(char) - ord("A") + 10
    return -1


def check_digit(value: str) -> str:
    """ICAO 9303 7-3-1 weighted modulus 10 check digit."""

    weights = (7, 3, 1)
    total = 0
    for index, char in enumerate(value):
        numeric = character_value(char)
        if numeric < 0:
            return ""
        total += numeric * weights[index % 3]
    return str(total % 10)


def verify_check_digit(value: str, expected: str) -> bool:
    if not expected or not expected.isdigit():
        return False
    computed = check_digit(value)
    return bool(computed) and computed == expected


def clean_mrz_line(line: str) -> str:
    return re.sub(r"[^A-Z0-9<]", "", (line or "").upper().replace(" ", "").replace("«", "<"))


def _repair(segment: str, *, numeric: bool) -> str:
    return segment.translate(_DIGIT_FIXES if numeric else _ALPHA_FIXES)


def parse_mrz_date(value: str, *, future: bool = False) -> str:
    """YYMMDD to ISO. Expiry dates always resolve into the 2000s."""

    if not re.fullmatch(r"\d{6}", value or ""):
        return ""
    year = int(value[:2])
    current_two_digit_year = datetime.now().year % 100
    century = 2000 if future or year <= current_two_digit_year else 1900
    try:
        return date(century + year, int(value[2:4]), int(value[4:6])).isoformat()
    except ValueError:
        return ""


def find_mrz_lines(text: str) -> list[str]:
    """Locate the two TD3 lines in noisy OCR output."""

    candidates = [clean_mrz_line(line) for line in (text or "").splitlines()]
    candidates = [line for line in candidates if len(line) >= _MIN_USABLE_LINE]
    for index, line in enumerate(candidates):
        if not line.startswith("P<") or index + 1 >= len(candidates):
            continue
        second = candidates[index + 1]
        if len(second) < _MIN_USABLE_LINE:
            continue
        return [
            line.ljust(MRZ_LINE_LENGTH, _FILLER)[:MRZ_LINE_LENGTH],
            second.ljust(MRZ_LINE_LENGTH, _FILLER)[:MRZ_LINE_LENGTH],
        ]
    return []


def parse_td3(text: str) -> MrzResult:
    lines = find_mrz_lines(text)
    if not lines:
        return MrzResult(warnings=["No passport machine readable zone was detected."])

    first, second = lines
    name_parts = first[5:MRZ_LINE_LENGTH].split("<<", 1)
    surname = name_parts[0].replace(_FILLER, " ").strip()
    given_names = name_parts[1].replace(_FILLER, " ").strip() if len(name_parts) > 1 else ""

    # Passport numbers are alphanumeric, so no glyph repair can be applied here
    # without corrupting valid values; the check digit is what validates them.
    document_number = second[0:9]
    document_check = _repair(second[9:10], numeric=True)
    nationality = _repair(second[10:13], numeric=False).replace(_FILLER, "").strip()
    birth_raw = _repair(second[13:19], numeric=True)
    birth_check = _repair(second[19:20], numeric=True)
    sex = second[20:21].replace(_FILLER, "").strip()
    expiry_raw = _repair(second[21:27], numeric=True)
    expiry_check = _repair(second[27:28], numeric=True)
    personal_number = second[28:42]
    personal_check = _repair(second[42:43], numeric=True)
    composite_check = _repair(second[43:44], numeric=True)

    checks = {
        "document_number": verify_check_digit(document_number, document_check),
        "date_of_birth": verify_check_digit(birth_raw, birth_check),
        "expiry_date": verify_check_digit(expiry_raw, expiry_check),
    }
    if personal_number.strip(_FILLER):
        checks["personal_number"] = verify_check_digit(personal_number, personal_check)

    composite_source = second[0:10] + second[13:20] + second[21:43]
    checks["composite"] = verify_check_digit(composite_source, composite_check)

    warnings: list[str] = []
    labels = {
        "document_number": "passport number",
        "date_of_birth": "date of birth",
        "expiry_date": "expiry date",
        "personal_number": "personal number",
    }
    for name, label in labels.items():
        if name in checks and not checks[name]:
            warnings.append(f"Passport MRZ {label} failed its ICAO check digit.")
    if not checks["composite"]:
        warnings.append("Passport MRZ composite check digit did not match; verify the printed values.")

    fields = {
        "passport_number": document_number.replace(_FILLER, "").strip(),
        "full_name": " ".join(part for part in (given_names, surname) if part),
        "nationality": nationality,
        "date_of_birth": parse_mrz_date(birth_raw),
        "expiry_date": parse_mrz_date(expiry_raw, future=True),
        "sex": sex,
        "issuing_country": _repair(first[2:5], numeric=False).replace(_FILLER, "").strip(),
    }
    if not fields["date_of_birth"] and birth_raw:
        warnings.append("Passport MRZ date of birth could not be read as a valid date.")
    if not fields["expiry_date"] and expiry_raw:
        warnings.append("Passport MRZ expiry date could not be read as a valid date.")

    return MrzResult(
        fields={key: value for key, value in fields.items() if value},
        checks=checks,
        warnings=warnings,
        lines=lines,
    )
