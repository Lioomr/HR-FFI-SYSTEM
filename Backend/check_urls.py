import os
import django
from django.urls import resolve, reverse

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

path = "/payroll-runs/2/export"
try:
    match = resolve(path)
    print(f"'{path}' resolves to: {match.func} (name: {match.func.__name__}, module: {match.func.__module__})")
except Exception as e:
    print(f"'{path}' FAILED to resolve: {e}")

path_slash = "/payroll-runs/2/export/"
try:
    match = resolve(path_slash)
    print(f"'{path_slash}' resolves to: {match.func} (name: {match.func.__name__}, module: {match.func.__module__})")
except Exception as e:
    print(f"'{path_slash}' FAILED to resolve: {e}")

path_manual = "/payroll-runs/2/export_manual/"
try:
    match = resolve(path_manual)
    print(f"'{path_manual}' resolves to: {match.func} (name: {match.func.__name__}, module: {match.func.__module__})")
except Exception as e:
    print(f"'{path_manual}' FAILED to resolve: {e}")
