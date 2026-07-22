import pandas as pd
import numpy as np

def generate_ili_data(year, base_weld_distances, base_anomalies):
    rows = []
    shift_weld = (year - 2022) * 0.05
    for i, w_dist in enumerate(base_weld_distances):
        d = w_dist + (np.random.uniform(-shift_weld, shift_weld) if year != 2022 else 0)
        rows.append({
            'feature_id': f"W_{year}_{i+1}", 'log_distance_m': round(d, 3), 'joint_number': i + 1,
            'dist_to_us_gw_m': 0.0, 'joint_length_m': 12.0, 'feature_type': 'Weld',
            'feature_identification': 'Girth Weld', 'dim_classification': '', 'clock_position': '',
            'wall_thickness_mm': 12.7, 'length_mm': np.nan, 'width_mm': np.nan,
            'depth_pct': np.nan, 'surface_location': '', 'erf_asme': np.nan, 'psafe_bar': np.nan, 'comment': ''
        })
    for anom in base_anomalies:
        growth = (year - 2022) * np.random.uniform(0.5, 2.0)
        depth = min(anom['base_depth'] + growth, 99.0)
        d = anom['base_dist'] + (np.random.uniform(-shift_weld, shift_weld) if year != 2022 else 0)
        us_weld_dist = max([w for w in base_weld_distances if w <= anom['base_dist']] + [0])
        dist_gw = d - us_weld_dist
        rows.append({
            'feature_id': f"ML_{year}_{anom['id']}", 'log_distance_m': round(d, 3),
            'joint_number': int(anom['base_dist'] // 12) + 1, 'dist_to_us_gw_m': round(dist_gw, 3),
            'joint_length_m': 12.0, 'feature_type': 'Metal Loss', 'feature_identification': 'Corrosion',
            'dim_classification': 'Pitting', 'clock_position': anom['clock'], 'wall_thickness_mm': 12.7,
            'length_mm': round(anom['length'] + (year-2022)*2, 1), 'width_mm': round(anom['width'] + (year-2022)*1, 1),
            'depth_pct': round(depth, 1), 'surface_location': 'External' if np.random.rand() > 0.3 else 'Internal',
            'erf_asme': round(np.random.uniform(0.5, 0.9), 2), 'psafe_bar': round(np.random.uniform(50, 100), 1),
            'comment': 'Generated'
        })
    df = pd.DataFrame(rows)
    df = df.sort_values('log_distance_m').reset_index(drop=True)
    return df

def main():
    np.random.seed(42)
    weld_distances = np.arange(0, 1200 + 12, 12)
    anomalies = []
    for i in range(1, 31):
        dist = np.random.uniform(5, 1195)
        while any(abs(dist - w) < 0.5 for w in weld_distances):
            dist = np.random.uniform(5, 1195)
        anomalies.append({
            'id': i, 'base_dist': dist, 'base_depth': np.random.uniform(10, 40),
            'length': np.random.uniform(20, 100), 'width': np.random.uniform(20, 80),
            'clock': f"{np.random.randint(1, 12)}:{np.random.randint(0, 59):02d}"
        })
    df_2022 = generate_ili_data(2022, weld_distances, anomalies)
    df_2024 = generate_ili_data(2024, weld_distances, anomalies)
    df_2026 = generate_ili_data(2026, weld_distances, anomalies)
    new_anomalies_2026 = []
    for i in range(31, 36):
        dist = np.random.uniform(5, 1195)
        new_anomalies_2026.append({
            'id': i, 'base_dist': dist, 'base_depth': np.random.uniform(10, 15),
            'length': np.random.uniform(10, 30), 'width': np.random.uniform(10, 30),
            'clock': f"{np.random.randint(1, 12)}:{np.random.randint(0, 59):02d}"
        })
    df_2026_extra = generate_ili_data(2026, [], new_anomalies_2026)
    df_2026 = pd.concat([df_2026, df_2026_extra]).sort_values('log_distance_m').reset_index(drop=True)
    
    df_2022.to_excel('Simulasi_ILI_2022.xlsx', index=False)
    df_2024.to_excel('Simulasi_ILI_2024.xlsx', index=False)
    df_2026.to_excel('Simulasi_ILI_2026.xlsx', index=False)
    print("Files created successfully.")

if __name__ == "__main__":
    main()
