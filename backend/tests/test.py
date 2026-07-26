
import json
import numpy as np

with open("test_data.json", "r") as f:
    data = json.load(f)

old_gws = data["oldGws"]
new_gws = data["newGws"]

old_spools = [old_gws[i] - old_gws[i-1] for i in range(1, len(old_gws))]
new_spools = [new_gws[i] - new_gws[i-1] for i in range(1, len(new_gws))]

actual_window_size = 30
target = np.array(old_spools)

global_best_sad = float("inf")
global_best_target_idx = 0
global_best_sig_idx = 0

step = 1
for sig_start in range(0, len(new_spools) - actual_window_size + 1, step):
    signature = np.array(new_spools[sig_start : sig_start + actual_window_size])
    
    for i in range(len(target) - len(signature) + 1):
        window = target[i : i + len(signature)]
        sad = np.sum(np.abs(window - signature))
        if sad < global_best_sad:
            global_best_sad = sad
            global_best_target_idx = i
            global_best_sig_idx = sig_start

estimated_offset = old_gws[global_best_target_idx] - new_gws[global_best_sig_idx]
avg_sad = global_best_sad / actual_window_size

print(f"Best Target Idx: {global_best_target_idx}")
print(f"Best Sig Idx: {global_best_sig_idx}")
print(f"Estimated Offset: {estimated_offset}")
print(f"Avg SAD: {avg_sad}")

