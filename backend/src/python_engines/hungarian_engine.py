import sys
import json
import pandas as pd
import numpy as np
import bisect
from scipy.optimize import linear_sum_assignment
from models import SessionLocal, ILIFeature, AlignmentResult, AlignmentSession

def safe_int(val):
    try:
        v = str(val).strip()
        if not v or v.lower() == 'none' or v.lower() == 'nan':
            return None
        return int(float(v))
    except:
        return None

class HungarianAnomalyAlignmentEngine:
    """
    Two-phase ILI alignment engine:
      Phase 1 — GW match (stored in AlignmentSession params_json)
      Phase 2 — Segment-based Hungarian algorithm for anomaly matching
      
      Anomalies are strictly matched within segments bounded by locked GWs.
    """

    INF_COST = 1e9

    def __init__(
        self,
        session_id: int,
        distance_tolerance_m: float = 0.5,
    ):
        self.session_id = session_id
        self.distance_tolerance_m = distance_tolerance_m
        self.clock_tolerance = 15.0
        self.us_gw_distance_tolerance = distance_tolerance_m
        self.ds_gw_distance_tolerance = distance_tolerance_m
        self.depth_tolerance = 50.0
        self.length_tolerance = 400.0
        self.max_total_cost = distance_tolerance_m + self.depth_tolerance
        self.session = SessionLocal()
        
        # Load run years from session config
        sess = self.session.query(AlignmentSession).filter(AlignmentSession.id == self.session_id).first()
        if sess and sess.params_json:
            self.run_1_year = int(sess.params_json.get("oldRun", {}).get("year", 2020))
            self.run_2_year = int(sess.params_json.get("newRun", {}).get("year", 2025))
        else:
            self.run_1_year = 2020
            self.run_2_year = 2025

    def _clock_to_deg(self, s):
        if s is None: return None
        try:
            p = str(s).split(":")
            h = int(p[0]) % 12
            m = int(p[1]) if len(p) > 1 else 0
            return h * 30 + m * 0.5
        except: return None

    def _clock_diff(self, cn, co):
        an = self._clock_to_deg(cn)
        ao = self._clock_to_deg(co)
        if an is None or ao is None: return None
        d = abs(an - ao)
        return min(d, 360 - d)

    def fetch_data(self, is_old_run: bool) -> list[dict]:
        try:
            sess = self.session.query(AlignmentSession).filter(AlignmentSession.id == self.session_id).first()
            if not sess or not sess.params_json:
                return []
            
            run_key = "oldRun" if is_old_run else "newRun"
            features = sess.params_json.get("summaryData", {}).get(run_key, {}).get("rawFeatures", [])
            
            # Apply tieInOffset globally to ALL NEW features to match DTW space
            tie_in_offset = float(sess.params_json.get("tieInOffset", 0.0))
            
            # Map them into the format expected by the engine (abs_distance_m, id, depth_pct, length_mm, width_mm)
            mapped = []
            for f in features:
                # Need to handle string " " and None gracefully
                try:
                    abs_dist = float(f.get("log_distance_m") or f.get("dist") or 0.0)
                    if not is_old_run and tie_in_offset != 0.0:
                        abs_dist += tie_in_offset
                except:
                    abs_dist = 0.0
                    
                depth = f.get("depth_pct") or f.get("depth")
                try:
                    depth = float(depth) if str(depth).strip() else None
                except:
                    depth = None
                    
                length = f.get("length_mm") or f.get("length")
                try:
                    length = float(length) if str(length).strip() else None
                except:
                    length = None
                    
                width = f.get("width_mm") or f.get("width")
                try:
                    width = float(width) if str(width).strip() else None
                except:
                    width = None
                    
                dist_gw = f.get("dist_to_us_gw_m")
                try:
                    dist_gw = float(dist_gw) if str(dist_gw).strip() else None
                except:
                    dist_gw = None
                    
                clock = f.get("clock_position") or f.get("orientation")
                
                mapped.append({
                    "id": str(f.get("feature_id") or f.get("id")),
                    "abs_distance_m": abs_dist,
                    "depth_pct": depth,
                    "length_mm": length,
                    "width_mm": width,
                    "dist_to_us_gw_m": dist_gw,
                    "clock_position": clock,
                    "originalType": str(f.get("feature_type") or f.get("originalType") or "").lower(),
                    "raw": f
                })
                
            return sorted(mapped, key=lambda x: x["abs_distance_m"])
        except Exception as e:
            print(f"[ERROR] Failed to read run data from JSON: {e}")
            return []

    def get_gw_matches(self) -> list[dict]:
        """
        Returns list of locked GW matches from DB, sorted by oldVal.
        """
        try:
            if not self.session_id:
                print("[WARN] No session_id provided, returning empty GW matches")
                return []
                
            sess = self.session.query(AlignmentSession).filter(AlignmentSession.id == self.session_id).first()
            if not sess or not sess.params_json:
                print(f"[WARN] No AlignmentSession found for id={self.session_id}")
                return []
                
            gw_pairs = sess.params_json.get("gwMatches", [])
            # New sessions persist the strict Phase-1 contract separately from
            # the legacy UI payload.  Use it as the canonical segment boundary
            # source when the legacy list is absent.
            if not gw_pairs:
                gw_pairs = [
                    {
                        "oldVal": pair.get("old_odometer"),
                        "newVal": pair.get("new_odometer"),
                        "offset": (
                            float(pair["new_odometer"]) - float(pair["old_odometer"])
                            if pair.get("old_odometer") is not None and pair.get("new_odometer") is not None
                            else None
                        ),
                        "status": "Match",
                    }
                    for pair in sess.params_json.get("gwMatchesFinal", [])
                ]
            if not gw_pairs:
                print(f"[WARN] No gwMatches found in params_json for session_id={self.session_id}")
                return []
                
            valid_gw_pairs = [p for p in gw_pairs if str(p.get("status", "Match")).upper() in {"MATCH", "MATCHED"}]
            print(f"[GW Lock] Found {len(valid_gw_pairs)} valid GW matches from DB")
            
            return sorted(
                [p for p in valid_gw_pairs if p.get("oldVal") is not None and p.get("newVal") is not None],
                key=lambda x: float(x["oldVal"])
            )
        except Exception as e:
            print(f"[ERROR] Failed to fetch from DB: {e}")
            return []

    def _build_offset_table(self, gw_pairs: list[dict]) -> list[tuple[float, float]]:
        if not gw_pairs:
            return []
        return [(float(p["oldVal"]), float(p["offset"])) for p in gw_pairs if "offset" in p and p["offset"] is not None]

    def _interpolate_offset(self, dist_m: float, offset_table: list[tuple[float, float]], offset_keys: list[float] = None) -> float:
        if not offset_table:
            return 0.0
        if dist_m <= offset_table[0][0]:
            return offset_table[0][1]
        if dist_m >= offset_table[-1][0]:
            return offset_table[-1][1]
            
        keys = offset_keys if offset_keys is not None else [x[0] for x in offset_table]
        idx = bisect.bisect_right(keys, dist_m)
        if idx == 0:
            return offset_table[0][1]
            
        x0, o0 = offset_table[idx - 1]
        x1, o1 = offset_table[idx]
        
        if x1 == x0:
            return o0
            
        t = (dist_m - x0) / (x1 - x0)
        return o0 + t * (o1 - o0)

    def assign_to_segment(self, dist: float, boundaries: list[float]) -> int:
        return bisect.bisect_right(boundaries, dist)

    def build_cost_matrix(
        self,
        anomalies_1: list[dict],
        anomalies_2: list[dict],
        offset_table: list[tuple[float, float]],
        offset_keys: list[float] = None
    ) -> np.ndarray:
        # Handle hidden features and depth threshold filtering from Scenario Assessment
        filtered_1 = []
        for f in anomalies_1:
            orig_type = str(f.get("originalType", "")).lower()
            if orig_type in self.hidden_features:
                continue
            if f.get("depth_pct") is not None and f.get("depth_pct") < self.depth_thresh:
                continue
            filtered_1.append(f)
            
        filtered_2 = []
        for f in anomalies_2:
            orig_type = str(f.get("originalType", "")).lower()
            if orig_type in self.hidden_features:
                continue
            if f.get("depth_pct") is not None and f.get("depth_pct") < self.depth_thresh:
                continue
            filtered_2.append(f)
            
        anomalies_1 = filtered_1
        anomalies_2 = filtered_2

        n = len(anomalies_1)
        m = len(anomalies_2)
        cost = np.full((n, m), self.INF_COST, dtype=float)

        # Physics penalty weights from Algoritma.py
        w_gw = 3.0
        w_clock = 2.0
        w_depth = 1.5
        w_length = 1.0
        w_width = 0.5

        for i, f1 in enumerate(anomalies_1):
            corrected_dist = f1["abs_distance_m"] + self._interpolate_offset(
                f1["abs_distance_m"], offset_table, offset_keys
            )
            for j, f2 in enumerate(anomalies_2):
                signed_distance = f2["abs_distance_m"] - corrected_dist
                diff = abs(signed_distance)
                distance_tolerance = (
                    self.ds_gw_distance_tolerance
                    if signed_distance >= 0
                    else self.us_gw_distance_tolerance
                )
                # Keep the historical base tolerance as a floor.  The UI values
                # refine the directional tolerance but must not make an existing
                # valid alignment disappear merely because the default was 0.5 m.
                # EDIT: Removed 0.5m floor to strictly obey UI input
                if diff <= distance_tolerance:
                    base_cost = 0.0
                    
                    # 1. GW Penalty
                    gw1 = f1.get("dist_to_us_gw_m")
                    gw2 = f2.get("dist_to_us_gw_m")
                    if gw1 is not None and gw2 is not None:
                        base_cost += w_gw * (min(abs(gw1 - gw2), 2.0) / 2.0)
                        
                    # 2. Clock Penalty
                    cd = self._clock_diff(f1.get("clock_position"), f2.get("clock_position"))
                    if cd is not None:
                        if cd > self.clock_tolerance:
                            continue # Strict gating
                        base_cost += w_clock * (cd / self.clock_tolerance)
                        
                    # 3. Depth Penalty
                    d1, d2 = f1.get("depth_pct"), f2.get("depth_pct")
                    if d1 is not None and d2 is not None:
                        depth_difference = abs(d1 - d2)
                        if depth_difference > self.depth_tolerance:
                            continue # Strict gating
                        base_cost += w_depth * (depth_difference / self.depth_tolerance)
                        
                    # 4. Length Penalty
                    l1, l2 = f1.get("length_mm"), f2.get("length_mm")
                    if l1 is not None and l2 is not None:
                        length_difference = abs(l1 - l2)
                        if length_difference > self.length_tolerance:
                            continue # Strict gating
                        base_cost += w_length * (length_difference / self.length_tolerance)
                        
                    # 5. Width Penalty
                    wid1, wid2 = f1.get("width_mm"), f2.get("width_mm")
                    if wid1 is not None and wid2 is not None:
                        base_cost += w_width * (min(abs(wid1 - wid2), 200.0) / 200.0)
                        
                    cost[i][j] = base_cost

        return cost

    def perform_alignment(self) -> list[AlignmentResult]:
        print(f"\n{'='*60}")
        print(f"ILI Strict Phase-3 Anomaly Hungarian Alignment: {self.run_1_year} -> {self.run_2_year}")
        print(f"{'='*60}")

        print("[1/5] Fetching data...")
        anomalies_1_all = self.fetch_data(is_old_run=True)
        anomalies_2_all = self.fetch_data(is_old_run=False)

        if not anomalies_1_all or not anomalies_2_all:
            print("[ERROR] Dataset kosong, abort.")
            return []

        print("[2/5] Loading GW Matches from DB & Creating Segments...")
        gw_pairs = self.get_gw_matches()
        offset_table = self._build_offset_table(gw_pairs)
        offset_keys = [x[0] for x in offset_table] if offset_table else []

        # Read parameters from params_json
        params_json = {}
        try:
            params_json = json.loads(sys.argv[4])
        except Exception:
            pass

        self.scenario_filter = params_json.get("scenario", {})
        self.hidden_features = self.scenario_filter.get("hiddenFeatures", [])
        self.depth_thresh = float(self.scenario_filter.get("depthThresh", 0))

        # We will map distThresh to us_gw_distance_tolerance if provided in ToleranceConfig
        tol_config = params_json.get("ToleranceConfig", {})
        
        # Override tolerances if config provides them
        if "clock_tolerance" in tol_config:
            self.clock_tolerance = float(tol_config["clock_tolerance"])
        if "us_gw_distance_tolerance" in tol_config:
            self.us_gw_distance_tolerance = float(tol_config["us_gw_distance_tolerance"])
        if "ds_gw_distance_tolerance" in tol_config:
            self.ds_gw_distance_tolerance = float(tol_config["ds_gw_distance_tolerance"])
        if "depth_tolerance" in tol_config:
            self.depth_tolerance = float(tol_config["depth_tolerance"])
        if "length_tolerance" in tol_config:
            self.length_tolerance = float(tol_config["length_tolerance"])

        try:
            sess = self.session.query(AlignmentSession).filter(AlignmentSession.id == self.session_id).first()
            if sess and sess.params_json:
                gw_matches_final = sess.params_json.get("gwMatchesFinal", [])
                gw_orphans = sess.params_json.get("gwOrphans", [])
            else:
                gw_matches_final = []
                gw_orphans = []
        except Exception:
            gw_matches_final = []
            gw_orphans = []

        # Legacy Fallback: If gwMatchesFinal is empty, try to reconstruct from gwMatches
        try:
            sess = self.session.query(AlignmentSession).filter(AlignmentSession.id == self.session_id).first()
            if not gw_matches_final and sess and sess.params_json and "gwMatches" in sess.params_json:
                legacy_gws = sess.params_json["gwMatches"]
                for m in legacy_gws:
                    if m.get("status") == "Match":
                        gw_matches_final.append({
                            "old_id": m.get("oldId"),
                            "new_id": m.get("newId"),
                            "old_odometer": m.get("oldVal"),
                            "new_odometer": m.get("newVal")
                        })
                    else:
                        is_old = m.get("newId") is None
                        gw_orphans.append({
                            "id": m.get("oldId") if is_old else m.get("newId"),
                            "status": "ONLY_OLD" if is_old else "ONLY_NEW",
                            "old_id": m.get("oldId"),
                            "new_id": m.get("newId")
                        })
                print(f"      [Validation] Reconstructed {len(gw_matches_final)} matches from legacy gwMatches", file=sys.stderr)
        except Exception as e:
            print(f"[ERROR] Legacy fallback failed: {e}", file=sys.stderr)

        # Extract locked IDs from gwMatchesFinal ONLY
        locked_run1_str = {str(p["old_id"]) for p in gw_matches_final if p.get("old_id")}
        locked_run2_str = {str(p["new_id"]) for p in gw_matches_final if p.get("new_id")}

        print(f"      [Validation] Locked GWs (MatchesFinal): {len(gw_matches_final)}", file=sys.stderr)
        print(f"      [Validation] Orphans GWs: {len(gw_orphans)}", file=sys.stderr)

        # HANYA fitur yang BELUM MATCH (termasuk Anomaly) yang lanjut ke langkah 4-6
        # DAN KITA FILTER HANYA ANOMALY (Buang weld, valve, tee, flange, bend)
        non_anomaly_types = {'weld', 'girth weld', 'valve', 'tee', 'flange', 'bend'}
        
        non_anomaly_old = [
            f for f in anomalies_1_all
            if str(f["id"]) not in locked_run1_str and str(f.get("originalType", "")).lower() in non_anomaly_types
        ]
        
        non_anomaly_new = [
            f for f in anomalies_2_all
            if str(f["id"]) not in locked_run2_str and str(f.get("originalType", "")).lower() in non_anomaly_types
        ]

        anomalies_1 = [
            f for f in anomalies_1_all 
            if str(f["id"]) not in locked_run1_str and str(f.get("originalType", "")).lower() not in non_anomaly_types
        ]
        
        anomalies_2 = [
            f for f in anomalies_2_all
            if str(f["id"]) not in locked_run2_str and str(f.get("originalType", "")).lower() not in non_anomaly_types
        ]

        print(f"      [Validation] Valid Anomaly Candidates Run1: {len(anomalies_1)} (Out of {len(anomalies_1_all)})", file=sys.stderr)
        print(f"      [Validation] Valid Anomaly Candidates Run2: {len(anomalies_2)} (Out of {len(anomalies_2_all)})", file=sys.stderr)

        # Extract anomalies without depth_pct to bypass Hungarian matcher
        excluded_old = [f for f in anomalies_1 if f.get("depth_pct") is None]
        excluded_new = [f for f in anomalies_2 if f.get("depth_pct") is None]
        
        # Add the non-anomaly features to the bypass list so they aren't lost
        excluded_old.extend(non_anomaly_old)
        excluded_new.extend(non_anomaly_new)
        
        # Keep only anomalies WITH depth_pct for Hungarian matcher
        anomalies_1 = [f for f in anomalies_1 if f.get("depth_pct") is not None]
        anomalies_2 = [f for f in anomalies_2 if f.get("depth_pct") is not None]
        
        print(f"      [Validation] Bypassed Anomalies (No Depth) Run1: {len(excluded_old)}", file=sys.stderr)
        print(f"      [Validation] Bypassed Anomalies (No Depth) Run2: {len(excluded_new)}", file=sys.stderr)

        run1_boundaries = [float(p["oldVal"]) for p in gw_pairs]
        run2_boundaries = [float(p["newVal"]) for p in gw_pairs]
        
        num_segments = len(gw_pairs) + 1
        print(f"      Grouping anomalies into {num_segments} strict segments.")

        segments_1 = {i: [] for i in range(num_segments)}
        segments_2 = {i: [] for i in range(num_segments)}

        for f1 in anomalies_1:
            seg_id = self.assign_to_segment(f1["abs_distance_m"], run1_boundaries)
            segments_1[seg_id].append(f1)
            
        for f2 in anomalies_2:
            seg_id = self.assign_to_segment(f2["abs_distance_m"], run2_boundaries)
            segments_2[seg_id].append(f2)

        print("[3/5] Running Hungarian matching strictly within each segment...")
        
        results: list[AlignmentResult] = []
        total_matched = 0
        total_new = 0
        total_missing = 0

        for seg_id in range(num_segments):
            seg_anomalies_1 = segments_1[seg_id]
            seg_anomalies_2 = segments_2[seg_id]

            if not seg_anomalies_1 and not seg_anomalies_2:
                continue
                
            if not seg_anomalies_1:
                for f2 in seg_anomalies_2:
                    results.append(AlignmentResult(session_id=self.session_id, feature_old_id=None, feature_new_id=safe_int(f2["id"]), match_status="Only NEW"))
                    total_new += 1
                continue
                
            if not seg_anomalies_2:
                for f1 in seg_anomalies_1:
                    results.append(AlignmentResult(session_id=self.session_id, feature_old_id=safe_int(f1["id"]), feature_new_id=None, match_status="Only OLD"))
                    total_missing += 1
                continue

            cost_matrix = self.build_cost_matrix(seg_anomalies_1, seg_anomalies_2, offset_table, offset_keys)
            row_ind, col_ind = linear_sum_assignment(cost_matrix)

            matched_1 = set()
            matched_2 = set()

            for i, j in zip(row_ind, col_ind):
                # THRESHOLD GATE: Buang pasangan yang cost == INF_COST
                if cost_matrix[i][j] >= self.INF_COST:
                    continue

                f1 = seg_anomalies_1[i]
                f2 = seg_anomalies_2[j]
                matched_1.add(i)
                matched_2.add(j)
                total_matched += 1
                
                odo_diff = float(f2["abs_distance_m"] - f1["abs_distance_m"])

                results.append(
                    AlignmentResult(
                        session_id=self.session_id,
                        feature_old_id=safe_int(f1["id"]),
                        feature_new_id=safe_int(f2["id"]),
                        match_status="Matched",
                        odo_diff=odo_diff
                    )
                )

            for i, f1 in enumerate(seg_anomalies_1):
                if i not in matched_1:
                    results.append(AlignmentResult(session_id=self.session_id, feature_old_id=safe_int(f1["id"]), feature_new_id=None, match_status="Only OLD"))
                    total_missing += 1
            
            for j, f2 in enumerate(seg_anomalies_2):
                if j not in matched_2:
                    results.append(AlignmentResult(session_id=self.session_id, feature_old_id=None, feature_new_id=safe_int(f2["id"]), match_status="Only NEW"))
                    total_new += 1

        # BYPASS MECHANISM: c. gwOrphans/Excluded features langsung passthrough ke output (only_old/only_new)
        for f1 in excluded_old:
            results.append(AlignmentResult(session_id=self.session_id, feature_old_id=safe_int(f1["id"]), feature_new_id=None, match_status="Only OLD"))
        for f2 in excluded_new:
            results.append(AlignmentResult(session_id=self.session_id, feature_old_id=None, feature_new_id=safe_int(f2["id"]), match_status="Only NEW"))

        # VALIDASI WAJIB (print sebagai log sebelum return)
        print(f"\n[VALIDATION] Total Anomaly Input OLD: {len(anomalies_1)}")
        print(f"[VALIDATION] Total Anomaly Input NEW: {len(anomalies_2)}")
        print(f"[VALIDATION] Total Excluded/Bypassed OLD: {len(excluded_old)}")
        print(f"[VALIDATION] Total Excluded/Bypassed NEW: {len(excluded_new)}")
        print(f"[VALIDATION] Matched: {total_matched} | Only OLD (Anom): {total_missing} | Only NEW (Anom): {total_new}")

        # --- Print JSON for Node.js ---
        print("\n[4/5] Outputting structured 5-key JSON for Node.js...")
        
        a1_lookup = {str(a["id"]): a for a in anomalies_1_all}
        a2_lookup = {str(a["id"]): a for a in anomalies_2_all}
        
        def format_row(old_id_val, new_id_val, status, odo_diff=None):
            f1 = a1_lookup.get(str(old_id_val)) if old_id_val else None
            f2 = a2_lookup.get(str(new_id_val)) if new_id_val else None
            return {
                "session_id": self.session_id,
                "feature_old_id": safe_int(old_id_val) if old_id_val else None,
                "feature_new_id": safe_int(new_id_val) if new_id_val else None,
                "match_status": status,
                "Match/Unmatch": status,
                "odo_diff": odo_diff,
                "Identif. OLD": f1.get("id") if f1 else "-",
                "Identif. NEW": f2.get("id") if f2 else "-",
                "Log Dist OLD (m)": f1.get("abs_distance_m") if f1 else "-",
                "Log Dist NEW (m)": f2.get("abs_distance_m") if f2 else "-",
                "Feature Type OLD": f1.get("originalType") if f1 else "-",
                "Feature Type NEW": f2.get("originalType") if f2 else "-",
                "Depth OLD (%WT)": f1.get("depth_pct") if f1 else "-",
                "Depth NEW (%WT)": f2.get("depth_pct") if f2 else "-",
                "Length OLD (mm)": f1.get("length_mm") if f1 else "-",
                "Length NEW (mm)": f2.get("length_mm") if f2 else "-",
                "Width OLD (mm)": f1.get("width_mm") if f1 else "-",
                "Width NEW (mm)": f2.get("width_mm") if f2 else "-",
                "O'Clock OLD": f1.get("clock_position") if f1 else "-",
                "O'Clock NEW": f2.get("clock_position") if f2 else "-"
            }

        gw_locked = []
        for gw in gw_matches_final:
            gw_locked.append(format_row(gw.get("old_id"), gw.get("new_id"), "Matched"))
            
        gw_unmatched = []
        for gw in gw_orphans:
            status = gw.get("status", "Skipped")
            if status == "ONLY_OLD":
                gw_unmatched.append(format_row(gw.get("old_id") or gw.get("id"), None, status))
            elif status == "ONLY_NEW":
                gw_unmatched.append(format_row(None, gw.get("new_id") or gw.get("id"), status))
            else:
                gw_unmatched.append(format_row(gw.get("old_id") or gw.get("id"), gw.get("new_id") or gw.get("id"), status))

        anomaly_matched = []
        anomaly_only_old = []
        anomaly_only_new = []

        for r in results:
            row = format_row(r.feature_old_id, r.feature_new_id, r.match_status, r.odo_diff)
            if r.match_status == "Matched":
                anomaly_matched.append(row)
            elif r.match_status == "Only OLD":
                anomaly_only_old.append(row)
            elif r.match_status == "Only NEW":
                anomaly_only_new.append(row)

        json_output = {
            "gw_locked": gw_locked,
            "gw_unmatched": gw_unmatched,
            "anomaly_matched": anomaly_matched,
            "anomaly_only_old": anomaly_only_old,
            "anomaly_only_new": anomaly_only_new
        }

        print("___RESULT_JSON_BEGIN___")
        print(json.dumps(json_output))
        print("___RESULT_JSON_END___")
        
        print(f"\n[5/5] Selesai! Matched: {total_matched} | New: {total_new} | Missing: {total_missing}")
        return results

if __name__ == "__main__":
    session_id = None
    if len(sys.argv) > 1:
        session_id = int(sys.argv[1])
        
    if not session_id:
        print("[ERROR] No session_id provided")
        sys.exit(1)
        
    engine = HungarianAnomalyAlignmentEngine(
        session_id=session_id,
        distance_tolerance_m=0.5,
    )
    engine.perform_alignment()
