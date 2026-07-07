import pandas as pd
import numpy as np
from fastdtw import fastdtw
from scipy.spatial.distance import euclidean
from models import SessionLocal, ILIFeature, ILIAlignmentResult

class DatabasePipelineAlignmentEngine:
    def __init__(self, run_1_year: int, run_2_year: int, distance_tolerance_m: float = 0.5):
        self.run_1_year = run_1_year
        self.run_2_year = run_2_year
        self.distance_tolerance_m = distance_tolerance_m
        
        self.session = SessionLocal()

    def fetch_data(self, year: int):
        # Fetch only defects (like Metal Loss) for alignment, ignoring general joints/valves for now
        # Actually, let's fetch everything that has a depth_pct (anomalies) or weld to act as markers
        # For true alignment, we usually align welds, then interpolate defects.
        # But here we'll do a simple DTW on absolute distances of all features
        
        query = self.session.query(ILIFeature).filter(ILIFeature.survey_year == year).order_by(ILIFeature.abs_distance_m)
        df = pd.read_sql(query.statement, self.session.bind)
        return df

    def perform_alignment(self):
        print(f"Fetching data for {self.run_1_year} and {self.run_2_year}...")
        df1 = self.fetch_data(self.run_1_year)
        df2 = self.fetch_data(self.run_2_year)
        
        if df1.empty or df2.empty:
            print("One of the datasets is empty!")
            return None
            
        print(f"Run 1 ({self.run_1_year}) features: {len(df1)}")
        print(f"Run 2 ({self.run_2_year}) features: {len(df2)}")

        # For DTW, we'll use the absolute distance as the primary alignment key
        # Extract the distance arrays
        dist1 = df1['abs_distance_m'].values.reshape(-1, 1)
        dist2 = df2['abs_distance_m'].values.reshape(-1, 1)

        print("Running DTW...")
        distance, path = fastdtw(dist1, dist2, dist=euclidean)
        print(f"DTW Distance: {distance}")

        # Path is a list of tuples: (index_in_run1, index_in_run2)
        # We need to process this path to find matches, new anomalies, and missing anomalies
        
        # A naive approach to filter the DTW path:
        # If the absolute difference in their raw distances is within tolerance, we call it a match
        
        results = []
        matched_run1_indices = set()
        matched_run2_indices = set()
        
        for idx1, idx2 in path:
            feature1 = df1.iloc[idx1]
            feature2 = df2.iloc[idx2]
            
            # Calculate physical distance difference
            diff = abs(feature1['abs_distance_m'] - feature2['abs_distance_m'])
            
            if diff <= self.distance_tolerance_m:
                # Check if it's an anomaly match (both have depth)
                is_anomaly_1 = pd.notna(feature1['depth_pct'])
                is_anomaly_2 = pd.notna(feature2['depth_pct'])
                
                # Only log matches if they are actually anomalies (or if we want to log all features)
                # Let's log if at least one is an anomaly
                if is_anomaly_1 or is_anomaly_2:
                    if idx1 not in matched_run1_indices and idx2 not in matched_run2_indices:
                        matched_run1_indices.add(idx1)
                        matched_run2_indices.add(idx2)
                        
                        growth = 0.0
                        if is_anomaly_1 and is_anomaly_2:
                            growth = float(feature2['depth_pct'] - feature1['depth_pct'])
                            
                        results.append(ILIAlignmentResult(
                            run1_feature_id=int(feature1['id']),
                            run2_feature_id=int(feature2['id']),
                            match_status='Matched',
                            growth_depth_pct=growth,
                            growth_length_mm=float(feature2['length_mm'] - feature1['length_mm']) if pd.notna(feature1['length_mm']) and pd.notna(feature2['length_mm']) else None,
                            growth_width_mm=float(feature2['width_mm'] - feature1['width_mm']) if pd.notna(feature1['width_mm']) and pd.notna(feature2['width_mm']) else None,
                        ))
        
        # Now find New features in Run 2 (Anomalies)
        for idx2, feature2 in df2.iterrows():
            if idx2 not in matched_run2_indices and pd.notna(feature2['depth_pct']):
                results.append(ILIAlignmentResult(
                    run1_feature_id=None,
                    run2_feature_id=int(feature2['id']),
                    match_status='New in Run 2',
                    growth_depth_pct=None,
                    growth_length_mm=None,
                    growth_width_mm=None
                ))
                
        # Now find Missing features from Run 1
        for idx1, feature1 in df1.iterrows():
            if idx1 not in matched_run1_indices and pd.notna(feature1['depth_pct']):
                results.append(ILIAlignmentResult(
                    run1_feature_id=int(feature1['id']),
                    run2_feature_id=None,
                    match_status='Missing in Run 2',
                    growth_depth_pct=None,
                    growth_length_mm=None,
                    growth_width_mm=None
                ))

        print(f"Saving {len(results)} alignment results to database...")
        # Clear old results
        self.session.query(ILIAlignmentResult).delete()
        self.session.bulk_save_objects(results)
        self.session.commit()
        print("Alignment Complete and Saved!")

if __name__ == "__main__":
    engine = DatabasePipelineAlignmentEngine(run_1_year=2020, run_2_year=2025, distance_tolerance_m=0.5)
    engine.perform_alignment()
