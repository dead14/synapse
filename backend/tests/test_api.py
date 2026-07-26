
import json
import urllib.request

with open("test_data_full.json", "r") as f:
    config = json.load(f)

payload = {
    "oldRun": config["oldRun"],
    "newRun": config["newRun"]
}

req = urllib.request.Request("http://localhost:5000/api/alignment/estimate-tiein-offset")
req.add_header("Content-Type", "application/json")

try:
    response = urllib.request.urlopen(req, json.dumps(payload).encode("utf-8"))
    print("API RESPONSE:", response.read().decode("utf-8"))
except Exception as e:
    print("API ERROR:", e)

