import requests
import sys
import uuid
import datetime
import random

BASE_URL = "http://127.0.0.1:8000"
EMAIL = "ahmed@ffi.sa"
PASSWORD = "omar1234"

# Entitiy Endpoints
AUTH_URL = f"{BASE_URL}/auth/login"
DEPTS_URL = f"{BASE_URL}/api/hr/departments/"
POSITIONS_URL = f"{BASE_URL}/api/hr/positions/"
TASK_GROUPS_URL = f"{BASE_URL}/api/hr/task-groups/"
SPONSORS_URL = f"{BASE_URL}/api/hr/sponsors/"
EMPLOYEES_URL = f"{BASE_URL}/employees"  # Note: No /api/hr prefix, no trailing slash based on employeesApi.ts

GREEN = "\033[92m"
RED = "\033[91m"
RESET = "\033[0m"


class ApiVerifier:
    def __init__(self):
        self.session = requests.Session()
        self.token = None
        self.headers = {"Content-Type": "application/json"}
        self.errors = []
        self.created_ids = {}

    def log(self, message, success=True):
        color = GREEN if success else RED
        status = "[PASS]" if success else "[FAIL]"
        print(f"{color}{status} {message}{RESET}")
        if not success:
            self.errors.append(message)

    def login(self):
        print(f"\n--- 1. Authentication ({AUTH_URL}) ---")
        try:
            payload = {"email": EMAIL, "password": PASSWORD}
            resp = self.session.post(AUTH_URL, json=payload, headers=self.headers)

            if resp.status_code == 200:
                data = resp.json()
                if data.get("status") == "success" and "token" in data.get("data", {}):
                    self.token = data["data"]["token"]
                    self.headers["Authorization"] = f"Bearer {self.token}"
                    self.log("Login Successful")
                else:
                    self.log(f"Login Response format invalid: {data}", False)
            else:
                self.log(f"Login Failed with {resp.status_code}: {resp.text}", False)
                sys.exit(1)
        except Exception as e:
            self.log(f"Login Exception: {e}", False)
            sys.exit(1)

    def test_crud(self, name, url, payload_factory, id_field="id"):
        print(f"\n--- Testing {name} ({url}) ---")

        # 1. Create
        item_data = payload_factory()
        resp = self.session.post(url, json=item_data, headers=self.headers)
        if resp.status_code in [200, 201]:
            data = resp.json()
            if data.get("status") == "success":
                created_item = data.get("data")
                item_id = created_item.get(id_field)
                self.created_ids[name] = item_id
                self.log(f"Create {name}: ID {item_id}")
            else:
                self.log(f"Create {name} failed logic: {data}", False)
                return
        else:
            self.log(f"Create {name} failed HTTP {resp.status_code}: {resp.text}", False)
            return

        # 2. List
        resp = self.session.get(url, headers=self.headers)
        if resp.status_code == 200:
            data = resp.json()
            if data.get("status") == "success":
                items = data.get("data")
                # Handle pagination wrapper if present
                if isinstance(items, dict) and "results" in items:
                    items = items["results"]

                # Verify created item is in list
                found = any(str(i.get(id_field)) == str(self.created_ids[name]) for i in items)
                self.log(f"List {name} contains new item: {found}", found)
            else:
                self.log(f"List {name} failed logic: {data}", False)
        else:
            self.log(f"List {name} failed HTTP {resp.status_code}: {resp.text}", False)

    def run(self):
        self.login()

        # Generate unique code suffix
        uid = str(uuid.uuid4())[:8]

        # Reference Data Tests
        self.test_crud(
            "Department",
            DEPTS_URL,
            lambda: {"name": f"QA Dept {uid}", "code": f"QAD-{uid}", "description": "Automated Test"},
        )

        self.test_crud(
            "Position",
            POSITIONS_URL,
            lambda: {"name": f"QA Pos {uid}", "code": f"QAP-{uid}", "description": "Automated Test"},
        )

        self.test_crud(
            "TaskGroup",
            TASK_GROUPS_URL,
            lambda: {"name": f"QA Group {uid}", "code": f"QAG-{uid}", "description": "Automated Test"},
        )

        self.test_crud(
            "Sponsor",
            SPONSORS_URL,
            lambda: {"code": f"SP-{uid}", "name": f"QA Sponsor {uid}", "description": "Automated Test"},
        )

        # Employee Test
        # Need IDs for FKs
        dept_id = self.created_ids.get("Department")
        pos_id = self.created_ids.get("Position")

        if dept_id and pos_id:
            print(f"\n--- Testing Employee ({EMPLOYEES_URL}) ---")
            emp_payload = {
                "full_name": f"QA Employee {uid}",
                "email": f"qa.{uid}@ffi.sa",
                "employee_number": f"EMP{uid}",
                "department_id": dept_id,
                "position_id": pos_id,
                "nationality": "Saudi",
                "passport_no": f"P{uid}",
                "join_date": "2025-01-01",
                "basic_salary": 5000,
                "transportation_allowance": 500,
            }

            resp = self.session.post(EMPLOYEES_URL, json=emp_payload, headers=self.headers)
            if resp.status_code in [200, 201]:
                data = resp.json()
                if data.get("status") == "success":
                    self.log("Create Employee Success")
                else:
                    self.log(f"Create Employee Logic Fail: {data}", False)
            else:
                self.log(f"Create Employee HTTP Fail {resp.status_code}: {resp.text}", False)

        if self.errors:
            print(f"\n{RED}VERIFICATION FAILED WITH {len(self.errors)} ERRORS{RESET}")
            sys.exit(1)
        else:
            print(f"\n{GREEN}ALL CHECKS PASSED{RESET}")


if __name__ == "__main__":
    verifier = ApiVerifier()
    verifier.run()
