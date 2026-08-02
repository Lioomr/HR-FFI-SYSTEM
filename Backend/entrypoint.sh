#!/bin/sh
set -e

echo "Waiting for database at ${DB_HOST:-db}:${DB_PORT:-5432}..."
until python -c "import os, psycopg2; psycopg2.connect(host=os.getenv('DB_HOST', 'db'), port=os.getenv('DB_PORT', '5432'), dbname=os.getenv('DB_NAME', 'ffi_hr_db'), user=os.getenv('DB_USER', 'postgres'), password=os.getenv('DB_PASSWORD', ''))" >/dev/null 2>&1; do
  echo "Database is unavailable - sleeping"
  sleep 2
done

if [ "$#" -gt 0 ]; then
  if [ "$1" = "celery" ]; then
    echo "Checking notification worker dependencies..."
    python -m config.worker_readiness
  fi
  echo "Starting command: $*"
  exec "$@"
fi

echo "Running migrations..."
python manage.py migrate --noinput

echo "Starting Daphne ASGI server..."
exec daphne -b 0.0.0.0 -p 8000 config.asgi:application
