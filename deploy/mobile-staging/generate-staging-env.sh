#!/bin/sh
set -eu

# Run this only on the isolated staging host from this directory.
# It deliberately creates fresh secrets and disables all real notification delivery.
umask 077
django_secret="$(openssl rand -hex 48)"
database_secret="$(openssl rand -hex 32)"

{
    printf '%s\n' 'DJANGO_ENV=production'
    printf '%s\n' 'DJANGO_DEBUG=false'
    printf '%s\n' "DJANGO_SECRET_KEY=${django_secret}"
    printf '%s\n' 'DJANGO_ALLOWED_HOSTS=api-mobile-dev.asecopro.com'
    printf '%s\n' 'BACKEND_PUBLIC_URL=https://api-mobile-dev.asecopro.com'
    printf '%s\n' 'FRONTEND_URL=https://app.asecopro.com'
    printf '%s\n' 'CORS_ALLOWED_ORIGINS='
    printf '%s\n' 'CSRF_TRUSTED_ORIGINS='
    printf '%s\n' 'DB_NAME=ffi_hr_mobile_staging'
    printf '%s\n' 'DB_USER=ffi_hr_mobile_staging'
    printf '%s\n' "DB_PASSWORD=${database_secret}"
    printf '%s\n' 'SECURE_SSL_REDIRECT=true'
    printf '%s\n' 'SESSION_COOKIE_SECURE=true'
    printf '%s\n' 'CSRF_COOKIE_SECURE=true'
    printf '%s\n' 'SECURE_HSTS_SECONDS=31536000'
    printf '%s\n' 'SECURE_HSTS_INCLUDE_SUBDOMAINS=false'
    printf '%s\n' 'SECURE_HSTS_PRELOAD=false'
    printf '%s\n' 'SECURE_REFERRER_POLICY=same-origin'
    printf '%s\n' 'NOTIFICATION_WHATSAPP_DELIVERY_ENABLED=false'
    printf '%s\n' 'NOTIFICATION_EMAIL_FALLBACK_ENABLED=false'
    printf '%s\n' 'MESSAGING_SMS_PROVIDER=disabled'
} > .env.staging

chmod 600 .env.staging
