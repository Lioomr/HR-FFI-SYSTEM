import logging
from urllib.parse import urljoin

import requests

logger = logging.getLogger(__name__)


class BioTimeClient:
    """
    Client for interacting with ZKTeco BioTime 8.5 API.
    """

    def __init__(self, server_ip, server_port, username, password):
        self.server_ip = server_ip
        self.server_port = server_port
        self.username = username
        self.password = password
        self.token = None
        self.base_url = f"http://{self.server_ip}:{self.server_port}"
        self.session = requests.Session()

    def authenticate(self):
        """
        Authenticate with the BioTime API and obtain a JWT token.
        """
        url = urljoin(self.base_url, "/jwt-api-token-auth/")
        try:
            response = self.session.post(
                url,
                json={
                    "username": self.username,
                    "password": self.password,
                },
                timeout=10,
            )

            if response.status_code == 200:
                data = response.json()
                self.token = data.get("token")
                return True

            logger.error("BioTime authentication failed: %s", response.text)
            return False
        except Exception as e:
            logger.error("Error connecting to BioTime server: %s", e)
            return False

    def get_headers(self):
        if not self.token:
            self.authenticate()

        return {
            "Content-Type": "application/json",
            "Authorization": f"JWT {self.token}" if self.token else "",
        }

    def test_connection(self):
        """
        Test if the credentials and server address are correct.
        """
        return self.authenticate()

    def _extract_results(self, data):
        if isinstance(data.get("data"), list):
            return data["data"]
        if isinstance(data.get("results"), list):
            return data["results"]
        return []

    def _paginate(self, endpoints, params=None):
        if not self.token and not self.authenticate():
            return []

        params = params.copy() if params else {}
        params.setdefault("page_size", 100)

        for endpoint in endpoints:
            url = urljoin(self.base_url, endpoint)
            items = []
            page = 1

            while True:
                request_params = {**params, "page": page}
                try:
                    response = self.session.get(url, headers=self.get_headers(), params=request_params, timeout=15)
                    if response.status_code != 200:
                        logger.error("BioTime request failed for %s: %s", endpoint, response.text)
                        items = []
                        break

                    payload = response.json()
                    results = self._extract_results(payload)
                    if not results:
                        break

                    items.extend(results)
                    if not payload.get("next"):
                        return items
                    page += 1
                except Exception as e:
                    logger.error("Error fetching BioTime data from %s: %s", endpoint, e)
                    items = []
                    break

            if items:
                return items

        return []

    def get_transactions(self, start_time=None, end_time=None):
        """
        Fetch attendance transactions.
        start_time and end_time should be strings in format 'YYYY-MM-DD HH:MM:SS'
        """
        params = {}
        if start_time:
            params["start_time"] = start_time
        if end_time:
            params["end_time"] = end_time

        return self._paginate(["/iclock/api/transactions/"], params=params)

    def get_employees(self):
        """
        Fetch all employees configured in the BioTime device to help with mapping.
        """
        return self._paginate(
            [
                "/personnel/api/employees/",
                "/personnel/api/employee/",
            ]
        )
