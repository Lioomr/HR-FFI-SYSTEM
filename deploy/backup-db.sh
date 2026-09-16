#!/usr/bin/env bash
#
# backup-db.sh — encrypted PostgreSQL backup for the HR-FFI production stack.
#
# Runs `pg_dump` inside the running `ffi_hr_db_prod` container (see
# docker-compose.prod.yml), encrypts the dump with openssl, writes a sha256
# checksum alongside it, and prunes local backups older than
# BACKUP_RETENTION_DAYS. Designed to run unattended from cron on the
# production host (/opt/hr-ffi) — see deploy/HOST_HARDENING_RUNBOOK.md.
#
# Required environment (read from the compose-time env file, e.g.
# /opt/hr-ffi/.env.prod.compose, which already defines these — see
# DOCKER_AGENT_HANDOFF.md section 5):
#   DB_NAME              Postgres database name
#   DB_USER              Postgres user
#   DB_PASSWORD          Postgres password (only needed if pg_dump inside the
#                         container requires it; normally trust/peer auth
#                         inside the container works via PGPASSWORD)
#
# Required environment for encryption (NOT stored in this repo; supply via
# the shell environment or an env file sourced before running this script):
#   BACKUP_ENCRYPTION_PASSPHRASE   openssl enc passphrase. There is no safe
#                                  default — the script refuses to run
#                                  without it.
#
# Optional environment:
#   DB_CONTAINER_NAME      Default: ffi_hr_db_prod
#   BACKUP_DIR             Default: /home/ubuntu/backups (matches the existing
#                          manual backups already on the host)
#   BACKUP_RETENTION_DAYS  Default: 14
#   S3_BACKUP_BUCKET       TODO (see below) — off-host shipping destination
#
# Exit codes: non-zero on ANY failure (pg_dump, encryption, checksum,
# disk space, etc.) so cron/mail can surface the failure loudly.

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration (override via environment)
# ---------------------------------------------------------------------------
DB_CONTAINER_NAME="${DB_CONTAINER_NAME:-ffi_hr_db_prod}"
BACKUP_DIR="${BACKUP_DIR:-/home/ubuntu/backups}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
TIMESTAMP="$(date +%Y-%m-%d_%H%M%S)"
DUMP_NAME="ffi_hr_db_${TIMESTAMP}.dump"
ENC_NAME="${DUMP_NAME}.enc"
SUM_NAME="${ENC_NAME}.sha256"

log() {
  printf '[%s] %s\n' "$(date -Iseconds)" "$1"
}

fail() {
  printf '[%s] ERROR: %s\n' "$(date -Iseconds)" "$1" >&2
  exit 1
}

# ---------------------------------------------------------------------------
# Preconditions
# ---------------------------------------------------------------------------
command -v docker >/dev/null 2>&1 || fail "docker CLI not found on PATH"
command -v openssl >/dev/null 2>&1 || fail "openssl CLI not found on PATH"
command -v sha256sum >/dev/null 2>&1 || fail "sha256sum not found on PATH"

: "${DB_NAME:?DB_NAME must be set (see .env.prod.compose)}"
: "${DB_USER:?DB_USER must be set (see .env.prod.compose)}"
: "${BACKUP_ENCRYPTION_PASSPHRASE:?BACKUP_ENCRYPTION_PASSPHRASE must be set; refusing to write an unencrypted-key-derived backup with a default passphrase. See deploy/HOST_HARDENING_RUNBOOK.md.}"

if ! docker ps --format '{{.Names}}' | grep -qx "${DB_CONTAINER_NAME}"; then
  fail "container '${DB_CONTAINER_NAME}' is not running (checked: docker ps)"
fi

mkdir -p "${BACKUP_DIR}" || fail "could not create backup directory ${BACKUP_DIR}"

# Fail fast if the target filesystem is nearly full (< 1GB free), rather than
# discovering a truncated dump after the fact.
AVAILABLE_KB="$(df -Pk "${BACKUP_DIR}" | awk 'NR==2 {print $4}')"
if [ -z "${AVAILABLE_KB}" ] || [ "${AVAILABLE_KB}" -lt 1048576 ]; then
  fail "less than 1GB free on the filesystem backing ${BACKUP_DIR}; aborting before pg_dump"
