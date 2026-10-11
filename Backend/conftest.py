"""Test-wide settings shared by every backend app."""

import os

import pytest


def pytest_configure(config):
    from django.conf import settings

    # The production hasher (PBKDF2, 1.5M iterations) costs ~0.5s per hash and
    # made up ~32 of the ~37 minutes of the full suite. Tests never depend on
    # the hash strength, so use the fast one here only.
    settings.PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]


@pytest.fixture(scope="session")
def _frozen_documents_root(tmp_path_factory):
    return str(tmp_path_factory.mktemp("frozen_documents_storage"))


@pytest.fixture(autouse=True)
def _isolate_frozen_document_storage(_frozen_documents_root, monkeypatch):
    """Keep frozen approved PDFs written by tests out of the real private uploads volume.

    ``PrivateUploadStorage`` fixes its location at import time, so the cached
    location of the two ``FrozenDocument`` file fields is pointed at a temp dir.
    """

    from core.document_integrity.models import FrozenDocument

    for name in ("file", "unsigned_file"):
        storage = FrozenDocument._meta.get_field(name).storage
        monkeypatch.setitem(storage.__dict__, "base_location", _frozen_documents_root)
        monkeypatch.setitem(storage.__dict__, "location", os.path.abspath(_frozen_documents_root))
