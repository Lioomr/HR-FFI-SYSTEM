# AWS Cost Investigation: HR-FFI production (2026-10-07)

Scope: read-only. Nothing was changed on the server, in AWS, or in the repo (apart from this file). No secret values were read; env files were inspected for key names, plus the non-secret `SENTRY_*_SAMPLE_RATE` values.

**Headline:** the workload is tiny and mostly idle. There is no runaway process, no egress problem and no polling storm. The cost is the fixed price of the instance and the volume, so the real levers are instance size and disk size. The AWS bill itself was not accessible (see section 6), so no dollar figures are claimed. Savings are given as ratios that follow from AWS's pricing structure.

Legend: **FACT** = measured on the host or in the repo. **GUESS** = inference, needs Cost Explorer to confirm.

---

## 1. Ranked cost drivers

### #1 EC2 `t3.large` is about 2x bigger than the load needs (compute)
FACTS
- Instance: `t3.large`, on-demand (not Spot), 2 vCPU / 7.8 GB RAM, `eu-north-1b` (IMDSv2).
- CPU, from sysstat history (sar), Sep 27 to Oct 7: daily average user+sys is **about 2.5-5%**, idle 93-97%. Busiest 10-minute sample ever is 31% (Oct 4), otherwise below 17%. Steal is 0.01-0.17%.
- Memory, from sar: used RAM is **1.1-1.3 GB** on a normal day. Two spikes in the window: 2.3 GB (Oct 5) and **5.9 GB (Sep 28)**. These are consistent with an on-host `docker build` (the images are 3.2 GB), but that was not verified.
- Right now: 1.6 GB used, 6.2 GB available, no swap. Per container: worker 254 MB, backend 224 MB, evolution-api 256 MB, beat 128 MB, db 73 MB, everything else under 50 MB.
- T3 CPU credits: average CPU is far below the t3.large 30% baseline, so credits accrue and no unlimited-mode surcharge is plausible. I could not read CloudWatch, so this is inferred from utilisation.
- The instance **already runs on a schedule**. `last -x` shows a graceful power-off (ACPI "Power key pressed short", i.e. an EC2 Stop API call) at about 14:00-14:03 UTC, and a start at about 04:00 UTC. Thu to Sun gaps are visible (for example shutdown Thu Sep 17 16:01, start Sun Sep 20 04:00), so it looks like a Sun-Thu working-hours schedule with manual extra starts. Powered-on time computed from `last` over the last 30 days is about **528 h of 720 (73%)**. That is a lower bound, because early-window history was cut off.
- I cannot see who or what triggers the stop (EventBridge, Instance Scheduler, SSM or a person). The key evidence is in CloudTrail (`StopInstances`/`StartInstances`).

FIX (low risk, biggest single saving): move to **`t3.medium`** (2 vCPU / 4 GB). Within the T3 family the hourly price scales exactly with size, so t3.medium is **half** the t3.large hourly rate. Compute is billed only for running hours, so the saving is 50% of whatever the EC2 line is in Cost Explorer.
- Steady-state RAM of 1.1-1.3 GB fits in 4 GB with margin. The risk is the build spike (5.9 GB on Sep 28).
- Mitigations: add a 2 GB swap file, or build images off-box and only pull on the server.
- Do not go to t3.small (2 GB): the OCR worker plus a build would not fit.
- Procedure: stop, change instance type, start (about 2-3 minutes of downtime, and it fits inside the existing nightly stop window). The Elastic IP is kept.
- Keep the instance type in the schedule job if one exists.
- Compute Savings Plans or Reserved Instances: **not recommended** at about 73% duty. Only reconsider if the schedule is dropped and it runs 24/7.

