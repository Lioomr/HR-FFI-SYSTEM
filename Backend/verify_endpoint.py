import requests
import json

base_url = "http://127.0.0.1:8000"
# Url that was failing (corrected prefix)
url = f"{base_url}/api/leaves/leave-balances/?employee_id=1&year=2026"

# Correct login URL
login_url = f"{base_url}/auth/login"
try:
    print(f"Logging in to {login_url}...")
    auth_resp = requests.post(login_url, json={"email": "testuser@example.com", "password": "password123"})
    if auth_resp.status_code == 200:
        print("Login success. Response:")
        print(json.dumps(auth_resp.json(), indent=2))
        
        # Try to extract token based on print output manually or generic guess
        data = auth_resp.json().get('data', {})
        token = data.get('access') or data.get('token') or data.get('accessToken')
        
        if token:
            headers = {"Authorization": f"Bearer {token}"}
            print("Logged in successfully.")
            
            # Now try the endpoint
            print(f"Requesting {url}...")
            resp = requests.get(url, headers=headers)
            print(f"GET {url} -> Status: {resp.status_code}")
            try:
                print(json.dumps(resp.json(), indent=2))
            except:
                print(resp.text)
        else:
             print("Could not find token in response.")
    else:
        print(f"Login failed: {auth_resp.status_code} {auth_resp.text}")

except Exception as e:
    print(f"Error: {e}")
