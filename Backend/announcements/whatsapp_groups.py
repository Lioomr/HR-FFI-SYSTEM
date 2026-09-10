"""Announcement-only Evolution group transport. Never use the E.164 user sender."""

import hashlib
import json
import logging
import re
from urllib.parse import quote

import requests
from django.conf import settings

from core.services.messaging_providers import EvolutionWhatsAppProvider

logger = logging.getLogger(__name__)
_GROUP_JID = re.compile(r"^[0-9]+(?:-[0-9]+)?@g\.us$")


def configured_groups(company):
    if company is None:
        return {}
    configuration = getattr(settings, "ANNOUNCEMENT_WHATSAPP_GROUP_ALLOWLIST", {})
    try:
        if isinstance(configuration, str):
            configuration = json.loads(configuration)
    except (TypeError, ValueError):
        return {}
    if not isinstance(configuration, dict):
        return {}
    entries = configuration.get(company.code, [])
    if not isinstance(entries, list):
        return {}
    provider = EvolutionWhatsAppProvider()
    groups = {}
    for entry in entries:
        if not isinstance(entry, dict) or not isinstance(entry.get("jid"), str):
            continue
        jid = entry["jid"]
        if not _GROUP_JID.fullmatch(jid):
            continue
        identity = json.dumps([company.pk, provider.api_base_url, provider.instance_name, jid])
        group_id = hashlib.sha256(identity.encode()).hexdigest()
        # Use an administrator-provided label, never provider subjects, participant data or JIDs.
        label = str(entry.get("label") or "WhatsApp group")[:120]
        label = re.sub(r"\+?\d[\d ()-]{7,}\d", "[redacted]", label)
        label = re.sub(r"[\r\n\t]", " ", label)
        groups[group_id] = {"jid": jid, "name": label}
    return groups


class AnnouncementGroupProvider:
    def __init__(self):
        self.provider = EvolutionWhatsAppProvider()

    def _request(self, method, path, **kwargs):
        provider = self.provider
        return requests.request(
            method,
            f"{provider.api_base_url}/{path}/{quote(provider.instance_name, safe='')}",
            headers={"apikey": provider.api_key, "Content-Type": "application/json"},
            timeout=min(provider.timeout_seconds, 10),
            allow_redirects=False,
            **kwargs,
        )

    def connected_group_jids(self):
        if not getattr(settings, "NOTIFICATION_WHATSAPP_DELIVERY_ENABLED", True):
            return "disabled", set()
        if not self.provider.is_configured():
            return "not_configured", set()
        try:
            response = self._request("GET", "instance/connectionState")
            if not 200 <= response.status_code < 300:
                return "unavailable", set()
            data = response.json()
            instance = data.get("instance", data) if isinstance(data, dict) else {}
            if not isinstance(instance, dict) or instance.get("state") not in {"open", "connected"}:
                return "disconnected", set()
            response = self._request("GET", "group/fetchAllGroups", params={"getParticipants": "false"})
            if not 200 <= response.status_code < 300:
                return "unavailable", set()
            data = response.json()
            if not isinstance(data, list):
                return "unavailable", set()
            return "connected", {
                row["id"]
                for row in data
                if isinstance(row, dict) and isinstance(row.get("id"), str) and _GROUP_JID.fullmatch(row["id"])
            }
        except (requests.RequestException, ValueError, TypeError):
            # Never log exception text, response bodies, instance names, keys or JIDs.
            return "unavailable", set()

    def send_group(self, *, company, group_id, text):
        group = configured_groups(company).get(group_id)
        if not group:
            return "SKIPPED", "group_not_allowed"
        state, jids = self.connected_group_jids()
        if state != "connected":
            return "SKIPPED", state
        if group["jid"] not in jids:
            return "SKIPPED", "group_missing"
        try:
            # Evolution's message endpoint sends to groups using an intact @g.us JID.
            # /group/* endpoints discover/manage groups; they do not send message text.
            response = self._request("POST", "message/sendText", json={"number": group["jid"], "text": text})
        except requests.RequestException:
            return "UNKNOWN", "provider_outcome_unknown"
        if 200 <= response.status_code < 300:
            return "SUBMITTED", ""
        return "FAILED", "provider_rejected"


def available_groups(company):
    configured = configured_groups(company)
    if not configured:
        return {"state": "not_configured", "groups": []}
    try:
        state, jids = AnnouncementGroupProvider().connected_group_jids()
    except Exception:
        state, jids = "unavailable", set()
    return {
        "state": state,
        "groups": [{"id": key, "name": group["name"]} for key, group in configured.items() if group["jid"] in jids],
    }
