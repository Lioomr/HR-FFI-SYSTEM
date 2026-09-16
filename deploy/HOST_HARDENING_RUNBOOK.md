# Host Hardening Runbook (Production EC2)

This runbook covers the host-level gaps found in a production audit of the
`/opt/hr-ffi` EC2 host: no encrypted backup schedule, no swap, unbounded
Docker container logs, and no host-level monitoring/alerting. It follows the
same host layout documented in `DEPLOYMENT_DOCKER.md` and
`AWS_AGENT_DEPLOYMENT_HANDOFF.md` (compose file at `/opt/hr-ffi/docker-compose.prod.yml`,
compose-time env at `/opt/hr-ffi/.env.prod.compose`, containers
`ffi_hr_db_prod`, `ffi_hr_backend_prod`, `ffi_hr_frontend_prod`).

All commands below run on the production host as the `ubuntu` user unless
noted otherwise. Commands marked **[YOU RUN]** require AWS credentials or
production SSH access this agent does not have — run them yourself after
review.

## 1) Encrypted Database Backups

Script: `deploy/backup-db.sh` (in this repo).

### 1.1 One-time setup on the host

```bash
sudo mkdir -p /opt/hr-ffi/backups
sudo chown ubuntu:ubuntu /opt/hr-ffi/backups
cp deploy/backup-db.sh /opt/hr-ffi/backup-db.sh
chmod +x /opt/hr-ffi/backup-db.sh
```

Store the encryption passphrase and DB credentials outside of git, e.g. a
root-only env file:

```bash
sudo install -m 600 -o root -g root /dev/null /etc/hr-ffi-backup.env
sudo tee /etc/hr-ffi-backup.env >/dev/null <<'EOF'
DB_NAME=<from .env.prod.compose>
DB_USER=<from .env.prod.compose>
DB_PASSWORD=<from .env.prod.compose>
BACKUP_ENCRYPTION_PASSPHRASE=<choose a strong passphrase>
# S3_BACKUP_BUCKET=<set once off-host destination is decided>
EOF
```

`DB_NAME`, `DB_USER`, `DB_PASSWORD` must match the values already used by
`docker-compose.prod.yml` for the `db` service (`ffi_hr_db_prod`), which are
sourced from `/opt/hr-ffi/.env.prod.compose`.

### 1.2 Manual test run (do this yourself, not in CI/agent context)

```bash
set -a; source /etc/hr-ffi-backup.env; set +a
/opt/hr-ffi/backup-db.sh
ls -la /opt/hr-ffi/backups
```

Verify the checksum:

```bash
cd /opt/hr-ffi/backups
sha256sum -c ffi_hr_db_<timestamp>.dump.enc.sha256
```

### 1.3 Cron schedule

Create `/etc/cron.d/hr-ffi-backup` (root-owned, `0644`):

```cron
# Daily encrypted DB backup at 02:15 server time (low-traffic hour)
15 2 * * * ubuntu . /etc/hr-ffi-backup.env && /opt/hr-ffi/backup-db.sh >> /var/log/hr-ffi-backup.log 2>&1
```

Notes:
- Confirm server time zone (`timedatectl`) before relying on "02:15" meaning
  low-traffic hours in the business's actual timezone.
- Redirect output to a log file so cron failures are visible; consider piping
  through `mail` or a healthcheck ping (the repo already uses
  `HEALTHCHECKS_PING_URL` for Celery Beat — a second distinct check URL for
  backups would give the same "did this actually run" visibility without new
  tooling).
