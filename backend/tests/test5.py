
import json
import numpy as np

with open("test_data.json", "r") as f:
    data = json.load(f)

old_gws = np.array(data["oldGws"])
new_gws = np.array(data["newGws"])

old_spools = np.diff(old_gws)
new_spools = np.diff(new_gws)

sig = new_spools[140:160]
print("Signature lengths:", sig)

