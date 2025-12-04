import requests
import time
import threading

BASE_URL = "http://127.0.0.1:5001"

def test_api():
    print("Testing /api/scan/start...")
    try:
        r = requests.post(f"{BASE_URL}/api/scan/start")
        print(f"Start Status: {r.status_code}, {r.json()}")
    except Exception as e:
        print(f"Failed to connect: {e}")
        return

    time.sleep(2)

    print("Testing /api/scan...")
    r = requests.get(f"{BASE_URL}/api/scan")
    data = r.json()
    print(f"Scan Data: is_scanning={data.get('is_scanning')}, devices={len(data.get('devices'))}")

    time.sleep(2)

    print("Testing /api/scan/stop...")
    r = requests.post(f"{BASE_URL}/api/scan/stop")
    print(f"Stop Status: {r.status_code}, {r.json()}")

    time.sleep(1)
    
    print("Testing /api/scan (should be stopped)...")
    r = requests.get(f"{BASE_URL}/api/scan")
    data = r.json()
    print(f"Scan Data: is_scanning={data.get('is_scanning')}")

if __name__ == "__main__":
    test_api()
