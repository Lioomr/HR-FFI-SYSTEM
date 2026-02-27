import os
from datetime import timedelta
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent

try:
    from dotenv import load_dotenv

    load_dotenv(BASE_DIR / ".env")
except Exception:
    pass


def _env_bool(name, default=False):
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _env_list(name, default=None):
    value = os.environ.get(name)
    if value is None:
        return default or []
    return [item.strip() for item in value.split(",") if item.strip()]


def _is_weak_secret_key(value: str) -> bool:
    if not value:
        return True
    candidate = value.strip()
    weak_values = {
        "django-insecure-dev-only-change-me",
        "django-insecure-local-dev-only",
        "changeme",
        "change-me",
        "secret",
        "password",
    }
    if candidate.lower() in weak_values:
        return True
    if candidate.startswith("django-insecure-"):
        return True
    return len(candidate) < 32


DEBUG = _env_bool("DJANGO_DEBUG", False)
DJANGO_ENV = (os.environ.get("DJANGO_ENV") or os.environ.get("APP_ENV") or os.environ.get("ENVIRONMENT") or "").strip()

if DEBUG and DJANGO_ENV and DJANGO_ENV.lower() not in {"local", "development", "dev"}:
    raise ImproperlyConfigured("DJANGO_DEBUG cannot be true outside a local/development environment.")

SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY")
if not SECRET_KEY:
    if DEBUG:
        SECRET_KEY = "django-insecure-dev-only-change-me"
    else:
        raise ImproperlyConfigured("DJANGO_SECRET_KEY is required when DJANGO_DEBUG is false.")

if not DEBUG and _is_weak_secret_key(SECRET_KEY):
    raise ImproperlyConfigured("DJANGO_SECRET_KEY is too weak for non-debug environments.")

ALLOWED_HOSTS = _env_list("DJANGO_ALLOWED_HOSTS", ["localhost", "127.0.0.1"] if DEBUG else [])
if not DEBUG and not ALLOWED_HOSTS:
    raise ImproperlyConfigured("DJANGO_ALLOWED_HOSTS must be set when DJANGO_DEBUG is false.")

if DEBUG:
    local_hosts = {"localhost", "127.0.0.1", "[::1]"}
    non_local_hosts = [host for host in ALLOWED_HOSTS if host not in local_hosts and not host.endswith(".localhost")]
    if non_local_hosts:
        raise ImproperlyConfigured("DJANGO_DEBUG=true is only allowed with local ALLOWED_HOSTS.")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "rest_framework_simplejwt.token_blacklist",
    "corsheaders",
    "django_filters",
    "core",
    "accounts",
    "admin_portal",
    "audit",
    "invites",
    "employees",
    "payroll",
    "leaves",
    "assets",
    "attendance",
    "hr_reference",
    "announcements",
    "loans",
    "rents",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.locale.LocaleMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

# Email / Bird
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:5173")
DEFAULT_FROM_EMAIL = os.environ.get("DEFAULT_FROM_EMAIL", "no-reply@fficontracting.com")
NOTIFICATION_HTTP_TIMEOUT_SECONDS = int(os.environ.get("NOTIFICATION_HTTP_TIMEOUT_SECONDS", "10"))
PASSWORD_RESET_TOKEN_TTL_SECONDS = int(os.environ.get("PASSWORD_RESET_TOKEN_TTL_SECONDS", "3600"))
MAX_LEAVE_DOCUMENT_SIZE_BYTES = int(os.environ.get("MAX_LEAVE_DOCUMENT_SIZE_BYTES", str(5 * 1024 * 1024)))
MAX_ASSET_INVOICE_SIZE_BYTES = int(os.environ.get("MAX_ASSET_INVOICE_SIZE_BYTES", str(5 * 1024 * 1024)))

# Bird (MessageBird) Channels API
BIRD_API_KEY = os.environ.get("BIRD_API_KEY", "")
BIRD_CHANNEL_ID = os.environ.get("BIRD_CHANNEL_ID", "")
BIRD_ACCESS_KEY = os.environ.get("BIRD_ACCESS_KEY", "")
BIRD_WORKSPACE_ID = os.environ.get("BIRD_WORKSPACE_ID", "")
BIRD_EMAIL_CHANNEL_ID = os.environ.get("BIRD_EMAIL_CHANNEL_ID", "")
BIRD_SMS_CHANNEL_ID = os.environ.get("BIRD_SMS_CHANNEL_ID", "")
BIRD_WHATSAPP_CHANNEL_ID = os.environ.get("BIRD_WHATSAPP_CHANNEL_ID", "")
BIRD_API_BASE_URL = os.environ.get("BIRD_API_BASE_URL", "https://api.bird.com/workspaces")

if not BIRD_API_KEY:
    BIRD_API_KEY = BIRD_ACCESS_KEY
