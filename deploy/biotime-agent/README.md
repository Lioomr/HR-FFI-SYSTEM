# Office BioTime sync agent

This agent runs on a machine inside the office network. It reads BioTime locally and sends attendance transactions outbound over HTTPS to AWS. It does not open any inbound port.

Set these environment variables before running:

```text
BIOTIME_HOST=192.168.1.250
BIOTIME_PORT=80
BIOTIME_USERNAME=admin
BIOTIME_PASSWORD=replace-me
AWS_INGEST_URL=https://api.asecopro.com/api/biotime/agent/ingest/
BIOTIME_AGENT_TOKEN=replace-with-the-same-random-token-configured-in-AWS
SYNC_DAYS=2
```

Install and run:

```powershell
py -m pip install -r requirements.txt
py sync_agent.py
```

Run it every 15 minutes with Windows Task Scheduler. Store the token and BioTime password in the machine's environment or a protected service configuration; never commit them.
