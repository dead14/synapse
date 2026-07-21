import sys
import json
import os
import pandas as pd
import numpy as np
import bisect
from dataclasses import dataclass
from models import SessionLocal, ILIFeature, AlignmentResult, AlignmentSession
from tiein_transform import map_old_to_new, validated_tiein_knots


@dataclass(frozen=True)
class SectionCompilation:
    sections: list[dict]
    errors: list[str]

    @property
    def is_valid(self) -> bool:
        return not self.errors

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
    # Dense matrix + Python DP is exact for small segments, but becomes
    # unusable when both runs contain many anomalies. Large segments switch to
    # a sparse distance-window solver below.
    MAX_DENSE_ALIGNMENT_CELLS = int(os.getenv("MAX_DENSE_ALIGNMENT_CELLS", "250000"))

    @staticmethod
    def _read_us_gw_distance(feature: dict):
        aliases = (
            "dist_to_us_gw_m",
            "distance_to_us_gw_m",
            "Dist. to U/S GW (m)",
            "Distance to U/S GW (m)",
            "U/S GW Distance (m)",
            "US GW Distance (m)",
        )
        for key in aliases:
            value = feature.get(key)
            if value is None or str(value).strip() == "":
                continue
            try:
                # Vendors may encode upstream as a negative signed direction
                # while others store a positive distance.  Matching compares
                # physical magnitude, not the vendor sign convention.
                return abs(float(str(value).replace(",", "")))
            except (TypeError, ValueError):
                continue

        for key, value in feature.items():
            normalized = "".join(
                character.lower() if character.isalnum() else " "
                for character in str(key)
            )
            tokens = normalized.split()
            has_upstream = "upstream" in tokens or (
                "u" in tokens and "s" in tokens
            ) or "us" in tokens
            if "gw" not in tokens or not has_upstream or not any(
                token.startswith("dist") for token in tokens
            ):
                continue
            try:
                return abs(float(str(value).replace(",", "")))
            except (TypeError, ValueError):
                continue
        return None

    @classmethod
    def solve_monotonic_assignment(cls, cost_matrix: np.ndarray) -> list[tuple[int, int]]:
        """Return the maximum-cardinality, minimum-cost ordered assignment.

        Rows are historical/OLD anomalies and columns are current/NEW anomalies.
        A valid result must increase on both axes, so the selected identity path
        can never cross or move backwards along the pipe.
        """
        rows, columns = cost_matrix.shape
        match_count = np.zeros((rows + 1, columns + 1), dtype=np.int32)
        total_cost = np.zeros((rows + 1, columns + 1), dtype=float)
        action = np.zeros((rows + 1, columns + 1), dtype=np.int8)

        for old_index in range(1, rows + 1):
            action[old_index, 0] = 1  # skip OLD
        for new_index in range(1, columns + 1):
            action[0, new_index] = 2  # skip NEW

        for old_index in range(1, rows + 1):
            for new_index in range(1, columns + 1):
                candidates = [
                    (
                        int(match_count[old_index - 1, new_index]),
                        float(total_cost[old_index - 1, new_index]),
                        1,
                    ),
                    (
                        int(match_count[old_index, new_index - 1]),
                        float(total_cost[old_index, new_index - 1]),
                        2,
                    ),
                ]
                pair_cost = float(cost_matrix[old_index - 1, new_index - 1])
                if np.isfinite(pair_cost) and pair_cost < cls.INF_COST:
                    candidates.append((
                        int(match_count[old_index - 1, new_index - 1]) + 1,
                        float(total_cost[old_index - 1, new_index - 1]) + pair_cost,
                        3,
                    ))

                # Match count is the primary objective. Cost breaks ties, and a
                # real match wins exact ties so the result is deterministic.
                best = max(candidates, key=lambda item: (item[0], -item[1], item[2]))
                match_count[old_index, new_index] = best[0]
                total_cost[old_index, new_index] = best[1]
                action[old_index, new_index] = best[2]

        pairs: list[tuple[int, int]] = []
        old_index, new_index = rows, columns
        while old_index > 0 or new_index > 0:
            selected_action = int(action[old_index, new_index])
            if selected_action == 3:
                pairs.append((old_index - 1, new_index - 1))
                old_index -= 1
                new_index -= 1
            elif selected_action == 1:
                old_index -= 1
            elif selected_action == 2:
                new_index -= 1
            else:
                break

        pairs.reverse()
        return pairs

    @classmethod
    def solve_sparse_monotonic_assignment(
        cls,
        rows: int,
        columns: int,
        edges: list[tuple[int, int, float]],
    ) -> list[tuple[int, int]]:
        """Solve ordered matching without allocating a rows x columns matrix.

        Edges are candidate pairs that already passed the physical distance
        window. A Fenwick prefix tree keeps the best chain ending before each
        NEW index, giving O(E log M) instead of O(N*M).
        """
        if not edges or rows <= 0 or columns <= 0:
            return []

        def better(left, right):
            if left is None:
                return right
            if right is None:
                return left
            if left[0] != right[0]:
                return left if left[0] > right[0] else right
            if left[1] != right[1]:
                return left if left[1] < right[1] else right
            return left if left[2] >= right[2] else right

        tree = [None] * (columns + 1)

        def query(index):
            result = None
            while index > 0:
                result = better(result, tree[index])
                index -= index & -index
            return result

        def update(index, state):
            index += 1
            while index <= columns:
                tree[index] = better(tree[index], state)
                index += index & -index

        indexed_edges = sorted(enumerate(edges), key=lambda item: (item[1][0], item[1][1]))
        states = [None] * len(edges)
        cursor = 0
        while cursor < len(indexed_edges):
            row = indexed_edges[cursor][1][0]
            pending = []
            while cursor < len(indexed_edges) and indexed_edges[cursor][1][0] == row:
                edge_index, (_row, column, cost) = indexed_edges[cursor]
                previous = query(column)
                state = (
                    (previous[0] if previous else 0) + 1,
                    (previous[1] if previous else 0.0) + float(cost),
                    edge_index,
                )
                states[edge_index] = (state[0], state[1], edge_index, previous[2] if previous else None)
                pending.append((column, states[edge_index]))
                cursor += 1
            for column, state in pending:
                update(column, state)

        best = query(columns)
        pairs = []
        while best is not None:
            edge_index = best[2]
            row, column, _cost = edges[edge_index]
            pairs.append((row, column))
            previous_edge = best[3]
            best = states[previous_edge] if previous_edge is not None else None
        pairs.reverse()
        return pairs

    def build_sparse_cost_edges(
        self,
        anomalies_1: list[dict],
        anomalies_2: list[dict],
        offset_table: list[tuple[float, float]],
        offset_keys: list[float] | None = None,
        tolerance_overrides: dict | None = None,
    ) -> list[tuple[int, int, float]]:
        """Build only physically plausible anomaly pairs using sorted distance."""
        if not anomalies_1 or not anomalies_2:
            return []
        new_distances = [float(item["abs_distance_m"]) for item in anomalies_2]
        overrides = tolerance_overrides or {}
        upstream = float(overrides.get("us_gw_distance_tolerance", self.us_gw_distance_tolerance))
        downstream = float(overrides.get("ds_gw_distance_tolerance", self.ds_gw_distance_tolerance))
        edges = []
        for old_index, old_feature in enumerate(anomalies_1):
            corrected = old_feature["abs_distance_m"] + self._interpolate_offset(
                old_feature["abs_distance_m"], offset_table, offset_keys,
            )
            first = bisect.bisect_left(new_distances, corrected - upstream)
            last = bisect.bisect_right(new_distances, corrected + downstream)
            for new_index in range(first, last):
                new_feature = anomalies_2[new_index]
                cost = self.build_cost_matrix(
                    [old_feature], [new_feature], offset_table, offset_keys, tolerance_overrides,
                )[0][0]
                if cost < self.INF_COST:
                    edges.append((old_index, new_index, float(cost)))
        return edges

    @staticmethod
    def _gw_pair_key(pair: dict) -> str:
        old_id = pair.get("old_id", pair.get("oldId"))
        new_id = pair.get("new_id", pair.get("newId"))
        old_distance = pair.get("old_odometer", pair.get("oldVal", pair.get("oldDist")))
        new_distance = pair.get("new_odometer", pair.get("newVal", pair.get("newDist")))
        return f"{old_id}::{new_id}::{float(old_distance):.6f}::{float(new_distance):.6f}"

    @classmethod
    def compile_sections(cls, raw_sections: list[dict], locked_gw_pairs: list[dict]) -> SectionCompilation:
        if not raw_sections:
            return SectionCompilation([], [])

        locked_by_key = {
            cls._gw_pair_key(pair): (index, pair)
            for index, pair in enumerate(locked_gw_pairs)
        }
        compiled = []
        errors = []
        valid_policies = {"MATCH", "BYPASS", "REVIEW"}

        for previous, current in zip(locked_gw_pairs, locked_gw_pairs[1:]):
            if (
                float(current["new_odometer"]) <= float(previous["new_odometer"])
                or float(current["old_odometer"]) <= float(previous["old_odometer"])
            ):
                errors.append("Locked GW pairs must increase strictly on both OLD and NEW")
                break

        for section_index, section in enumerate(raw_sections):
            label = str(section.get("name") or section.get("id") or f"Section {section_index + 1}")
            start_entry = locked_by_key.get(str(section.get("startGwKey", "")))
            end_entry = locked_by_key.get(str(section.get("endGwKey", "")))
            if not start_entry or not end_entry:
                errors.append(f"{label}: section boundary must use locked GW pairs")
                continue

            start_index, start_pair = start_entry
            end_index, end_pair = end_entry
            if start_index >= end_index:
                errors.append(f"{label}: end GW must be downstream of start GW on NEW")
                continue

            policy = str(section.get("policy", "MATCH")).upper()
            if policy not in valid_policies:
                errors.append(f"{label}: unsupported section policy {policy}")
                continue

            tolerances = section.get("tolerances")
            if tolerances is not None:
                if not isinstance(tolerances, dict):
                    errors.append(f"{label}: tolerances must be an object")
                    continue
                try:
                    if any(float(value) < 0 for value in tolerances.values()):
                        errors.append(f"{label}: tolerances must be non-negative")
                        continue
                except (TypeError, ValueError):
                    errors.append(f"{label}: tolerances must contain numeric values")
                    continue

            compiled.append({
                **section,
                "id": str(section.get("id") or f"section-{section_index + 1}"),
                "name": label,
                "policy": policy,
                "reference_run": "NEW",
                "start_index": start_index,
                "end_index": end_index,
                "old_start": float(start_pair["old_odometer"]),
                "old_end": float(end_pair["old_odometer"]),
                "new_start": float(start_pair["new_odometer"]),
                "new_end": float(end_pair["new_odometer"]),
            })

        compiled.sort(key=lambda item: (item["start_index"], item["end_index"]))
        for previous, current in zip(compiled, compiled[1:]):
            if current["start_index"] < previous["end_index"]:
                errors.append(f"{current['name']}: section boundaries overlap {previous['name']}")

        return SectionCompilation(compiled, errors)

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
        self.use_us_gw_distance = True
        self.length_tolerance = 400.0
        self.session = SessionLocal()
        
        # Resolve chronology from survey years. Older wizard sessions stored
        # the newest upload in ``oldRun``; logical OLD/NEW must never inherit
        # that legacy field-name inversion.
        sess = self.session.query(AlignmentSession).filter(AlignmentSession.id == self.session_id).first()
        if sess and sess.params_json:
            old_run, new_run, self.swap_persisted_runs = self._resolve_run_bindings(sess.params_json)
            self.run_1_year = int(old_run.get("year") or 2020)
            self.run_2_year = int(new_run.get("year") or 2025)
        else:
            self.swap_persisted_runs = False
            self.run_1_year = 2020
            self.run_2_year = 2025

    @staticmethod
    def _run_year(run: dict) -> int | None:
        try:
            return int(float(run.get("year") or run.get("surveyYear")))
        except (TypeError, ValueError):
            return None

    @classmethod
    def _resolve_run_bindings(cls, params_json: dict) -> tuple[dict, dict, bool]:
        summary = params_json.get("summaryData", {})
        master = summary.get("masterRun")
        historical = summary.get("historicalRuns") or []
        if master:
            old_run = (
                max(historical, key=lambda run: cls._run_year(run) or -1)
                if historical
                else summary.get("oldRun", params_json.get("oldRun", {}))
            )
            return old_run or {}, master, False

        stored_old = summary.get("oldRun", params_json.get("oldRun", {})) or {}
        stored_new = summary.get("newRun", params_json.get("newRun", {})) or {}
        old_year = cls._run_year(stored_old)
        new_year = cls._run_year(stored_new)
        if old_year is not None and new_year is not None and old_year > new_year:
            return stored_new, stored_old, True
        return stored_old, stored_new, False

    def _logical_gw_pair(self, pair: dict) -> dict:
        if not getattr(self, "swap_persisted_runs", False):
            return dict(pair)
        swapped = dict(pair)
        swapped["old_id"], swapped["new_id"] = pair.get("new_id"), pair.get("old_id")
        swapped["old_odometer"], swapped["new_odometer"] = (
            pair.get("new_odometer"), pair.get("old_odometer")
        )
        status = str(pair.get("status", "")).upper().replace(" ", "_")
        if status == "ONLY_OLD":
            swapped["status"] = "ONLY_NEW"
        elif status == "ONLY_NEW":
            swapped["status"] = "ONLY_OLD"
        return swapped

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

    @staticmethod
    def _physics_warnings(old_feature, new_feature):
        if not old_feature or not new_feature:
            return []
        old_depth = old_feature.get("depth_pct")
        new_depth = new_feature.get("depth_pct")
        if old_depth is None or new_depth is None:
            return []
        delta = float(new_depth) - float(old_depth)
        if delta >= 0:
            return []
        return [{
            "code": "DEPTH_DECREASE",
            "severity": "REVIEW",
            "deltaPctWt": round(delta, 6),
            "message": "NEW depth is lower than OLD; review tool tolerance, repair, or identity.",
        }]

    def _load_persisted_run_features(self, run_id: int) -> list[dict]:
        """Read canonical records from the run table in bounded ORM batches."""
        query = (
            self.session.query(ILIFeature)
            .filter(ILIFeature.run_id == run_id)
            .order_by(ILIFeature.log_distance_m.asc(), ILIFeature.id.asc())
        )
        records = []
        for feature in query.yield_per(5_000):
            records.append({
                # The database id is stable and is valid for AlignmentResult
                # foreign keys. Vendor feature identifiers are only evidence.
                "id": str(feature.id),
                "sourceFeatureId": feature.feature_id,
                "feature_id": feature.feature_id,
                "log_distance_m": feature.log_distance_m,
                "dist": feature.log_distance_m,
                "feature_type": feature.feature_type,
                "feature_identification": feature.feature_identification,
                "dist_to_us_gw_m": feature.dist_to_us_gw_m,
                "joint_length_m": feature.joint_length_m,
                "clock_position": feature.clock_position,
                "wall_thickness_mm": feature.wall_thickness_mm,
                "length_mm": feature.length_mm,
                "width_mm": feature.width_mm,
                "depth_pct": feature.depth_pct,
                "surface_location": feature.surface_location,
                "erf_asme": feature.erf_asme,
                "psafe_bar": feature.psafe_bar,
                "comment": feature.comment,
            })
        return records

    def fetch_data(self, is_old_run: bool) -> list[dict]:
        try:
            sess = self.session.query(AlignmentSession).filter(AlignmentSession.id == self.session_id).first()
            if not sess or not sess.params_json:
                return []
            
            old_run, new_run, swap_persisted_runs = self._resolve_run_bindings(sess.params_json)
            self.swap_persisted_runs = swap_persisted_runs
            run = old_run if is_old_run else new_run
            run_id = safe_int(run.get("runId"))
            features = (
                self._load_persisted_run_features(run_id)
                if run_id is not None and run_id > 0
                else run.get("rawFeatures", [])
            )
            
            # The wizard persists globalOffset. Keep tieInOffset as a legacy
            # fallback so older saved sessions still map into the same space.
            tie_in_offset = float(
                sess.params_json.get(
                    "globalOffset",
                    sess.params_json.get("tieInOffset", 0.0),
                )
            )
            tie_in_knots = validated_tiein_knots(sess.params_json)
            
            # Map them into the format expected by the engine (abs_distance_m, id, depth_pct, length_mm, width_mm)
            mapped = []
            for f in features:
                # Need to handle string " " and None gracefully
                try:
                    abs_dist = float(f.get("log_distance_m") or f.get("dist") or 0.0)
                    source_abs_dist = abs_dist
                    if is_old_run and tie_in_knots:
                        master_distance = map_old_to_new(abs_dist, tie_in_knots)
                        tiein_outside_domain = master_distance is None
                        if master_distance is not None:
                            abs_dist = master_distance
                    elif not tie_in_knots and not is_old_run and tie_in_offset != 0.0:
                        abs_dist += tie_in_offset
                        tiein_outside_domain = False
                    else:
                        tiein_outside_domain = False
                except:
                    abs_dist = 0.0
                    source_abs_dist = 0.0
                    tiein_outside_domain = False
                    
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
                    
                dist_gw = self._read_us_gw_distance(f)
                    
                # Prefer the pre-converted 'clock' field from the frontend upload,
                # fall back to raw column values, and convert Excel time serials.
                clock = f.get("clock") or f.get("clock_position") or f.get("orientation")
                if clock is not None and clock != '-':
                    try:
                        cv = float(clock)
                        # Excel stores time as fraction of a 24-hour day (0..1)
                        if 0 < cv < 1:
                            total_hours = cv * 24
                            h = int(total_hours)
                            m = round((total_hours - h) * 60)
                            if m == 60:
                                h += 1
                                m = 0
                            if h == 0:
                                h = 12
                            clock = f"{h}:{m:02d}"
                    except (ValueError, TypeError):
                        pass
                
                mapped.append({
                    "id": str(f.get("id") or f.get("feature_id")),
                    "abs_distance_m": abs_dist,
                    "source_abs_distance_m": source_abs_dist,
                    "tiein_outside_domain": tiein_outside_domain,
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
            print(f"[ERROR] Failed to read run data: {e}")
            return []

    def get_gw_matches(self) -> list[dict]:
        """
        Return the locked GW pairs produced by the GW-alignment step.

        Hungarian must never derive a new GW pairing.  The canonical
        ``gwMatchesFinal`` payload is therefore used first and normalized into
        the legacy boundary shape consumed by the anomaly segmenter.
        """
        try:
            if not self.session_id:
                print("[WARN] No session_id provided, returning empty GW matches")
                return []
                
            sess = self.session.query(AlignmentSession).filter(AlignmentSession.id == self.session_id).first()
            if not sess or not sess.params_json:
                print(f"[WARN] No AlignmentSession found for id={self.session_id}")
                return []
                
            gw_pairs_final = sess.params_json.get("gwMatchesFinal", [])
            if gw_pairs_final:
                gw_pairs = [
                    {
                        "oldVal": logical_pair.get("old_odometer"),
                        "newVal": logical_pair.get("new_odometer"),
                        "offset": (
                            float(logical_pair["new_odometer"]) - float(logical_pair["old_odometer"])
                            if logical_pair.get("old_odometer") is not None and logical_pair.get("new_odometer") is not None
                            else None
                        ),
                        "status": "Match",
                    }
                    for persisted_pair in gw_pairs_final
                    for logical_pair in [self._logical_gw_pair(persisted_pair)]
                    if str(logical_pair.get("status", "MATCHED")).upper() in {"MATCH", "MATCHED"}
                ]
            else:
                # Backward compatibility for sessions saved before
                # gwMatchesFinal existed.  DTW used oldDist/newDist whereas
                # the earlier UI used oldVal/newVal, so accept either shape.
                gw_pairs = [
                    {
                        "oldVal": pair.get("newVal", pair.get("newDist")) if getattr(self, "swap_persisted_runs", False) else pair.get("oldVal", pair.get("oldDist")),
                        "newVal": pair.get("oldVal", pair.get("oldDist")) if getattr(self, "swap_persisted_runs", False) else pair.get("newVal", pair.get("newDist")),
                        "offset": None if getattr(self, "swap_persisted_runs", False) else pair.get("offset"),
                        "status": pair.get("status", "Match"),
                    }
                    for pair in sess.params_json.get("gwMatches", [])
                ]
                for pair in gw_pairs:
                    if pair.get("offset") is None and pair.get("oldVal") is not None and pair.get("newVal") is not None:
                        pair["offset"] = float(pair["newVal"]) - float(pair["oldVal"])
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

    def _apply_scenario_filter(self, features: list[dict]) -> list[dict]:
        """Return the exact feature list used by Hungarian and result mapping."""
        eligible, _filtered = self._partition_scenario_features(features)
        return eligible

    def _partition_scenario_features(self, features: list[dict]):
        """Depth is post-match physics evidence, never a candidate filter."""
        return (
            [feature for feature in features if not feature.get("tiein_outside_domain")],
            [feature for feature in features if feature.get("tiein_outside_domain")],
        )

    @staticmethod
    def _ensure_source_keys(features: list[dict], run_label: str) -> None:
        for index, feature in enumerate(features):
            if feature.get("source_key"):
                continue
            raw = feature.get("raw", {})
            supplied_key = raw.get("source_key") or raw.get("sourceRowKey")
            if supplied_key:
                feature["source_key"] = str(supplied_key)
                continue
            distance = float(feature.get("abs_distance_m", 0.0))
            feature["source_key"] = (
                f"{run_label}:{index}:{feature.get('id', '')}:{distance:.6f}"
            )

    @staticmethod
    def _build_conservation_audit(old_features, new_features, output_rows):
        def audit_side(features, column):
            expected = [str(feature["source_key"]) for feature in features]
            actual = [
                str(row[column])
                for row in output_rows
                if row.get(column) not in (None, "", "-")
            ]
            counts = {}
            for key in actual:
                counts[key] = counts.get(key, 0) + 1
            expected_set = set(expected)
            return {
                "inputCount": len(expected),
                "outputReferences": len(actual),
                "missingKeys": sorted(expected_set - set(actual)),
                "duplicateKeys": sorted(
                    key for key, count in counts.items()
                    if count > 1 and key in expected_set
                ),
                "unknownKeys": sorted(set(actual) - expected_set),
            }

        old_audit = audit_side(old_features, "Source Key OLD")
        new_audit = audit_side(new_features, "Source Key NEW")
        is_conserved = all(
            not side[problem]
            for side in (old_audit, new_audit)
            for problem in ("missingKeys", "duplicateKeys", "unknownKeys")
        )
        return {"isConserved": is_conserved, "old": old_audit, "new": new_audit}

    @staticmethod
    def _result_distance_fields(old_feature, new_feature):
        def distances(feature):
            if not feature:
                return "-", "-"
            mapped = feature.get("abs_distance_m")
            return mapped, feature.get("source_abs_distance_m", mapped)

        old_mapped, old_original = distances(old_feature)
        new_mapped, new_original = distances(new_feature)
        return {
            "Log Dist OLD (m)": old_mapped,
            "Log Dist NEW (m)": new_mapped,
            "Original Log Dist OLD (m)": old_original,
            "Original Log Dist NEW (m)": new_original,
        }

    @staticmethod
    def _is_matchable_anomaly(feature: dict) -> bool:
        """Only anomaly / metal-loss records are eligible for Hungarian."""
        feature_type = str(feature.get("originalType", "")).strip().lower()
        raw_type = str(feature.get("raw", {}).get("type", "")).strip().lower()
        return feature_type in {"anomaly", "metal loss", "metal_loss"} or raw_type == "anomaly"

    @staticmethod
    def _is_gw_feature(feature: dict) -> bool:
        """Return whether Phase 1 owns this feature as a physical GW/anchor."""
        raw = feature.get("raw", {})
        feature_types = {
            str(feature.get("originalType", "")).strip().lower(),
            str(raw.get("type", "")).strip().lower(),
            str(raw.get("feature_type", "")).strip().lower(),
            str(raw.get("originalType", "")).strip().lower(),
        }
        return bool(feature_types & {"weld", "girth weld", "valve", "tee", "flange"})

    @classmethod
    def _partition_hungarian_features(cls, features: list[dict], locked_ids: set[str]):
        """Split Phase-2 input without re-emitting any Phase-1 GW feature."""
        # Phase ownership is determined by feature type, not identifier alone.
        # IDs are not guaranteed unique across vendor exports; filtering every
        # row whose ID appears in a GW lock can silently remove an anomaly.
        remaining = [feature for feature in features if not cls._is_gw_feature(feature)]
        anomalies = [feature for feature in remaining if cls._is_matchable_anomaly(feature)]
        bypassed = [
            feature for feature in remaining
            if not cls._is_matchable_anomaly(feature) and not cls._is_gw_feature(feature)
        ]
        return anomalies, bypassed

    def build_cost_matrix(
        self,
        anomalies_1: list[dict],
        anomalies_2: list[dict],
        offset_table: list[tuple[float, float]],
        offset_keys: list[float] = None,
        tolerance_overrides: dict | None = None,
    ) -> np.ndarray:
        n = len(anomalies_1)
        m = len(anomalies_2)
        cost = np.full((n, m), self.INF_COST, dtype=float)

        # Physics penalty weights from Algoritma.py
        w_gw = 3.0
        w_clock = 2.0
        w_length = 1.0
        w_width = 0.5
        overrides = tolerance_overrides or {}
        clock_tolerance = float(overrides.get("clock_tolerance", self.clock_tolerance))
        us_distance_tolerance = float(overrides.get(
            "us_gw_distance_tolerance", self.us_gw_distance_tolerance
        ))
        ds_distance_tolerance = float(overrides.get(
            "ds_gw_distance_tolerance", self.ds_gw_distance_tolerance
        ))
        length_tolerance = float(overrides.get("length_tolerance", self.length_tolerance))
        use_us_gw_distance = overrides.get(
            "use_us_gw_distance", getattr(self, "use_us_gw_distance", True),
        ) is not False

        for i, f1 in enumerate(anomalies_1):
            corrected_dist = f1["abs_distance_m"] + self._interpolate_offset(
                f1["abs_distance_m"], offset_table, offset_keys
            )
            for j, f2 in enumerate(anomalies_2):
                signed_distance = f2["abs_distance_m"] - corrected_dist
                diff = abs(signed_distance)
                distance_tolerance = (
                    ds_distance_tolerance
                    if signed_distance >= 0
                    else us_distance_tolerance
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
                    if (
                        use_us_gw_distance
                        and getattr(self, "require_us_gw_distance", False)
                        and (gw1 is None or gw2 is None)
                    ):
                        continue
                    if use_us_gw_distance and gw1 is not None and gw2 is not None:
                        gw_distance_difference = abs(abs(gw1) - abs(gw2))
                        if gw_distance_difference > us_distance_tolerance:
                            continue
                        base_cost += w_gw * (
                            gw_distance_difference / max(us_distance_tolerance, 0.001)
                        )
                        
                    # 2. Clock Penalty
                    cd = self._clock_diff(f1.get("clock_position"), f2.get("clock_position"))
                    if cd is not None:
                        # Clock is soft identity evidence. A large circular
                        # difference raises ranking cost but never removes an
                        # otherwise physically plausible candidate.
                        base_cost += w_clock * (cd / max(clock_tolerance, 1.0))
                        
                    # 3. Length Penalty. Depth is deliberately excluded from
                    # pair selection and evaluated only after Hungarian as a
                    # physical growth/decrease warning.
                    l1, l2 = f1.get("length_mm"), f2.get("length_mm")
                    if l1 is not None and l2 is not None:
                        length_difference = abs(l1 - l2)
                        base_cost += w_length * (length_difference / max(length_tolerance, 1.0))
                        
                    # 4. Width Penalty
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

        self._ensure_source_keys(anomalies_1_all, "OLD")
        self._ensure_source_keys(anomalies_2_all, "NEW")

        if not anomalies_1_all or not anomalies_2_all:
            print("[ERROR] Dataset kosong, abort.")
            return []

        print("[2/5] Loading GW Matches from DB & Creating Segments...")
        gw_pairs = self.get_gw_matches()
        offset_table = self._build_offset_table(gw_pairs)
        offset_keys = [x[0] for x in offset_table] if offset_table else []

        # The Node worker invokes this script with a session id only.  Its
        # persisted params_json is therefore the authoritative configuration.
        try:
            sess = self.session.query(AlignmentSession).filter(AlignmentSession.id == self.session_id).first()
        except Exception:
            sess = None

        params_json = sess.params_json if sess and sess.params_json else {}
        self.hidden_features = [
            name for name, is_hidden in params_json.get("hiddenFeatures", {}).items()
            if is_hidden
        ]
        # We will map distThresh to us_gw_distance_tolerance if provided in ToleranceConfig
        tol_config = params_json.get("ToleranceConfig", {})
        
        # Override tolerances if config provides them
        if "clock_tolerance" in tol_config:
            self.clock_tolerance = float(tol_config["clock_tolerance"])
        if "us_gw_distance_tolerance" in tol_config:
            self.us_gw_distance_tolerance = float(tol_config["us_gw_distance_tolerance"])
        if "ds_gw_distance_tolerance" in tol_config:
            self.ds_gw_distance_tolerance = float(tol_config["ds_gw_distance_tolerance"])
        self.use_us_gw_distance = tol_config.get("use_us_gw_distance", True) is not False
        self.require_us_gw_distance = (
            params_json.get("algorithm") == "dtw_hungarian_onedirection"
            and self.use_us_gw_distance
        )
        if "length_tolerance" in tol_config:
            self.length_tolerance = float(tol_config["length_tolerance"])

        try:
            sess = self.session.query(AlignmentSession).filter(AlignmentSession.id == self.session_id).first()
            if sess and sess.params_json:
                gw_matches_final = [
                    self._logical_gw_pair(pair)
                    for pair in sess.params_json.get("gwMatchesFinal", [])
                ]
                gw_orphans = [
                    self._logical_gw_pair(pair)
                    for pair in sess.params_json.get("gwOrphans", [])
                ]
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
                        gw_matches_final.append(self._logical_gw_pair({
                            "old_id": m.get("oldId"),
                            "new_id": m.get("newId"),
                            "old_odometer": m.get("oldVal"),
                            "new_odometer": m.get("newVal")
                        }))
                    else:
                        is_old = m.get("newId") is None
                        gw_orphans.append(self._logical_gw_pair({
                            "id": m.get("oldId") if is_old else m.get("newId"),
                            "status": "ONLY_OLD" if is_old else "ONLY_NEW",
                            "old_id": m.get("oldId"),
                            "new_id": m.get("newId"),
                            "old_odometer": m.get("oldVal", m.get("oldDist")),
                            "new_odometer": m.get("newVal", m.get("newDist")),
                        }))
                print(f"      [Validation] Reconstructed {len(gw_matches_final)} matches from legacy gwMatches", file=sys.stderr)
        except Exception as e:
            print(f"[ERROR] Legacy fallback failed: {e}", file=sys.stderr)

        locked_gw_pairs = sorted(
            gw_matches_final,
            key=lambda pair: float(pair.get("new_odometer", 0.0)),
        )
        compiled_sections = self.compile_sections(
            params_json.get("matchingSections", []),
            locked_gw_pairs,
        )
        if not compiled_sections.is_valid:
            raise ValueError("Invalid matching sections: " + "; ".join(compiled_sections.errors))

        # Extract locked IDs from gwMatchesFinal ONLY
        locked_run1_str = {str(p["old_id"]) for p in gw_matches_final if p.get("old_id")}
        locked_run2_str = {str(p["new_id"]) for p in gw_matches_final if p.get("new_id")}

        print(f"      [Validation] Locked GWs (MatchesFinal): {len(gw_matches_final)}", file=sys.stderr)
        print(f"      [Validation] Orphans GWs: {len(gw_orphans)}", file=sys.stderr)

        # Phase 1 owns every GW/anchor row.  Hungarian receives only anomaly /
        # metal-loss rows, while genuine non-GW features may remain visible in
        # the bypass buckets.  This prevents unmatched GWs from appearing once
        # in gw_unmatched and a second time as Bypassed OLD/NEW.
        anomalies_1, non_anomaly_old = self._partition_hungarian_features(
            anomalies_1_all, locked_run1_str
        )
        anomalies_2, non_anomaly_new = self._partition_hungarian_features(
            anomalies_2_all, locked_run2_str
        )

        print(f"      [Validation] Valid Anomaly Candidates Run1: {len(anomalies_1)} (Out of {len(anomalies_1_all)})", file=sys.stderr)
        print(f"      [Validation] Valid Anomaly Candidates Run2: {len(anomalies_2)} (Out of {len(anomalies_2_all)})", file=sys.stderr)

        # Non-anomaly records stay visible in bypass buckets. Missing depth is
        # not a bypass reason; identity matching must rely on position/shape.
        excluded_old = list(non_anomaly_old)
        excluded_new = list(non_anomaly_new)

        # Filter before segmenting so matrix indexes and source features always
        # refer to the same list.  Filtering inside build_cost_matrix used to
        # return indexes for a shorter list and could map a match to another row.
        anomalies_1, filtered_old = self._partition_scenario_features(anomalies_1)
        anomalies_2, filtered_new = self._partition_scenario_features(anomalies_2)
        
        print(f"      [Validation] Bypassed Non-Anomaly Run1: {len(excluded_old)}", file=sys.stderr)
        print(f"      [Validation] Bypassed Non-Anomaly Run2: {len(excluded_new)}", file=sys.stderr)

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
        # Keep the actual source records alongside the compact database-shaped
        # result.  Excel identifiers are not guaranteed to be populated or
        # unique, so reconstructing an output row from feature_old_id/new_id
        # can otherwise select a different source record.
        result_features: dict[int, tuple[dict | None, dict | None]] = {}

        def append_result(f1, f2, status, odo_diff=None):
            result = AlignmentResult(
                session_id=self.session_id,
                feature_old_id=safe_int(f1["id"]) if f1 else None,
                feature_new_id=safe_int(f2["id"]) if f2 else None,
                match_status=status,
                odo_diff=odo_diff,
            )
            results.append(result)
            result_features[id(result)] = (f1, f2)
        total_matched = 0
        total_new = 0
        total_missing = 0

        for seg_id in range(num_segments):
            seg_anomalies_1 = segments_1[seg_id]
            seg_anomalies_2 = segments_2[seg_id]

            section = next((
                item for item in compiled_sections.sections
                if item["start_index"] < seg_id <= item["end_index"]
            ), None)
            # Sectioning is optional and partial coverage is valid. Segments
            # outside an explicit section inherit the global MATCH policy.
            section_policy = section["policy"] if section else "MATCH"

            if not seg_anomalies_1 and not seg_anomalies_2:
                continue

            if section_policy != "MATCH":
                for f1 in seg_anomalies_1:
                    append_result(f1, None, "Bypassed OLD")
                for f2 in seg_anomalies_2:
                    append_result(None, f2, "Bypassed NEW")
                continue
                
            if not seg_anomalies_1:
                for f2 in seg_anomalies_2:
                    append_result(None, f2, "Only NEW")
                    total_new += 1
                continue
                
            if not seg_anomalies_2:
                for f1 in seg_anomalies_1:
                    append_result(f1, None, "Only OLD")
                    total_missing += 1
                continue

            segment_cells = len(seg_anomalies_1) * len(seg_anomalies_2)
            segment_tolerances = section.get("tolerances") if section else None
            if segment_cells > self.MAX_DENSE_ALIGNMENT_CELLS:
                print(
                    f"      [Optimization] Sparse matching for segment {seg_id}: "
                    f"{len(seg_anomalies_1):,} x {len(seg_anomalies_2):,} candidates",
                    file=sys.stderr,
                )
                sparse_edges = self.build_sparse_cost_edges(
                    seg_anomalies_1,
                    seg_anomalies_2,
                    offset_table,
                    offset_keys,
                    segment_tolerances,
                )
                ordered_pairs = self.solve_sparse_monotonic_assignment(
                    len(seg_anomalies_1), len(seg_anomalies_2), sparse_edges,
                )
                selected_costs = {
                    (old_index, new_index): cost
                    for old_index, new_index, cost in sparse_edges
                }
            else:
                cost_matrix = self.build_cost_matrix(
                    seg_anomalies_1,
                    seg_anomalies_2,
                    offset_table,
                    offset_keys,
                    segment_tolerances,
                )
                ordered_pairs = self.solve_monotonic_assignment(cost_matrix)
                selected_costs = None

            matched_1 = set()
            matched_2 = set()

            for i, j in ordered_pairs:
                # THRESHOLD GATE: Buang pasangan yang cost == INF_COST
                pair_cost = (
                    selected_costs.get((i, j), self.INF_COST)
                    if selected_costs is not None
                    else cost_matrix[i][j]
                )
                if pair_cost >= self.INF_COST:
                    continue

                f1 = seg_anomalies_1[i]
                f2 = seg_anomalies_2[j]
                matched_1.add(i)
                matched_2.add(j)
                total_matched += 1
                
                odo_diff = float(f2["abs_distance_m"] - f1["abs_distance_m"])

                append_result(f1, f2, "Matched", odo_diff)

            for i, f1 in enumerate(seg_anomalies_1):
                if i not in matched_1:
                    append_result(f1, None, "Only OLD")
                    total_missing += 1
            
            for j, f2 in enumerate(seg_anomalies_2):
                if j not in matched_2:
                    append_result(None, f2, "Only NEW")
                    total_new += 1

        # BYPASS MECHANISM: c. gwOrphans/Excluded features langsung passthrough ke output
        for f1 in excluded_old:
            append_result(f1, None, "Bypassed OLD")
        for f2 in excluded_new:
            append_result(None, f2, "Bypassed NEW")
        for f1 in filtered_old:
            append_result(f1, None, "Filtered OLD")
        for f2 in filtered_new:
            append_result(None, f2, "Filtered NEW")

        # VALIDASI WAJIB (print sebagai log sebelum return)
        print(f"\n[VALIDATION] Total Anomaly Input OLD: {len(anomalies_1)}")
        print(f"[VALIDATION] Total Anomaly Input NEW: {len(anomalies_2)}")
        print(f"[VALIDATION] Total Excluded/Bypassed OLD: {len(excluded_old)}")
        print(f"[VALIDATION] Total Excluded/Bypassed NEW: {len(excluded_new)}")
        print(f"[VALIDATION] Matched: {total_matched} | Only OLD (Anom): {total_missing} | Only NEW (Anom): {total_new}")

        # --- Print JSON for Node.js ---
        print("\n[4/5] Outputting structured 5-key JSON for Node.js...")
        
        def find_feature(features, feature_id, odometer=None, consumed=None):
            """Find a GW source record without silently collapsing duplicate IDs."""
            if feature_id is None:
                return None
            candidates = [feature for feature in features if str(feature["id"]) == str(feature_id)]
            if consumed is not None:
                candidates = [
                    feature for feature in candidates
                    if feature.get("source_key") not in consumed
                ]
            if not candidates:
                return None
            selected = candidates[0] if odometer is None or len(candidates) == 1 else min(
                candidates,
                key=lambda feature: abs(feature["abs_distance_m"] - float(odometer)),
            )
            if consumed is not None:
                consumed.add(selected.get("source_key"))
            return selected
        
        def format_row(old_id_val, new_id_val, status, result_group, odo_diff=None, old_feature=None, new_feature=None, old_odometer=None, new_odometer=None, consumed_old=None, consumed_new=None):
            f1 = old_feature or find_feature(anomalies_1_all, old_id_val, old_odometer, consumed_old)
            f2 = new_feature or find_feature(anomalies_2_all, new_id_val, new_odometer, consumed_new)
            physics_warnings = self._physics_warnings(f1, f2)
            year_span = self.run_2_year - self.run_1_year
            depth_growth = None
            length_growth = None
            if year_span > 0 and f1 and f2:
                if f1.get("depth_pct") is not None and f2.get("depth_pct") is not None:
                    depth_growth = (float(f2["depth_pct"]) - float(f1["depth_pct"])) / year_span
                if f1.get("length_mm") is not None and f2.get("length_mm") is not None:
                    length_growth = (float(f2["length_mm"]) - float(f1["length_mm"])) / year_span
            def section_for(feature, side):
                if not feature:
                    return None
                distance = float(feature["abs_distance_m"])
                start_key = "old_start" if side == "OLD" else "new_start"
                end_key = "old_end" if side == "OLD" else "new_end"
                return next((
                    section for section in compiled_sections.sections
                    if min(section[start_key], section[end_key]) <= distance <= max(section[start_key], section[end_key])
                ), None)

            old_section = section_for(f1, "OLD")
            new_section = section_for(f2, "NEW")
            row_section = new_section or old_section
            return {
                "session_id": self.session_id,
                "feature_old_id": safe_int(old_id_val) if old_id_val else None,
                "feature_new_id": safe_int(new_id_val) if new_id_val else None,
                "match_status": status,
                "Match/Unmatch": status,
                "Result Group": result_group,
                "Run Year OLD": self.run_1_year,
                "Run Year NEW": self.run_2_year,
                "Physics Warning": ", ".join(warning["code"] for warning in physics_warnings) or "-",
                "physics_warnings": physics_warnings,
                "Depth Growth (%WT/yr)": depth_growth if depth_growth is not None else "-",
                "Length Growth (mm/yr)": length_growth if length_growth is not None else "-",
                "Source Key OLD": f1.get("source_key") if f1 else "-",
                "Source Key NEW": f2.get("source_key") if f2 else "-",
                "Section": row_section.get("name") if row_section else "-",
                "Section ID": row_section.get("id") if row_section else "-",
                "Section OLD": old_section.get("name") if old_section else "-",
                "Section NEW": new_section.get("name") if new_section else "-",
                "odo_diff": odo_diff,
                # Keep the legacy Identif. fields for existing interactions,
                # while exposing the complete source schema in the result.
                "Identif. OLD": f1.get("id") if f1 else "-",
                "Identif. NEW": f2.get("id") if f2 else "-",
                "Feature ID OLD": f1.get("id") if f1 else "-",
                "Feature ID NEW": f2.get("id") if f2 else "-",
                # Presentation metadata only. Matching and all physics calculations
                # continue to use abs_distance_m on the canonical master axis.
                **self._result_distance_fields(f1, f2),
                "Joint No. OLD": f1.get("raw", {}).get("joint_number") if f1 else "-",
                "Joint No. NEW": f2.get("raw", {}).get("joint_number") if f2 else "-",
                "Dist GW OLD (m)": f1.get("dist_to_us_gw_m") if f1 else "-",
                "Dist GW NEW (m)": f2.get("dist_to_us_gw_m") if f2 else "-",
                "Joint Len OLD (m)": f1.get("raw", {}).get("joint_length_m") if f1 else "-",
                "Joint Len NEW (m)": f2.get("raw", {}).get("joint_length_m") if f2 else "-",
                "Feature Type OLD": f1.get("originalType") if f1 else "-",
                "Feature Type NEW": f2.get("originalType") if f2 else "-",
                "Feature Identification OLD": f1.get("raw", {}).get("feature_identification") if f1 else "-",
                "Feature Identification NEW": f2.get("raw", {}).get("feature_identification") if f2 else "-",
                "Dim Classification OLD": f1.get("raw", {}).get("dim_classification") if f1 else "-",
                "Dim Classification NEW": f2.get("raw", {}).get("dim_classification") if f2 else "-",
                "Wall WT OLD (mm)": f1.get("raw", {}).get("wall_thickness_mm") if f1 else "-",
                "Wall WT NEW (mm)": f2.get("raw", {}).get("wall_thickness_mm") if f2 else "-",
                "Depth OLD (%WT)": f1.get("depth_pct") if f1 else "-",
                "Depth NEW (%WT)": f2.get("depth_pct") if f2 else "-",
                "Length OLD (mm)": f1.get("length_mm") if f1 else "-",
                "Length NEW (mm)": f2.get("length_mm") if f2 else "-",
                "Width OLD (mm)": f1.get("width_mm") if f1 else "-",
                "Width NEW (mm)": f2.get("width_mm") if f2 else "-",
                "O'Clock OLD": f1.get("clock_position") if f1 else "-",
                "O'Clock NEW": f2.get("clock_position") if f2 else "-",
                "Surface OLD": f1.get("raw", {}).get("surface_location") if f1 else "-",
                "Surface NEW": f2.get("raw", {}).get("surface_location") if f2 else "-",
                "ERF ASME OLD": f1.get("raw", {}).get("erf_asme") if f1 else "-",
                "ERF ASME NEW": f2.get("raw", {}).get("erf_asme") if f2 else "-",
                "Psafe OLD (bar)": f1.get("raw", {}).get("psafe_bar") if f1 else "-",
                "Psafe NEW (bar)": f2.get("raw", {}).get("psafe_bar") if f2 else "-",
                "Comment OLD": f1.get("raw", {}).get("comment") if f1 else "-",
                "Comment NEW": f2.get("raw", {}).get("comment") if f2 else "-",
            }

        consumed_gw_old = set()
        consumed_gw_new = set()
        gw_locked = []
        for gw in gw_matches_final:
            gw_locked.append(format_row(
                gw.get("old_id"), gw.get("new_id"), "Matched", "GW",
                old_odometer=gw.get("old_odometer"), new_odometer=gw.get("new_odometer"),
                consumed_old=consumed_gw_old, consumed_new=consumed_gw_new,
            ))
            
        gw_unmatched = []
        for gw in gw_orphans:
            status = gw.get("status", "Skipped")
            orphan_odometer = gw.get("odometer")
            if status == "ONLY_OLD":
                gw_unmatched.append(format_row(
                    gw.get("old_id") or gw.get("id"), None, status, "GW",
                    old_odometer=gw.get("old_odometer", gw.get("oldDist", orphan_odometer)),
                    consumed_old=consumed_gw_old,
                ))
            elif status == "ONLY_NEW":
                gw_unmatched.append(format_row(
                    None, gw.get("new_id") or gw.get("id"), status, "GW",
                    new_odometer=gw.get("new_odometer", gw.get("newDist", orphan_odometer)),
                    consumed_new=consumed_gw_new,
                ))
            else:
                gw_unmatched.append(format_row(
                    gw.get("old_id") or gw.get("id"), gw.get("new_id") or gw.get("id"), status, "GW",
                    old_odometer=gw.get("oldDist", orphan_odometer),
                    new_odometer=gw.get("newDist", orphan_odometer),
                    consumed_old=consumed_gw_old, consumed_new=consumed_gw_new,
                ))

        # Phase 1 can come from an older cached DTW result that did not know
        # every vendor-specific anchor label.  Conserve any remaining typed GW
        # here as an orphan instead of dropping it from both phases.
        for feature in anomalies_1_all:
            if self._is_gw_feature(feature) and feature["source_key"] not in consumed_gw_old:
                consumed_gw_old.add(feature["source_key"])
                gw_unmatched.append(format_row(
                    feature["id"], None, "ONLY_OLD", "GW", old_feature=feature,
                ))
        for feature in anomalies_2_all:
            if self._is_gw_feature(feature) and feature["source_key"] not in consumed_gw_new:
                consumed_gw_new.add(feature["source_key"])
                gw_unmatched.append(format_row(
                    None, feature["id"], "ONLY_NEW", "GW", new_feature=feature,
                ))

        anomaly_matched = []
        anomaly_only_old = []
        anomaly_only_new = []
        bypassed_old = []
        bypassed_new = []
        filtered_old_rows = []
        filtered_new_rows = []

        for r in results:
            f1, f2 = result_features[id(r)]
            if r.match_status.startswith("Bypassed"):
                result_group = "BYPASSED"
            elif r.match_status.startswith("Filtered"):
                result_group = "FILTERED"
            else:
                result_group = "ANOMALY"
            row = format_row(
                r.feature_old_id, r.feature_new_id, r.match_status, result_group, r.odo_diff,
                old_feature=f1, new_feature=f2
            )
            if r.match_status == "Matched":
                anomaly_matched.append(row)
            elif r.match_status == "Only OLD":
                anomaly_only_old.append(row)
            elif r.match_status == "Only NEW":
                anomaly_only_new.append(row)
            elif r.match_status == "Bypassed OLD":
                bypassed_old.append(row)
            elif r.match_status == "Bypassed NEW":
                bypassed_new.append(row)
            elif r.match_status == "Filtered OLD":
                filtered_old_rows.append(row)
            elif r.match_status == "Filtered NEW":
                filtered_new_rows.append(row)

        output_rows = [
            *gw_locked,
            *gw_unmatched,
            *anomaly_matched,
            *anomaly_only_old,
            *anomaly_only_new,
            *bypassed_old,
            *bypassed_new,
            *filtered_old_rows,
            *filtered_new_rows,
        ]
        json_output = {
            "gw_locked": gw_locked,
            "gw_unmatched": gw_unmatched,
            "anomaly_matched": anomaly_matched,
            "anomaly_only_old": anomaly_only_old,
            "anomaly_only_new": anomaly_only_new,
            "bypassed_old": bypassed_old,
            "bypassed_new": bypassed_new,
            "filtered_old": filtered_old_rows,
            "filtered_new": filtered_new_rows,
            "audit": self._build_conservation_audit(
                anomalies_1_all,
                anomalies_2_all,
                output_rows,
            ),
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