if not BIRD_CHANNEL_ID:
    BIRD_CHANNEL_ID = BIRD_EMAIL_CHANNEL_ID

CORS_ALLOWED_ORIGINS = _env_list(
    "CORS_ALLOWED_ORIGINS",
    ["http://localhost:5173", "http://localhost:3000"] if DEBUG else [],
)
CORS_ALLOW_CREDENTIALS = True
TRUSTED_PROXY_IPS = _env_list("TRUSTED_PROXY_IPS", [])
CSRF_TRUSTED_ORIGINS = _env_list(
    "CSRF_TRUSTED_ORIGINS",
    CORS_ALLOWED_ORIGINS if DEBUG else [],
)

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]
WSGI_APPLICATION = "config.wsgi.application"


DATABASES = {
    "default": {
        "ENGINE": os.environ.get("DB_ENGINE", "django.db.backends.postgresql"),
        "NAME": os.environ.get("DB_NAME", "ffi_hr_db"),
        "USER": os.environ.get("DB_USER", "postgres"),
        "PASSWORD": os.environ.get("DB_PASSWORD", ""),
        "HOST": os.environ.get("DB_HOST", "localhost"),
        "PORT": os.environ.get("DB_PORT", "5432"),
    }
}

if DATABASES["default"]["ENGINE"] == "django.db.backends.sqlite3":
    DATABASES["default"] = {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": os.environ.get("DB_NAME", BASE_DIR / "db.sqlite3"),
    }


AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.CommonPasswordValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.NumericPasswordValidator",
    },
]


# Internationalization
# https://docs.djangoproject.com/en/5.2/topics/i18n/

LANGUAGE_CODE = "en-us"

TIME_ZONE = "UTC"

USE_I18N = True

USE_TZ = True


# Static files (CSS, JavaScript, Images)
# https://docs.djangoproject.com/en/5.2/howto/static-files/

STATIC_URL = "static/"

# Private uploads (not served publicly)
PRIVATE_UPLOAD_ROOT = BASE_DIR / "private_uploads"

SESSION_COOKIE_HTTPONLY = True
CSRF_COOKIE_HTTPONLY = True
X_FRAME_OPTIONS = "DENY"

if not DEBUG:
    SECURE_SSL_REDIRECT = _env_bool("SECURE_SSL_REDIRECT", True)
    SESSION_COOKIE_SECURE = _env_bool("SESSION_COOKIE_SECURE", True)
    CSRF_COOKIE_SECURE = _env_bool("CSRF_COOKIE_SECURE", True)
    SECURE_HSTS_SECONDS = int(os.environ.get("SECURE_HSTS_SECONDS", "31536000"))
    SECURE_HSTS_INCLUDE_SUBDOMAINS = _env_bool("SECURE_HSTS_INCLUDE_SUBDOMAINS", True)
    SECURE_HSTS_PRELOAD = _env_bool("SECURE_HSTS_PRELOAD", True)
    SECURE_CONTENT_TYPE_NOSNIFF = True
    SECURE_REFERRER_POLICY = os.environ.get("SECURE_REFERRER_POLICY", "same-origin")
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

# Default primary key field type
# https://docs.djangoproject.com/en/5.2/ref/settings/#default-auto-field

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

LOGIN_FAILURE_LIMIT = 5
LOGIN_FAILURE_WINDOW_SECONDS = 900
LOGIN_LOCKOUT_SECONDS = 900
LOGIN_THROTTLE_RATE = "10/min"
EMPLOYEE_IMPORT_THROTTLE_RATE = "5/min"
PAYROLL_FINALIZE_THROTTLE_RATE = "5/min"
PAYROLL_GENERATE_PAYSLIPS_THROTTLE_RATE = "5/min"
PAYROLL_EXPORT_THROTTLE_RATE = "10/min"

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ("rest_framework_simplejwt.authentication.JWTAuthentication",),
    "DEFAULT_PERMISSION_CLASSES": ("rest_framework.permissions.IsAuthenticated",),
    "DEFAULT_FILTER_BACKENDS": ("django_filters.rest_framework.DjangoFilterBackend",),
    "DEFAULT_PAGINATION_CLASS": "core.pagination.StandardPagination",
    "PAGE_SIZE": 25,
    "DEFAULT_THROTTLE_RATES": {
        "login": LOGIN_THROTTLE_RATE,
        "employee_import": EMPLOYEE_IMPORT_THROTTLE_RATE,
        "payroll_finalize": PAYROLL_FINALIZE_THROTTLE_RATE,
        "payroll_generate_payslips": PAYROLL_GENERATE_PAYSLIPS_THROTTLE_RATE,
        "payroll_export": PAYROLL_EXPORT_THROTTLE_RATE,
    },
    "EXCEPTION_HANDLER": "core.exceptions.custom_exception_handler",
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=15),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=14),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
}
AUTH_USER_MODEL = "accounts.User"