fi

DUMP_PATH="${BACKUP_DIR}/${DUMP_NAME}"
ENC_PATH="${BACKUP_DIR}/${ENC_NAME}"
SUM_PATH="${BACKUP_DIR}/${SUM_NAME}"

cleanup_partial() {
  rm -f "${DUMP_PATH}" "${ENC_PATH}" "${SUM_PATH}"
}
trap cleanup_partial ERR

# ---------------------------------------------------------------------------
# 1) Dump (custom format, compressed) via docker exec into the db container
# ---------------------------------------------------------------------------
log "Starting pg_dump of '${DB_NAME}' from container '${DB_CONTAINER_NAME}'"

docker exec \
  -e PGPASSWORD="${DB_PASSWORD:-}" \
  "${DB_CONTAINER_NAME}" \
  pg_dump -U "${DB_USER}" -d "${DB_NAME}" --format=custom --compress=9 \
  > "${DUMP_PATH}" \
  || fail "pg_dump failed"

if [ ! -s "${DUMP_PATH}" ]; then
  fail "pg_dump produced an empty file at ${DUMP_PATH}"
fi

log "pg_dump complete: ${DUMP_PATH} ($(du -h "${DUMP_PATH}" | cut -f1))"

# ---------------------------------------------------------------------------
# 2) Encrypt
#
# NOTE: this uses openssl AES-256-CBC with PBKDF2 key derivation, a
# reasonable modern default. The existing manual backups found on the host
# (ffi_hr_db_2026-08-26_*.dump.enc) were NOT produced by this script — their
# exact encryption command is undocumented. Confirm whether this matches
# before treating old and new backups as interchangeable for restore
# procedures. See "Open Questions" in the runbook.
# ---------------------------------------------------------------------------
log "Encrypting dump"

openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt \
  -pass env:BACKUP_ENCRYPTION_PASSPHRASE \
  -in "${DUMP_PATH}" -out "${ENC_PATH}" \
  || fail "openssl encryption failed"

rm -f "${DUMP_PATH}"

# ---------------------------------------------------------------------------
# 3) Checksum
# ---------------------------------------------------------------------------
log "Writing checksum"

( cd "${BACKUP_DIR}" && sha256sum "${ENC_NAME}" > "${SUM_NAME}" ) \
  || fail "sha256sum generation failed"

# ---------------------------------------------------------------------------
# 4) Off-host durability (TODO — placeholder only)
#
# Local backups share a disk/volume with the database they protect against
# instance or volume loss; that is not durability. Wire up one of:
#   - `aws s3 cp "${ENC_PATH}" "s3://${S3_BACKUP_BUCKET}/$(basename "${ENC_PATH}")"`
#     (requires an IAM role/instance profile on the EC2 host with s3:PutObject
#     on the target bucket — not configured by this script)
#   - rsync/scp to a separate host
# This script intentionally does NOT implement the upload; no AWS
# credentials or CLI access were available when this script was written.
# ---------------------------------------------------------------------------
if [ -n "${S3_BACKUP_BUCKET:-}" ]; then
  log "S3_BACKUP_BUCKET is set but off-host upload is not implemented yet (TODO)"
fi

# ---------------------------------------------------------------------------
# 5) Prune old local backups
# ---------------------------------------------------------------------------
log "Pruning local backups older than ${BACKUP_RETENTION_DAYS} days"

find "${BACKUP_DIR}" -maxdepth 1 -type f -name 'ffi_hr_db_*.dump.enc' \
  -mtime "+${BACKUP_RETENTION_DAYS}" -print -delete || true
find "${BACKUP_DIR}" -maxdepth 1 -type f -name 'ffi_hr_db_*.dump.enc.sha256' \
  -mtime "+${BACKUP_RETENTION_DAYS}" -print -delete || true

trap - ERR

log "Backup complete: ${ENC_PATH}"
log "Checksum: ${SUM_PATH}"

exit 0
