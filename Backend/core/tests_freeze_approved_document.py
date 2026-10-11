"""``freeze_approved_document`` reads each type's final statuses from its adapter.

One source of truth (``DocumentType.final_statuses`` / ``final_check``): every
registered type accepts exactly its own final statuses and refuses the rest.
The record lookup and the freeze itself are stubbed; the real freeze is covered
by each module's ``test_document_integrity.py``.
"""

from __future__ import annotations

import dataclasses
from io import StringIO
from types import SimpleNamespace
from unittest import mock

import pytest
from django.core.management import CommandError, call_command

from core.document_integrity.registry import registered_types

COMMAND = "core.management.commands.freeze_approved_document"
NOW = "2026-10-08T10:00:00+03:00"

#: type -> (accepted statuses, refused statuses)
EXPECTED = {
    "leave_request": (["approved"], ["pending_ceo", "rejected", "cancelled"]),
    "loan_request": (["approved", "deducted"], ["pending_disbursement", "rejected"]),
    "permission_request": (["approved"], ["pending_hr", "rejected"]),
    "annual_leave_payment_request": (["approved", "carried_forward"], ["pending_ceo", "rejected"]),
    "job_offer": (["sent", "accepted", "rejected", "expired", "cancelled"], ["draft"]),
    "starting_work_acknowledgment": (["approved"], ["pending_hr", "rejected", "voided"]),
    "asset_return_request": (["PROCESSED"], ["APPROVED", "PENDING_HR"]),
    "asset_damage_report": (["APPROVED"], ["PENDING_CEO", "REJECTED"]),
    "contract_rating": (["DECIDED"], ["PENDING_CEO", "MANUAL_RESOLUTION_REQUIRED", "CANCELLED"]),
}
CASES = [(key, status, True) for key, (ok, _) in EXPECTED.items() for status in ok] + [
    (key, status, False) for key, (_, refused) in EXPECTED.items() for status in refused
]


def _run(key, instance, *, frozen=None, force=False):
    adapter = registered_types()[key]
    manager = mock.Mock()
    manager.filter.return_value.first.return_value = instance
    fake = dataclasses.replace(adapter, model=SimpleNamespace(_default_manager=manager))
    out = StringIO()
    with (
        mock.patch(f"{COMMAND}.registered_types", return_value={key: fake}),
        mock.patch(f"{COMMAND}.get_frozen_document", return_value=frozen),
        mock.patch(f"{COMMAND}.finalize_document", return_value=SimpleNamespace(version=1, sha256="ab12")) as fin,
    ):
        args = ["freeze_approved_document", "--type", key, "--id", "7"] + (["--force"] if force else [])
        call_command(*args, stdout=out)
    return fin, out.getvalue()


def test_every_registered_type_declares_its_final_statuses():
    types = registered_types()
    assert set(EXPECTED) <= set(types), "a type lost its registration"
    for key, (accepted, _) in EXPECTED.items():
        assert sorted(types[key].final_statuses) == sorted(accepted), key


@pytest.mark.parametrize("key,status,accepted", CASES)
def test_command_accepts_only_the_adapters_final_statuses(key, status, accepted):
    instance = SimpleNamespace(pk=7, status=status, sent_at=NOW)
    if accepted:
        fin, out = _run(key, instance)
        fin.assert_called_once_with(instance)
        assert "Frozen v1 sha256=ab12" in out
    else:
        with pytest.raises(CommandError, match="final status"):
            _run(key, instance)


def test_a_cancelled_job_offer_that_was_never_sent_is_refused():
    with pytest.raises(CommandError, match="final status"):
        _run("job_offer", SimpleNamespace(pk=7, status="cancelled", sent_at=None))


def test_already_frozen_needs_force():
    instance = SimpleNamespace(pk=7, status="DECIDED")
    with pytest.raises(CommandError, match="Already frozen"):
        _run("contract_rating", instance, frozen=object())
    fin, _ = _run("contract_rating", instance, frozen=object(), force=True)
    fin.assert_called_once()


def test_unknown_type_and_missing_record():
    with pytest.raises(CommandError, match="Unknown document type"):
        call_command("freeze_approved_document", "--type", "nope", "--id", "1")
    with pytest.raises(CommandError, match="Record not found"):
        _run("leave_request", None)
