"""Test-wide settings shared by every backend app."""


def pytest_configure(config):
    from django.conf import settings

    # The production hasher (PBKDF2, 1.5M iterations) costs ~0.5s per hash and
    # made up ~32 of the ~37 minutes of the full suite. Tests never depend on
    # the hash strength, so use the fast one here only.
    settings.PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
