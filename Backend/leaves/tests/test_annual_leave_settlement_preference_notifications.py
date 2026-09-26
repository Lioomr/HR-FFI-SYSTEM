from django.test import SimpleTestCase

from leaves.annual_payment_services import _preference_details
from leaves.models import AnnualLeavePaymentRequest


class PreferenceDetailsTests(SimpleTestCase):
    def test_states_the_employee_preference_for_approvers(self):
        instance = AnnualLeavePaymentRequest(
            employee_preference=AnnualLeavePaymentRequest.EmployeePreference.CARRY_FORWARD
        )
        self.assertEqual(len(_preference_details(instance)), 1)
        self.assertTrue(_preference_details(instance)[0].startswith("Employee Preference: "))

    def test_omits_the_line_when_no_preference_was_recorded(self):
        self.assertEqual(_preference_details(AnnualLeavePaymentRequest(employee_preference="")), [])