- The script exits non-zero on any failure step, so a monitoring wrapper
  (cron's own mail, or a Healthchecks "failure" ping) will catch silent
  breakage.

### 1.4 Off-host durability — placeholder, not implemented

The script has a `S3_BACKUP_BUCKET` hook but does **not** upload anywhere.
**[YOU RUN]** once a destination is decided, e.g.:

```bash
aws s3 cp /opt/hr-ffi/backups/ffi_hr_db_<timestamp>.dump.enc \
  s3://<bucket>/ffi_hr_db_<timestamp>.dump.enc
```

This requires either an IAM instance profile attached to the EC2 host with
`s3:PutObject` on the target bucket, or credentials configured on the host.
Neither was available to verify from this repo. Decide bucket, region,
lifecycle policy (e.g. Glacier transition), and whether to also copy the
`.sha256` file.

### 1.5 Encryption-format caveat

The two existing manual backups on the host
(`ffi_hr_db_2026-08-26_*.dump.enc` + `.sha256`) were not produced by this
script — the command that generated them is undocumented. This script uses
`openssl enc -aes-256-cbc -pbkdf2 -iter 200000`. **Confirm** whether the
existing files use the same cipher/KDF before assuming both old and new
backups can be decrypted the same way; if not, document the old command
separately or treat pre-existing backups as a one-off archive.

---

## 2) Swap Space

The host has 7.6GB RAM and runs Postgres, Redis, Django, Celery
worker/beat, and PaddleOCR concurrently — OCR and Postgres can both spike
memory. A common rule of thumb for hosts under 8GB RAM is swap ≈ RAM; 6GB
is a reasonable middle ground here (enough headroom to absorb a transient
spike and avoid an OOM kill, not so large that a host that starts thrashing
becomes unusably slow instead of just erroring). **[YOU RUN]**:

```bash
# 1. Create and secure a 6GB swapfile
sudo fallocate -l 6G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=6144
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# 2. Verify
swapon --show
free -h

# 3. Persist across reboots
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# 4. Set swappiness low (swap is an OOM safety net here, not primary memory
#    extension — a high swappiness would proactively push idle pages to disk
#    and slow down Postgres/Redis under normal load; a low value keeps swap
#    idle until real memory pressure hits)
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/60-hr-ffi-swappiness.conf
sudo sysctl --system
```

Verify after a reboot (during a scheduled maintenance window, not ad hoc)
that `swapon --show` still lists `/swapfile`.

---

## 3) Docker Log Rotation

`/etc/docker/daemon.json` does not currently exist, so all containers use
the default `json-file` driver with no size cap — the long-running
`notification-worker`/`notification-beat` containers are the most likely to
accumulate unbounded logs over time.

### 3.1 Create the daemon config

**[YOU RUN]**:

```bash
sudo tee /etc/docker/daemon.json >/dev/null <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "5"
  }
}
EOF
```

This caps each container's log at 5 files x 10MB = 50MB max, which is
generous for debugging while bounding worst-case disk usage per container.
Adjust if any service is known to be unusually chatty.

### 3.2 Restart Docker daemon

**This restarts every container on the host**, not just this app's stack —
schedule it for a low-traffic maintenance window, not casually mid-day:

```bash
sudo systemctl restart docker
```

After restart, verify the stack came back up:

```bash
cd /opt/hr-ffi
docker compose --env-file .env.prod.compose -f docker-compose.prod.yml ps
```

### 3.3 Existing oversized logs (one-time manual cleanup)

The new `daemon.json` only affects logs written after the restart — any
already-oversized log files need manual truncation. Find them first:

```bash
sudo du -sh /var/lib/docker/containers/*/*-json.log | sort -rh | head
```

Then, for each oversized file (replace `<container-id>`):

```bash
# WARNING: this discards all existing log history for that container.
# `docker logs` for it will show nothing before this point.
sudo truncate -s 0 /var/lib/docker/containers/<container-id>/<container-id>-json.log
```

Do this only for containers actually using excessive disk; do not blanket-
truncate everything without checking first.

---

## 4) Host-Level Monitoring/Alerting

No `cdk.json` or `*.tf` files exist in this repo, so this runbook does not
introduce Terraform/CDK — it uses the AWS CLI directly, consistent with the
rest of the deployment being managed by hand per `DEPLOYMENT_DOCKER.md`.

For a single-host deployment like this, the CloudWatch agent (rather than a
third-party APM/alerting stack) is the right choice: it is the only way to
get memory and disk metrics for an EC2 instance (the default EC2 metrics
only cover CPU, network, and basic disk I/O — not memory or disk usage
percentage), it integrates directly with CloudWatch Alarms/SNS without
another vendor account, and it is a single package install rather than a new
piece of infrastructure to maintain.

### 4.1 Install and configure the CloudWatch agent

**[YOU RUN]**, on the host:

```bash
sudo apt-get update
sudo apt-get install -y amazon-cloudwatch-agent
```

Create `/opt/aws/amazon-cloudwatch-agent/etc/config.json`:

```json
{
  "metrics": {
    "namespace": "HR-FFI/Prod",
    "metrics_collected": {
      "mem": {
        "measurement": ["mem_used_percent"],
        "metrics_collection_interval": 60
      },
      "disk": {
        "measurement": ["used_percent"],
        "metrics_collection_interval": 60,
        "resources": ["/"]
      },
      "cpu": {
        "measurement": ["cpu_usage_active"],
        "metrics_collection_interval": 60
      }
    }
  }
}
```

Start it:

```bash
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
  -a fetch-config -m ec2 -s \
  -c file:/opt/aws/amazon-cloudwatch-agent/etc/config.json
sudo systemctl status amazon-cloudwatch-agent
```

This requires the EC2 instance to have an IAM role/instance profile with
`CloudWatchAgentServerPolicy` (or equivalent) attached — verify this is
already the case or attach it via the AWS console/CLI before starting the
agent.

### 4.2 Alarms

The following are `aws cloudwatch put-metric-alarm` commands — **[YOU
RUN]** these yourself with real values; placeholders below need the actual
instance ID and an SNS topic ARN to notify (create one first with
`aws sns create-topic` if none exists):

```bash
INSTANCE_ID=<i-xxxxxxxxxxxxxxxxx>   # placeholder — fill in
SNS_TOPIC_ARN=<arn:aws:sns:...>     # placeholder — fill in

# CPU > 85% for 10 minutes
aws cloudwatch put-metric-alarm \
  --alarm-name hr-ffi-high-cpu \
  --namespace AWS/EC2 --metric-name CPUUtilization \
  --dimensions Name=InstanceId,Value=$INSTANCE_ID \
  --statistic Average --period 300 --evaluation-periods 2 \
  --threshold 85 --comparison-operator GreaterThanThreshold \
  --alarm-actions $SNS_TOPIC_ARN

# Memory > 85% for 10 minutes (requires the CloudWatch agent's mem metric)
aws cloudwatch put-metric-alarm \
  --alarm-name hr-ffi-high-memory \
  --namespace HR-FFI/Prod --metric-name mem_used_percent \
  --statistic Average --period 300 --evaluation-periods 2 \
  --threshold 85 --comparison-operator GreaterThanThreshold \
  --alarm-actions $SNS_TOPIC_ARN

# Disk > 85% used on root volume
aws cloudwatch put-metric-alarm \
  --alarm-name hr-ffi-high-disk \
  --namespace HR-FFI/Prod --metric-name used_percent \
  --statistic Average --period 300 --evaluation-periods 2 \
  --threshold 85 --comparison-operator GreaterThanThreshold \
  --alarm-actions $SNS_TOPIC_ARN

# EC2 status check failure (system or instance) — would have caught/explained
# the unexplained reboot
aws cloudwatch put-metric-alarm \
  --alarm-name hr-ffi-status-check-failed \
  --namespace AWS/EC2 --metric-name StatusCheckFailed \
  --dimensions Name=InstanceId,Value=$INSTANCE_ID \
  --statistic Maximum --period 60 --evaluation-periods 2 \
  --threshold 0 --comparison-operator GreaterThanThreshold \
  --alarm-actions $SNS_TOPIC_ARN
```

Thresholds above (85% CPU/memory/disk, any status check failure) are a
reasonable starting point for a single-instance app host; tune after
observing normal baseline load for a week or two.

---

## Summary Checklist

- [ ] Copy `deploy/backup-db.sh` to `/opt/hr-ffi/backup-db.sh`, create
      `/etc/hr-ffi-backup.env` with real credentials/passphrase, test a
      manual run, then install the `/etc/cron.d/hr-ffi-backup` cron entry.
- [ ] Decide and wire up an off-host backup destination (S3 or otherwise).
- [ ] Confirm whether the existing `.dump.enc` files on the host use the
      same encryption scheme as this script, or document the difference.
- [ ] Create and enable a 6GB swapfile, persist via `/etc/fstab`, set
      `vm.swappiness=10`.
- [ ] Add `/etc/docker/daemon.json` with `json-file` size/rotation caps,
      restart Docker during a maintenance window, truncate any existing
      oversized log files.
- [ ] Install and configure the CloudWatch agent for CPU/memory/disk, and
      create CPU/memory/disk/status-check alarms via the AWS CLI.
