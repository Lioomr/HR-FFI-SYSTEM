import logging
import requests
from urllib.parse import urljoin

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

    def authenticate(self):
        """
        Authenticate with the BioTime API and obtain a JWT token.
        """
        url = urljoin(self.base_url, "/jwt-api-token-auth/")
        try:
            response = requests.post(url, json={
                "username": self.username,
                "password": self.password
            }, timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                self.token = data.get("token")
                return True
            else:
                logger.error(f"BioTime Authentication failed: {response.text}")
                return False
        except Exception as e:
            logger.error(f"Error connecting to BioTime server: {e}")
            return False

    def get_headers(self):
        if not self.token:
            self.authenticate()
            
        return {
            "Content-Type": "application/json",
            "Authorization": f"JWT {self.token}" if self.token else ""
        }

    def test_connection(self):
        """
        Test if the credentials and server address are correct.
        """
        return self.authenticate()

    def get_transactions(self, start_time=None, end_time=None):
        """
        Fetch attendance transactions. 
        start_time and end_time should be strings in format 'YYYY-MM-DD HH:MM:SS'
        """
        if not self.token and not self.authenticate():
            return []

        url = urljoin(self.base_url, "/iclock/api/transactions/")
        params = {}
        if start_time:
            params["start_time"] = start_time
        if end_time:
            params["end_time"] = end_time
            
        transactions = []
        page = 1
        
        while True:
            params["page"] = page
            try:
                response = requests.get(url, headers=self.get_headers(), params=params, timeout=15)
                if response.status_code == 200:
                    data = response.json()
                    results = data.get("data", [])
                    if not results:
                        break
                        
                    transactions.extend(results)
                    
                    if data.get("next") is None:
                        break
                    page += 1
                else:
                    logger.error(f"Failed to fetch BioTime transactions: {response.text}")
                    break
            except Exception as e:
                logger.error(f"Error fetching BioTime transactions: {e}")
                break
                
        return transactions

    def get_employees(self):
        """
        Fetch all employees configured in the BioTime device to help with mapping.
        """
        if not self.token and not self.authenticate():
            return []

        url = urljoin(self.base_url, "/personnel/api/employees/")
        employees = []
        page = 1
        params = {}
        
        while True:
            params["page"] = page
            try:
                response = requests.get(url, headers=self.get_headers(), params=params, timeout=15)
                if response.status_code == 200:
                    data = response.json()
                    results = data.get("data", [])
                    if not results:
                        break
                        
                    employees.extend(results)
                    
                    if data.get("next") is None:
                        break
                    page += 1
                else:
                    logger.error(f"Failed to fetch BioTime employees: {response.text}")
                    break
            except Exception as e:
                logger.error(f"Error fetching BioTime employees: {e}")
                break
                
        return employees
