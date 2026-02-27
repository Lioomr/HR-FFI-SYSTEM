import os

import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from django.urls import get_resolver, resolve  # noqa: E402

# Test 1: Try to resolve the export URL
test_urls = [
    "/payroll-runs/2/export/",
    "/payroll-runs/2/export",
    "payroll-runs/2/export/",
]

print("=" * 60)
print("URL RESOLUTION TEST")
print("=" * 60)

for url in test_urls:
    try:
        match = resolve(url)
        print(f"✓ '{url}' RESOLVES")
        print(f"  View: {match.func}")
        print(f"  View name: {match.url_name}")
        print(f"  Args: {match.args}, Kwargs: {match.kwargs}")
    except Exception as e:
        print(f"✗ '{url}' FAILED: {e}")
    print()

# Test 2: List all payroll-related URLs
print("=" * 60)
print("ALL REGISTERED PAYROLL URLs")
print("=" * 60)

resolver = get_resolver()


def list_urls(lis, acc=""):
    for entry in lis:
        if hasattr(entry, "url_patterns"):
            list_urls(entry.url_patterns, acc + str(entry.pattern))
        else:
            pattern = acc + str(entry.pattern)
            if "payroll" in pattern.lower():
                print(f"  {pattern}")


list_urls(resolver.url_patterns)
