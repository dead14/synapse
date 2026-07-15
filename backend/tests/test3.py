
import json
from tiein_engine import calculate_tiein_offset

with open("test_data.json", "r") as f:
    data = json.load(f)

old = [{"type":"weld", "dist": d} for d in data["oldGws"]]
new = [{"type":"weld", "dist": d} for d in data["newGws"]]

res = calculate_tiein_offset(old, new)
print(json.dumps(res, indent=2))

