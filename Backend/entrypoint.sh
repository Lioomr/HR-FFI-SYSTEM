#!/bin/sh
set -e

echo "Waiting for database at ${DB_HOST:-db}:${DB_PORT:-5432}..."
until python -c "import os, psycopg2; psycopg2.connect(host=os.getenv('DB_HOST', 'db'), port=os.getenv('DB_PORT', '5432'), dbname=os.getenv('DB_NAME', 'ffi_hr_db'), user=os.getenv('DB_USER', 'postgres'), password=os.getenv('DB_PASSWORD', ''))" >/dev/null 2>&1; do
  echo "Database is unavailable - sleeping"
  sleep 2
done

echo "Running migrations..."
python manage.py migrate --noinput

echo "Starting Gunicorn..."
exec gunicorn config.wsgi:application --bind 0.0.0.0:8000 --workers 3 --timeout 120
