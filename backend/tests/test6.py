
import json
import numpy as np

with open("test_data.json", "r") as f:
    data = json.load(f)

old_gws = np.array(data["oldGws"])
new_gws = np.array(data["newGws"])

idx18_new = np.argmin(np.abs(new_gws - 18.1))
idx1660_old = np.argmin(np.abs(old_gws - 1660))

print("New GW near 18.1:", new_gws[idx18_new])
print("Old GW near 1660:", old_gws[idx1660_old])
print("Calculated offset from these two points:", old_gws[idx1660_old] - new_gws[idx18_new])

print("Old spools near 1660:")
old_spools = np.diff(old_gws)
print(old_spools[idx1660_old:idx1660_old+10])

print("New spools near 18.1:")
new_spools = np.diff(new_gws)
print(new_spools[idx18_new:idx18_new+10])

