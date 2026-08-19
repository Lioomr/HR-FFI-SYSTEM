import logging
from urllib.parse import urljoin

import requests

logger = logging.getLogger(__name__)


class BioTimeClient:
    """Small, defensive client for the documented BioTime 8.5 Open API."""

    def __init__(self, server_ip, server_port, username, password):
        self.server_ip = server_ip
        self.server_port = server_port
        self.username = username
        self.password = password
        self.token = None
        self.auth_scheme = "Token"
        self.last_error = ""
        self.base_url = f"http://{self.server_ip}:{self.server_port}"
        self.session = requests.Session()

    def authenticate(self):
        """Authenticate using BioTime 8.5's DRF token endpoint."""
        self.last_error = ""
        try:
            response = self.session.post(
                urljoin(self.base_url, "/api-token-auth/"),
                json={"username": self.username, "password": self.password},
                timeout=10,
            )
            if response.status_code != 200:
                self.last_error = f"HTTP {response.status_code}"
                logger.warning("BioTime Token authentication failed: HTTP %s", response.status_code)
                return False

            token = response.json().get("token")
            if not token:
                self.last_error = "Authentication response did not contain a token."
                logger.warning("BioTime Token authentication response did not contain a token.")
                return False

            self.token = token
            self.auth_scheme = "Token"
            return True
        except (requests.RequestException, ValueError) as exc:
            self.last_error = str(exc)
            logger.error("Error connecting to BioTime server: %s", exc)
            return False

    def get_headers(self):
        if not self.token and not self.authenticate():
            return None
        return {"Accept": "application/json", "Authorization": f"Token {self.token}"}

    def test_connection(self):
        return self.authenticate()

    @staticmethod
    def _extract_results(payload):
        if not isinstance(payload, dict):
            return []
        for key in ("data", "results"):
            if isinstance(payload.get(key), list):
                return payload[key]
        return []

    def _paginate(self, endpoints, params=None):
        if not self.token and not self.authenticate():
            return None

        params = {**(params or {}), "page_size": 100}
        for endpoint in endpoints:
            url = urljoin(self.base_url, endpoint)
            items = []
            page = 1
            endpoint_succeeded = False

            while True:
                try:
                    response = self.session.get(
                        url,
                        headers=self.get_headers(),
                        params={**params, "page": page},
                        timeout=15,
                    )
                    if response.status_code != 200:
                        self.last_error = f"{endpoint}: HTTP {response.status_code}"
                        logger.warning("BioTime request failed for %s: HTTP %s", endpoint, response.status_code)
                        break

                    payload = response.json()
                    endpoint_succeeded = True
                    results = self._extract_results(payload)
                    items.extend(results)
                    if not payload.get("next") or not results:
                        return items
                    page += 1
                except (requests.RequestException, ValueError) as exc:
                    self.last_error = f"{endpoint}: {exc}"
                    logger.error("Error fetching BioTime data from %s: %s", endpoint, exc)
                    break

            if endpoint_succeeded:
                return items
        return None

    def get_transactions(self, start_time=None, end_time=None):
        params = {}
        if start_time:
            params["start_time"] = start_time
        if end_time:
            params["end_time"] = end_time
        return self._paginate(["/iclock/api/transactions/"], params=params)

    def get_employees(self):
        return self._paginate(["/personnel/api/employees/", "/personnel/api/employee/"])
