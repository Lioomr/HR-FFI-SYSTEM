from django.test import SimpleTestCase
from rest_framework.exceptions import ErrorDetail

from core.responses import _normalize_422_errors, error

MAX_GRACE = "Ensure this value is less than or equal to 240."


class NormalizeValidationErrorsTests(SimpleTestCase):
    def test_flat_field_errors_keep_their_existing_shape(self):
        errors = {"email": [ErrorDetail("Enter a valid email address.", code="invalid"), "Already invited."], "role": "Required."}

        self.assertEqual(
            _normalize_422_errors(errors),
            [
                {"field": "email", "message": "Enter a valid email address."},
                {"field": "email", "message": "Already invited."},
                {"field": "role", "message": "Required."},
            ],
        )

    def test_top_level_non_field_errors_keep_their_key(self):
        self.assertEqual(
            _normalize_422_errors({"non_field_errors": ["Dates overlap."]}),
            [{"field": "non_field_errors", "message": "Dates overlap."}],
        )

    def test_nested_serializer_errors_use_dotted_field_paths(self):
        errors = {
            "attendance": {
                "grace_window_minutes": [ErrorDetail(MAX_GRACE, code="max_value")],
                "non_field_errors": ["Check the attendance policy."],
            }
        }

        self.assertEqual(
            _normalize_422_errors(errors),
            [
                {"field": "attendance.grace_window_minutes", "message": MAX_GRACE},
                {"field": "attendance", "message": "Check the attendance policy."},
            ],
        )

    def test_many_serializer_and_list_field_errors_include_the_item_index(self):
        errors = {
            "items": [{}, {"quantity": ["Must be positive."]}],
            "attachment_metadata": {1: ["Each attachment_metadata entry must be a JSON object."]},
        }

        self.assertEqual(
            _normalize_422_errors(errors),
            [
                {"field": "items.1.quantity", "message": "Must be positive."},
                {"field": "attachment_metadata.1", "message": "Each attachment_metadata entry must be a JSON object."},
            ],
        )

    def test_contract_shaped_lists_strings_and_none_are_preserved(self):
        normalized = [{"field": "employee_id", "message": "Employee Profile not found."}]

        self.assertIs(_normalize_422_errors(normalized), normalized)
        self.assertEqual(_normalize_422_errors("Bad request."), [{"message": "Bad request."}])
        self.assertIsNone(_normalize_422_errors(None))

    def test_error_message_is_the_first_nested_message_not_a_python_dict(self):
        response = error(
            "Validation error",
            errors={"attendance": {"grace_window_minutes": [ErrorDetail(MAX_GRACE, code="max_value")]}},
            status=422,
        )

        self.assertEqual(response.data["message"], MAX_GRACE)
        self.assertEqual(response.data["errors"], [{"field": "attendance.grace_window_minutes", "message": MAX_GRACE}])
