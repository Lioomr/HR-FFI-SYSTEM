"""Parser hardening against the noisy, duplicated text bilingual OCR produces.

The two language passes segment a page differently, so the same field can reach
the parser several times - once as a full `Label: value` row, once as separate
word fragments. These cases were taken from real PaddleOCR output on the
synthetic fixtures (see `employees/ocr_test_fixtures.py`); they run mocked so
they stay fast.
"""

from django.test import TestCase

from .models import EmployeeDocument
from .ocr.parsers import label_date_value, label_value, parse_document, strip_trailing_noise

NAME_LABELS = r"Full\s*Name|Name|الاسم"
NATIONALITY_LABELS = r"Nationality|الجنسية"


class LabelValueTests(TestCase):
    def test_a_label_glued_to_its_value_is_stripped(self):
        self.assertEqual(label_value("Nationality:EGYPT", NATIONALITY_LABELS), "EGYPT")
        self.assertEqual(label_value("Full Name:SAMPLE EMPLOYEE", NAME_LABELS), "SAMPLE EMPLOYEE")

    def test_a_normally_spaced_label_still_works(self):
        self.assertEqual(label_value("Nationality: EGYPT", NATIONALITY_LABELS), "EGYPT")
        self.assertEqual(label_value("Full Name: SAMPLE EMPLOYEE", NAME_LABELS), "SAMPLE EMPLOYEE")

    def test_the_richest_reading_wins_over_a_truncated_duplicate(self):
        text = "Name: SAMPLE\nFull Name: SAMPLE EMPLOYEE TESTCASE\n"

        self.assertEqual(label_value(text, NAME_LABELS), "SAMPLE EMPLOYEE TESTCASE")

    def test_a_noisy_duplicate_loses_to_a_clean_one(self):
        text = "Name: SAMPLE ~~#@\nFull Name: SAMPLE EMPLOYEE\n"

        self.assertEqual(label_value(text, NAME_LABELS), "SAMPLE EMPLOYEE")

    def test_an_absent_label_yields_nothing(self):
        self.assertEqual(label_value("no labels here", NATIONALITY_LABELS), "")

    def test_an_empty_value_is_not_returned(self):
        self.assertEqual(label_value("Nationality:\n", NATIONALITY_LABELS), "")

    def test_adjacent_date_labels_are_not_treated_as_a_value(self):
        text = "Date of Issue Date of Expiry\n"

        self.assertEqual(label_date_value(text, r"Date\s*of\s*Issue|Issue\s*Date"), "")
        result = parse_document(EmployeeDocument.DocumentType.PASSPORT, text)
        self.assertNotIn("issue_date", result.fields)
        self.assertNotIn("expiry_date", result.fields)

    def test_passport_issue_and_expiry_dates_keep_their_own_meaning(self):
        text = "Date of Issue: 14 May 2020\nDate of Expiry: 13 May 2030\n"

        result = parse_document(EmployeeDocument.DocumentType.PASSPORT, text)

        self.assertEqual(result.fields["issue_date"], "14 May 2020")
        self.assertEqual(result.fields["expiry_date"], "13 May 2030")

    def test_inverted_passport_dates_are_omitted_not_swapped(self):
        text = "Date of Issue: 14 May 2031\nDate of Expiry: 13 May 2030\n"

        result = parse_document(EmployeeDocument.DocumentType.PASSPORT, text)

        self.assertNotIn("issue_date", result.fields)
        self.assertEqual(result.fields["expiry_date"], "13 May 2030")
        self.assertTrue(any("issue date is" in warning for warning in result.warnings))


class TrailingNoiseTests(TestCase):
    def test_transliteration_noise_is_dropped(self):
        self.assertEqual(strip_trailing_noise("SAMPLE EMPLOYEE TESTCASE ewYI"), "SAMPLE EMPLOYEE TESTCASE")

    def test_a_clean_name_is_untouched(self):
        self.assertEqual(strip_trailing_noise("SAMPLE EMPLOYEE TESTCASE"), "SAMPLE EMPLOYEE TESTCASE")
        self.assertEqual(strip_trailing_noise("MOHAMED ALI HASSAN"), "MOHAMED ALI HASSAN")

    def test_a_single_token_is_never_emptied(self):
        self.assertEqual(strip_trailing_noise("SAMPLE"), "SAMPLE")
        self.assertEqual(strip_trailing_noise("ewYI"), "ewYI")

    def test_symbol_runs_are_dropped(self):
        self.assertEqual(strip_trailing_noise("SAMPLE EMPLOYEE |#~"), "SAMPLE EMPLOYEE")


class BilingualDuplicateTextTests(TestCase):
    """The exact text shape the two passes produce for one bilingual card."""

    TEXT = "\n".join(
        [
            "KINGDOM OF SAUDI ARABIA",
            "المملكة العربية السعودية",
            "Full Name: SAMPLE EMPLOYEE TESTCASE ewYI",
            "SAMPLE",
            "EMPLOYEE",
            "TESTCASE",
            "الاسم",
            "Nationality:EGYPT",
            "الجنسية",
            "Iqama Number: 2345678904",
            "2345678904",
            "رقم الهوية",
            "Iqama Expiry: 21/11/2030",
            "21/11/2030",
            "تاريخ الانتهاء",
        ]
    )

    def test_duplicated_fragments_do_not_corrupt_the_parsed_fields(self):
        result = parse_document(EmployeeDocument.DocumentType.IQAMA, self.TEXT)

        self.assertTrue(result.valid, result.warnings)
        self.assertEqual(result.fields["full_name"], "SAMPLE EMPLOYEE TESTCASE")
        self.assertEqual(result.fields["nationality"], "EGYPT")
        self.assertEqual(result.fields["iqama_number"], "2345678904")
        self.assertEqual(result.fields["iqama_expiry_date"], "21/11/2030")

    def test_the_arabic_only_variant_still_yields_a_validated_id(self):
        text = "\n".join(
            [
                "المملكة العربية السعودية",
                "SAMPLE EMPLOYEE TESTCASE",
                "2345678904 :رقم الهوية",
                "رقم",
                "2345678904",
                "21/11/2030",
            ]
        )

        result = parse_document(EmployeeDocument.DocumentType.IQAMA, text)

        self.assertEqual(result.fields["iqama_number"], "2345678904")
        self.assertTrue(result.checks["id_format"])
        self.assertTrue(result.checks["id_checksum"])