### #2 EBS root volume is oversized, and Docker data is the bloat (storage)
FACTS
- One volume: 80 GB (`nvme0n1`, 77 GB filesystem), 37 GB used, 49%.
- **32 GB of the 37 GB is `/var/lib/containerd`** (this host stores Docker images and cache there, not in `/var/lib/docker`). That is 26 GB of snapshots plus 6.6 GB of content blobs.
- `docker system df`: 14 images (29.6 GB, reported 25.8 GB reclaimable), **build cache 25.9 GB across 407 entries, 15.6 GB reclaimable, none active**. Reported figures overlap because layers are shared, so true reclaimable space is below the sum.
- Images present: the live `hr-ffi-*` set (3.2 GB each for backend/worker/beat), a full 2-week-old rollback set `ffi-rollback/*:a365dd27-20260923` (about 9.5 GB), `ffi-tenant-backend:de5267a34e9` (1.14 GB, 6 weeks old, not used by any container), plus `node:22-alpine` and `nginx:1.27-alpine` (build images). No dangling images.
- Why the cache keeps growing: `/etc/cron.d/prune-docker-build-cache` runs `docker builder prune -a -f --filter until=1080h` (**1080 h = 45 days**) every Sunday 03:30 UTC. Its log shows `Total: 0B` because everything was built inside 45 days. Frequent rebuilds produce the roughly 25 GB. The Sunday 03:30 run also lands while the box is stopped (it starts 04:00), so the job may not execute at all. That is a GUESS; check `/var/log/prune-docker-build-cache.log` timestamps.
- Everything else is small: Postgres volume 105 MB (DB is 31 MB), evolution Postgres 78 MB, uploads 46 MB, journal 492 MB, snap 453 MB, apt 112 MB + 202 MB, `.git` in `/opt/hr-ffi` 284 MB, `CinematicSite/assets` 80 MB, DB backups 5.7 MB.
- Container logs: no `daemon.json` and no `max-size` on any container (all `json-file`, no rotation). Currently only **17 MB** total, because containers are recreated at each deploy, so this is a latent risk rather than a present cost.

IMPORTANT: EBS is billed on **provisioned GB**, not used GB. Pruning frees disk but saves $0 on its own. A real saving needs a smaller volume (for example 30-40 GB). EBS volumes cannot shrink in place. It means creating a new smaller volume, copying the data and swapping it (planned downtime, moderate risk). The saving is roughly the cost of the removed GB. I did not look up current gp3 pricing in `eu-north-1`; check the AWS pricing page. At this scale it is a few dollars per month, so it is **optional and lower priority than #1**.

FIX 1 (safe hygiene, no bill impact): replace the 45-day prune with a short one and run it on a day the box is up. Example for `/etc/cron.d`: `0 5 * * 1-4 root /usr/bin/docker builder prune -f --filter until=168h`. Remove old rollback sets and unused images only deliberately, for example `docker image rm ffi-tenant-backend:de5267a34e9` after confirming it is not needed.
FIX 2 (logs): add to `/etc/docker/daemon.json` `{"log-driver":"json-file","log-opts":{"max-size":"10m","max-file":"3"}}`. This needs a Docker daemon restart and recreated containers, so apply it in a deploy window. Also set `SystemMaxUse=200M` in `journald.conf`.
FIX 3 (volume shrink): only if you want the EBS saving. Plan it as a maintenance window and do the prune in FIX 1 first.

### #3 Public IPv4 / Elastic IP (small, fixed)
- FACT: the public IP `13.51.209.116` is unchanged across the daily stop/start. An auto-assigned public IP would be released on stop, so this is almost certainly an Elastic IP (inference).
- GUESS: AWS charges a flat hourly fee per public IPv4 address, running or stopped. It is a small fixed line item. It cannot be removed while the site needs a stable IP. A future option is IPv6 or a Cloudflare tunnel, but that is a design change, not a quick win.

