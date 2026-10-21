from unittest.mock import patch

from django.test import SimpleTestCase

from attendance.services import SYNC_DISABLED_MESSAGE
from attendance.tasks import sync_biotime_attendance


class DisabledBioTimeSyncLoggingTests(SimpleTestCase):
    def test_disabled_sync_is_logged_as_info_not_error(self):
        with (
            patch(
                "attendance.tasks.SyncBioTimeService.execute",
                return_value=(False, {"message": SYNC_DISABLED_MESSAGE}),
            ),
            self.assertLogs("attendance.tasks", level="INFO") as captured,
        ):
            sync_biotime_attendance()

        self.assertEqual([record.levelname for record in captured.records], ["INFO"])
