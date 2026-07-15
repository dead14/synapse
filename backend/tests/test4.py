
import json
import numpy as np

with open("test_data.json", "r") as f:
    data = json.load(f)

old_gws = np.array(data["oldGws"])
new_gws = np.array(data["newGws"])

old_spools = np.diff(old_gws)
new_spools = np.diff(new_gws)

sig = new_spools[140:160]
print("new_gws[140]:", new_gws[140])
print("True old_gw point should be:", 1641.9 + new_gws[140])

idx_true = np.argmin(np.abs(old_gws - (1641.9 + new_gws[140])))
print("Old gw dist at true match:", old_gws[idx_true])
print("SAD at true match:", np.sum(np.abs(old_spools[idx_true : idx_true+20] - sig)))

