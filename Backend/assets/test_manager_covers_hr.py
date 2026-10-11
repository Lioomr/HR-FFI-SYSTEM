from django.contrib.auth.models import Group

from assets.models import AssetReturnRequest
from assets.services.return_requests import apply_hr_decision, apply_manager_decision, record_return_request_submission
from assets.test_return_request_history import AssetReturnHistoryTests as _Base
from assets.test_return_request_history import Status


class AssetManagerCoversHrTests(_Base):
    def test_hr_manager_as_line_manager_approves_without_a_second_hr_step(self):
        self.manager.groups.add(Group.objects.get_or_create(name="HRManager")[0])
        request_obj = self._request()
        record_return_request_submission(request_obj, actor=self.employee)

        request_obj, _ = apply_manager_decision(request_obj, actor=self.manager, approve=True)

        self.assertEqual(request_obj.status, Status.APPROVED)
        self.assertEqual(request_obj.hr_decision_by, self.manager)
        self.assertEqual(self._steps(request_obj)[-1][0:2], ("approve", "hr"))

    def test_ordinary_manager_still_hands_over_to_hr(self):
        request_obj = self._request()
        record_return_request_submission(request_obj, actor=self.employee)

        request_obj, _ = apply_manager_decision(request_obj, actor=self.manager, approve=True)

        self.assertEqual(request_obj.status, Status.PENDING)
        apply_hr_decision(request_obj, actor=self.hr_user, approve=True)

    def test_manager_rejection_never_covers_hr(self):
        self.manager.groups.add(Group.objects.get_or_create(name="HRManager")[0])
        request_obj = self._request()
        record_return_request_submission(request_obj, actor=self.employee)

        request_obj, _ = apply_manager_decision(request_obj, actor=self.manager, approve=False, comment="No")

        self.assertEqual(request_obj.status, AssetReturnRequest.RequestStatus.REJECTED)
        self.assertIsNone(request_obj.hr_decision_by)