### #4 Network egress: NOT a cost driver
FACTS
- nginx access logs, Sep 23 to Oct 7 (74,532 requests): **318 MB total bytes sent** (about 15-36 MB/day), roughly 0.7 GB per month. sar on `ens5` shows an average of **0.3-1.7 kB/s** transmitted. That is far below the monthly free data-transfer allowance (AWS gives roughly 100 GB per month outbound free; verify on your account).
- Cloudflare sits in front (client IPs in the log are Cloudflare ranges such as 162.159.x and 172.64-71.x). Assets served to browsers are gzip'd, with `Cache-Control: public, max-age=31536000, immutable` on hashed bundles (checked on a `vendor-antd` bundle: 389 KB gzipped). `index.html` is `no-store`, which is correct.
- Top routes by bytes: static bundles and logos (about 25 MB each over 14 days), `/api/notifications/` 20 MB, and `/api/leaves/leave-requests/N/pdf/` 19.6 MB (14 requests of about 2 MB each).
- Polling: the web app polls `/api/notifications/` and `/api/notifications/unread-count/` about every 20 s per open tab (about 12,000 requests each in 14 days). It is harmless in bytes (about 2 KB per response) and CPU. If wanted, move to a 60 s interval or `visibilitychange` pausing. **No measurable saving**, so not recommended for cost.
- Scanner noise: `/.env`, `/.env.local`, `/api/graphql`, `/N.php` and similar get 404s. Roughly 10,000 of 74,532 requests are 404s. Negligible cost, but it shows the raw IP is exposed (see non-cost note below).

### #5 Background jobs, DB, Redis, OCR, WhatsApp: all light (no saving available)
FACTS
- Beat schedule (`Backend/config/celery.py`): one `ping_healthchecks` every 5 min, six jobs hourly (contract expiry, contract ratings, document-deletion reconcile, attachment cleanup, penalty auto-warnings, plus the leave settlement notice hourly 07-20), four daily jobs, and 2 BioTime syncs per day (09:00 and 22:00) plus absence detection at 10:00. The last 2 hours of worker logs show about 24 task runs, each finishing in 0.1-0.4 s (`ping_healthchecks` 24 runs, 4 s total). Redis queue length 0, Redis 1.8 MB, no backlog.
- Worker runs 3 Celery processes (about 140-160 MB each) with default concurrency. No OCR/PaddleOCR memory spike observed in logs or sar. It could be lowered with `--concurrency=1`, but the saving is only RAM that is not billed separately.
- Postgres: DB size 31 MB, 17 connections, largest table 3 MB. `pg_stat_statements` is **not enabled** (only `plpgsql` is installed), so heavy-query analysis was not possible. With these sizes it is not a cost concern.
- Idle extras: none. `evolution-api` plus its Postgres and Redis (about 320 MB RAM, near-zero CPU) are in use (`deliver_whatsapp_notification` ran in the sample). Cognee and the cinematic site are in the dev compose only, not in prod.
- Paid third parties, from env key names only: Sentry (`SENTRY_DSN` set, traces and profiles sample rates both `0.0`, so only errors are sent), Bird (email/WhatsApp, `BIRD_*`), Healthchecks.io ping (288 pings/day). No PostHog, TextBee or LLM key names exist in `.env.production`. Their invoices are separate from AWS and were not checked.

---

## 2. Summary table

| # | Driver | Evidence | Fix | Saving | Risk |
|---|---|---|---|---|---|
| 1 | t3.large oversized | CPU 2-5% avg, RAM 1.1-1.3 GB steady | t3.medium + 2 GB swap | 50% of the EC2 compute line (FACT: pricing scales by size) | Low-medium (build RAM spike) |
| 2 | 80 GB EBS, 25.9 GB stale build cache | `docker system df`, containerd 32 GB | prune cron to 7 days now; shrink volume only if wanted | $0 from pruning; small $ from shrinking | Low (prune), medium (shrink) |
| 3 | Elastic/public IPv4 | IP stable across stops | none practical | small, fixed | n/a |
| 4 | Egress | 318 MB / 14 days | none needed | about 0 | n/a |
| 5 | Jobs, DB, Redis | all idle | none | 0 | n/a |

