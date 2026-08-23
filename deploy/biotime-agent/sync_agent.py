"""Outbound BioTime-to-AWS sync agent for an office-network machine."""

import os
import sys
from datetime import datetime, timedelta
from urllib.parse import urljoin

import requests


def required(name):
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required setting: {name}")
    return value


def fetch_transactions(host, port, username, password, days):
    base_url = f"http://{host}:{port}"
    session = requests.Session()
    auth = session.post(
        urljoin(base_url, "/api-token-auth/"),
        json={"username": username, "password": password},
        timeout=15,
    )
    auth.raise_for_status()
    token = auth.json().get("token")
    if not token:
        raise RuntimeError("BioTime authentication response did not contain a token")

    start = datetime.now() - timedelta(days=days)
    end = datetime.now() + timedelta(minutes=1)
    items = []
    page = 1
    while True:
        response = session.get(
            urljoin(base_url, "/iclock/api/transactions/"),
            headers={"Accept": "application/json", "Authorization": f"Token {token}"},
            params={
                "start_time": start.strftime("%Y-%m-%d 00:00:00"),
                "end_time": end.strftime("%Y-%m-%d 23:59:59"),
                "page_size": 100,
                "page": page,
            },
            timeout=30,
        )
        response.raise_for_status()
        payload = response.json()
        batch = payload.get("data") or payload.get("results") or []
        items.extend(batch)
        if not payload.get("next") or not batch:
            return items
        page += 1


def main():
    transactions = fetch_transactions(
        required("BIOTIME_HOST"),
        os.getenv("BIOTIME_PORT", "80"),
        required("BIOTIME_USERNAME"),
        required("BIOTIME_PASSWORD"),
        max(int(os.getenv("SYNC_DAYS", "2")), 1),
    )
    response = requests.post(
        required("AWS_INGEST_URL"),
        headers={"X-BioTime-Agent-Token": required("BIOTIME_AGENT_TOKEN")},
        json={"transactions": transactions},
        timeout=60,
    )
    response.raise_for_status()
    print(response.text)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, requests.RequestException, RuntimeError) as exc:
        print(f"BioTime sync failed: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