## 3. Exact commands (NOT applied; each needs your approval first)

```bash
# #2 hygiene, run only while the box is up and after confirming nothing needs those images
docker builder prune -f --filter until=168h
docker image rm ffi-tenant-backend:de5267a34e9          # unused for 6 weeks

# #2 prune cron (replace the 45-day one), run on a working day, not Sunday 03:30
sudo sed -i 's#^30 3 \* \* 0#0 5 * * 1#; s#until=1080h#until=168h#' /etc/cron.d/prune-docker-build-cache /usr/local/sbin/prune-docker-build-cache  # review the diff first

# #2 log rotation (needs a docker restart in a deploy window)
sudo tee /etc/docker/daemon.json <<'EOF'
{"log-driver":"json-file","log-opts":{"max-size":"10m","max-file":"3"}}
EOF
sudo sed -i 's/^#\?SystemMaxUse=.*/SystemMaxUse=200M/' /etc/systemd/journald.conf   # then restart systemd-journald

# #1 right-size (AWS console or CLI, during the stopped window; keeps the Elastic IP)
aws ec2 stop-instances --instance-ids <id>
aws ec2 modify-instance-attribute --instance-id <id> --instance-type "{\"Value\":\"t3.medium\"}"
aws ec2 start-instances --instance-ids <id>
# plus a 2 GB swap file for build spikes
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 4. What I could not verify

- **Real AWS costs.** The AWS CLI is installed locally (2.34.21) but has no credentials (`NoCredentials`). I did not log in or create credentials. Please open Billing and Cost Management, then **Cost Explorer**, time range last 60 days, granularity Monthly then Daily, **Group by Service**. Then re-run with **Group by Usage Type** filtered to EC2-Instances, EC2-Other and VPC, and paste both. Things to read there:
  - `EC2-Instances` `BoxUsage:t3.large` hours (confirms the schedule saving).
  - `EC2-Other`: `EBS:VolumeUsage.gp3` (or gp2, the volume type is not visible from the host), `EBS:SnapshotUsage`, `DataTransfer-Out-Bytes`, and `ElasticIP:IdleAddress`.
  - `VPC`: `PublicIPv4:InUseAddress` / `IdleAddress`.
  - Anything outside EC2 (CloudWatch, S3, Route 53, Backup, Support plan).
  - Also check **Support plan** and **Tax**, which sometimes dominate small bills.
- Other EBS volumes, snapshots, AMIs and unattached Elastic IPs in the account (a host cannot list them). Only one volume is attached to this instance.
- Who stops and starts the instance (CloudTrail `StopInstances`), and the exact weekly schedule. Whether a Sunday 03:30 prune ever runs.
- CloudWatch CPU-credit balance and any unlimited-mode surcharge; CloudWatch agent / alarms / log groups (nothing seen running on the host).
- EBS volume type and IOPS/throughput settings.
- Whether any other AWS resources exist in the account (other regions, RDS, S3, NAT gateway, load balancers).
- Heavy SQL queries (no `pg_stat_statements`); real OCR memory behaviour under an actual upload; Sentry event volume and Bird / Healthchecks.io billing (outside AWS).
- Cloudflare plan and cache hit rate (only inferred from log source IPs).

## 5. Non-cost observations (for your attention)
- Ports 8000 (backend), 8080 (frontend) and 8081 (evolution-api) are bound on `0.0.0.0` on the host. Whether they are reachable from the internet depends on the security group, which I cannot see. Scanners are already requesting `http://13.51.209.116/.env`. Worth confirming the security group allows only 22/80/443, and binding the container ports to `127.0.0.1:` in `docker-compose.prod.yml`.
- DB backups exist only on this same disk (`/home/ubuntu/backups`, the last two from Oct 6, plus two from August). Nothing off-host or scheduled was found (no crontab). An EBS snapshot schedule or S3 copy would be cheap insurance.
