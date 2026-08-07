import sys
import json
import os
import pandas as pd
import numpy as np
import bisect
import math
import re
from dataclasses import dataclass
from datetime import date
from models import SessionLocal, ILIFeature, AlignmentResult, AlignmentSession
from tiein_transform import prepare_transform, validated_tiein_knots


class EmptyDatasetError(RuntimeError):
    """Raised when a run has no comparable anomalies on one or both sides."""


@dataclass(frozen=True)
class SectionCompilation:
    sections: list[dict]
    errors: list[str]

    @property
    def is_valid(self) -> bool:
        return not self.errors

_THOUSANDS_SEPARATED = re.compile(r"^-?\d{1,3}(?:,\d{3})+(?:\.\d+)?$")

# Every vendor writes a merged corrosion group differently — "CLUSTER
# corrosion", "Corrosion CLUSTER", "Clustered metal loss", "Corrosion
# clustering" — but all of them carry the word itself in one of the
# classification columns.  Matching on the word, not on a fixed label, is what
# makes this survive a new vendor export.
CLUSTER_LABEL_PATTERN = re.compile(r"\b(?:cluster|klaster|kluster)s?(?:ed|ing)?\b", re.IGNORECASE)

CLUSTER_BYPASS_REASON = "Clustered metal loss — excluded from alignment"

# Pipe furniture an ILI reports alongside the anomalies.  Each entry is one
# identity class: a bend is only ever paired with a bend, a valve only with a
# valve.  Pairing is by *order* within the class — the n-th bend of the old run
# is the n-th bend of the new one — because that is the only thing about a
# fitting that survives an odometer that drifted.  Nothing outside this table is
# ever paired; an unrecognised label stays a bypass row rather than becoming a
# guess.
FITTING_CLASS_PATTERNS = (
    ("Valve", re.compile(r"\bvalve\b", re.IGNORECASE)),
    ("Tee / offtake", re.compile(r"\btee\b|\boff[\s_-]?take\b|\bbranch(?:\s+connection)?\b", re.IGNORECASE)),
    ("Flange", re.compile(r"\bflang(?:e|ed)\b", re.IGNORECASE)),
    ("Bend", re.compile(r"\b(?:bend|elbow)\b", re.IGNORECASE)),
    ("Launcher / receiver", re.compile(r"\b(?:launcher|receiver|pig\s*trap)\b", re.IGNORECASE)),
    ("Anode", re.compile(r"\banodes?\b", re.IGNORECASE)),
    ("Casing", re.compile(r"\bcasing\b", re.IGNORECASE)),
    ("Support", re.compile(r"\b(?:support|clamp|saddle)\b", re.IGNORECASE)),
    ("Marker", re.compile(r"\bmarker\b|\bmagnet\b", re.IGNORECASE)),
    ("Sleeve / repair", re.compile(r"\bsleeve\b|\brepair\b", re.IGNORECASE)),
    ("Reducer", re.compile(r"\breducer\b|\bswage\b", re.IGNORECASE)),
    ("Tap / stub", re.compile(r"\btapp?(?:ing)?\b|\bstub\b|\bnozzle\b", re.IGNORECASE)),
)

# How far a fitting may have moved on the odometer, after the girth-weld offset
# table has already been applied, and still be the same fitting.  Deliberately
# looser than the anomaly gate: the sequence and the class carry the identity
# here, and the distance is only a guard against pairing across a whole section.
DEFAULT_FITTING_DISTANCE_TOLERANCE_M = 10.0


def _coerce_distance(value):
    """Parse an odometer value, or return None when it is not a real number.

    Returning None rather than 0.0 is the whole point: a feature whose distance
    could not be read must be excluded from matching, not silently placed at
    chainage zero.  Excel error values ("#N/A"), blanks and text all yield None.
    """
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value) if math.isfinite(float(value)) else None

    text = str(value).strip()
    if not text or text.lower() in {"none", "nan", "n/a", "na", "-", "#n/a", "null"}:
        return None
    # "12,345.6" is a thousands-separated metre value, not a European decimal.
    if _THOUSANDS_SEPARATED.match(text):
        text = text.replace(",", "")
    try:
        parsed = float(text)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def safe_int(val):
    try:
        v = str(val).strip()
        if not v or v.lower() == 'none' or v.lower() == 'nan':
            return None
        return int(float(v))
    except (TypeError, ValueError):
        return None


def _first_present(record, *keys):
    """Return the first value that is present, treating 0/0.0 as real readings.

    ``a or b`` fallbacks silently discarded legitimate falsy values: a depth of
    0.0 %WT (or length/width/clock 0) fell through to the wrong key, usually
    became None, and skipped the physics checks for that feature.  Only None
    and blank/whitespace strings count as missing here.
    """
    for key in keys:
        value = record.get(key)
        if value is None:
            continue
        if isinstance(value, str) and not value.strip():
            continue
        return value
    return None


class HungarianAnomalyAlignmentEngine:
    """
    Two-phase ILI alignment engine:
      Phase 1 — GW match (stored in AlignmentSession params_json)
      Phase 2 — Segment-based Hungarian algorithm for anomaly matching
      
      Anomalies are strictly matched within segments bounded by locked GWs.
    """

    INF_COST = 1e9
    # Dense matrix + Python DP and the sparse Fenwick solver optimise exactly the
    # same objective (maximum cardinality, then minimum cost) over exactly the
    # same admissible pairs: `build_sparse_cost_edges` enumerates the distance
    # window that `pair_cost` would gate on anyway. The dense path is therefore
    # only worth taking while the matrix is small enough that building edge
    # tuples costs more than filling it — at 250,000 cells it was several
    # seconds of numpy scalar boxing per segment for no different answer.
    MAX_DENSE_ALIGNMENT_CELLS = int(os.getenv("MAX_DENSE_ALIGNMENT_CELLS", "2000"))

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
        settings = self.resolve_cost_settings(tolerance_overrides)
        upstream = settings["us_gw_distance_tolerance"]
        downstream = settings["ds_gw_distance_tolerance"]
        score = self.pair_cost
        infinite = self.INF_COST
        edges = []
        for old_index, old_feature in enumerate(anomalies_1):
            corrected = old_feature["abs_distance_m"] + self._interpolate_offset(
                old_feature["abs_distance_m"], offset_table, offset_keys,
            )
            first = bisect.bisect_left(new_distances, corrected - upstream)
            last = bisect.bisect_right(new_distances, corrected + downstream)
            for new_index in range(first, last):
                # Scored directly instead of through a 1x1 build_cost_matrix
                # call, which allocated a numpy array and re-resolved every
                # weight and tolerance for each candidate edge.
                cost = score(old_feature, anomalies_2[new_index], corrected, settings)
                if cost < infinite:
                    edges.append((old_index, new_index, float(cost)))
        return edges

    @staticmethod
    def _gw_pair_key(pair: dict) -> str:
        old_id = pair.get("old_id", pair.get("oldId"))
        new_id = pair.get("new_id", pair.get("newId"))
        old_distance = pair.get("old_odometer", pair.get("oldVal", pair.get("oldDist")))
        new_distance = pair.get("new_odometer", pair.get("newVal", pair.get("newDist")))

        def formatted(value):
            # Orphan pairs legitimately miss one odometer; the key must stay
            # stable instead of raising on float(None).
            return "None" if value is None else f"{float(value):.6f}"

        return f"{old_id}::{new_id}::{formatted(old_distance)}::{formatted(new_distance)}"

    @classmethod
    def compile_sections(cls, raw_sections: list[dict], locked_gw_pairs: list[dict]) -> SectionCompilation:
        if not raw_sections:
            return SectionCompilation([], [])

        locked_by_key = {
            cls._gw_pair_key(pair): (index, pair)
            for index, pair in enumerate(locked_gw_pairs)
        }
        locked_new_distances = [float(pair["new_odometer"]) for pair in locked_gw_pairs]
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

        def project_distance(distance: float, from_key: str, to_key: str):
            if not locked_gw_pairs:
                return None
            if len(locked_gw_pairs) == 1:
                pair = locked_gw_pairs[0]
                return distance + (float(pair[to_key]) - float(pair[from_key]))
            source = [float(pair[from_key]) for pair in locked_gw_pairs]
            target = [float(pair[to_key]) for pair in locked_gw_pairs]
            upper = bisect.bisect_left(source, distance)
            if upper <= 0:
                upper = 1
            elif upper >= len(source):
                upper = len(source) - 1
            lower = upper - 1
            span = source[upper] - source[lower]
            if span == 0:
                return None
            return target[lower] + ((distance - source[lower]) / span) * (target[upper] - target[lower])

        def resolve_boundary(section: dict, edge: str, label: str):
            key = str(section.get(f"{edge}GwKey", ""))
            locked_entry = locked_by_key.get(key)
            if locked_entry:
                _, pair = locked_entry
                return float(pair["old_odometer"]), float(pair["new_odometer"])

            boundary = section.get(f"{edge}Boundary")
            if not isinstance(boundary, dict):
                errors.append(f"{label}: {edge} boundary evidence is unavailable")
                return None
            side = str(boundary.get("side", "")).upper()
            source_id = boundary.get("oldId") if side == "OLD" else boundary.get("newId")
            opposite_id = boundary.get("newId") if side == "OLD" else boundary.get("oldId")
            try:
                old_distance = float(boundary.get("oldDistance"))
                new_distance = float(boundary.get("newDistance"))
                source_distance = float(boundary.get("sourceDistance"))
            except (TypeError, ValueError):
                errors.append(f"{label}: {edge} boundary distances are invalid")
                return None
            measured_distance = old_distance if side == "OLD" else new_distance
            projected_distance = (
                project_distance(old_distance, "old_odometer", "new_odometer")
                if side == "OLD"
                else project_distance(new_distance, "new_odometer", "old_odometer")
            )
            supplied_projection = new_distance if side == "OLD" else old_distance
            expected_key = f"UNMATCHED::{side}::{source_id or ''}::{source_distance:.6f}"
            if (
                side not in {"OLD", "NEW"}
                or not str(source_id or "").strip()
                or opposite_id not in {None, ""}
                or not all(math.isfinite(value) and value >= 0 for value in (
                    old_distance, new_distance, source_distance
                ))
                or abs(source_distance - measured_distance) > 1e-6
                or boundary.get("key") != key
                or key != expected_key
            ):
                errors.append(f"{label}: {edge} boundary evidence is invalid")
                return None
            if projected_distance is None or abs(projected_distance - supplied_projection) > 1e-6:
                errors.append(f"{label}: {edge} boundary projection does not match locked GW evidence")
                return None
            return old_distance, new_distance

        for section_index, section in enumerate(raw_sections):
            label = str(section.get("name") or section.get("id") or f"Section {section_index + 1}")
            start_boundary = resolve_boundary(section, "start", label)
            end_boundary = resolve_boundary(section, "end", label)
            if not start_boundary or not end_boundary:
                continue

            old_start, new_start = start_boundary
            old_end, new_end = end_boundary
            if new_start >= new_end or old_start >= old_end:
                errors.append(f"{label}: end GW must be downstream on OLD and NEW")
                continue
            start_index = bisect.bisect_right(locked_new_distances, new_start) - 1
            end_index = bisect.bisect_left(locked_new_distances, new_end)

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
                "old_start": old_start,
                "old_end": old_end,
                "new_start": new_start,
                "new_end": new_end,
            })

        compiled.sort(key=lambda item: (item["new_start"], item["new_end"]))
        for previous, current in zip(compiled, compiled[1:]):
            if current["new_start"] < previous["new_end"]:
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
        self._cached_session = self.session.query(AlignmentSession).filter(AlignmentSession.id == self.session_id).first()
        self._effective_params = None
        params_json = self._session_params()
        if params_json:
            old_run, new_run, self.swap_persisted_runs = self._resolve_run_bindings(params_json)
            # Never fabricate survey years.  Defaulting to current_year-5 /
            # current_year made growth rates computed against an invented
            # 5-year span look exactly like real engineering numbers.  Missing
            # years now disable growth output and raise MISSING_SURVEY_YEAR.
            self.run_1_year = self._run_year(old_run)
            self.run_2_year = self._run_year(new_run)
            self._run_1_meta = old_run or {}
            self._run_2_meta = new_run or {}
        else:
            self.swap_persisted_runs = False
            self.run_1_year = None
            self.run_2_year = None
            self._run_1_meta = {}
            self._run_2_meta = {}

    @staticmethod
    def _run_year(run: dict) -> int | None:
        try:
            return int(float(run.get("year") or run.get("surveyYear")))
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _run_date(run: dict):
        """The inspection date a run reports, when it reports one."""
        for key in ("inspectionDate", "iliDate", "surveyDate", "date", "uploadedAt"):
            value = run.get(key) if isinstance(run, dict) else None
            if value in (None, ""):
                continue
            text = str(value).strip()
            # Accept a full ISO timestamp as well as a bare calendar date.
            try:
                return date.fromisoformat(text[:10])
            except ValueError:
                continue
        return None

    def _growth_year_span(self) -> float | None:
        """Years between the two inspections, or None when it cannot be known.

        Survey *years* are whole numbers, so a November 2019 run compared with a
        February 2023 run measured a four-year interval for 3.25 years of actual
        corrosion — a 23 % error carried into every growth rate, remnant life and
        due date derived from it. Reported inspection dates are used whenever
        both runs carry one; the year difference remains the fallback, because
        many vendor exports record nothing finer.
        """
        old_date = self._run_date(getattr(self, "_run_1_meta", None) or {})
        new_date = self._run_date(getattr(self, "_run_2_meta", None) or {})
        if old_date is not None and new_date is not None:
            span = (new_date - old_date).days / 365.25
            return span if span > 0 else None
        if self.run_1_year is None or self.run_2_year is None:
            return None
        return float(self.run_2_year - self.run_1_year)

    def _missing_survey_year_warnings(self) -> list[dict]:
        """Result-payload warnings, in the physics_warnings entry style."""
        missing = [
            label
            for label, year in (("OLD", self.run_1_year), ("NEW", self.run_2_year))
            if year is None
        ]
        if not missing:
            return []
        return [{
            "code": "MISSING_SURVEY_YEAR",
            "severity": "REVIEW",
            "message": (
                "Survey year is missing for run(s): " + ", ".join(missing)
                + "; depth/length growth rates were not computed."
            ),
        }]

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

    def _canonical_locked_pairs(self, gw_matches_final: list[dict]) -> list[dict]:
        """Order locked GW pairs exactly the way ``get_gw_matches`` orders them.

        ``seg_id`` is an index into the segments derived from ``get_gw_matches``
        (swap-normalised, filtered to MATCH/MATCHED, sorted by OLD odometer),
        while section boundaries are indices into this list.  Building this list
        any other way — unfiltered, or sorted by NEW odometer — puts the two in
        different index spaces, so a BYPASS/REVIEW section silently applies to a
        different physical stretch of pipe.
        """
        canonical = []
        for persisted_pair in gw_matches_final:
            logical = self._logical_gw_pair(persisted_pair)
            if str(logical.get("status", "MATCHED")).upper() not in {"MATCH", "MATCHED"}:
                continue
            old_odometer = _coerce_distance(logical.get("old_odometer"))
            new_odometer = _coerce_distance(logical.get("new_odometer"))
            if old_odometer is None or new_odometer is None:
                continue
            logical["old_odometer"] = old_odometer
            logical["new_odometer"] = new_odometer
            canonical.append(logical)
        return sorted(canonical, key=lambda pair: pair["old_odometer"])

    @staticmethod
    def _assert_monotonic_gw_pairs(gw_pairs: list[dict]) -> None:
        """Segment boundaries must increase strictly on both axes.

        ``run2_boundaries`` is built from a list sorted by OLD odometer and then
        fed to ``bisect_right``.  One crossed GW lock (NEW order disagreeing with
        OLD order, which a manual GW edit can easily produce) makes it
        non-monotonic, and bisect then returns a meaningless index: a whole block
        of NEW anomalies lands in the wrong segment and is reported as "Only
        NEW" while its OLD partners become "Only OLD".  Silent and wrong, so it
        must be checked unconditionally rather than only when sections exist.
        """
        for previous, current in zip(gw_pairs, gw_pairs[1:]):
            if float(current["oldVal"]) <= float(previous["oldVal"]) or \
                    float(current["newVal"]) <= float(previous["newVal"]):
                raise ValueError(
                    "Locked GW pairs must increase strictly on both OLD and NEW; "
                    f"pair at OLD={previous['oldVal']}/NEW={previous['newVal']} is "
                    f"followed by OLD={current['oldVal']}/NEW={current['newVal']}. "
                    "Re-run GW matching or correct the crossed lock."
                )

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
        except (TypeError, ValueError): return None

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

    def _get_session(self) -> AlignmentSession | None:
        if not hasattr(self, '_cached_session') or self._cached_session is None:
            self._cached_session = self.session.query(AlignmentSession).filter(AlignmentSession.id == self.session_id).first()
        return self._cached_session

    def _session_params(self) -> dict:
        """The configuration this run must use.

        Chain alignment runs this engine once per run pair, each with its own
        tie-in transform, GW locks and sections.  The worker hands that over in a
        file instead of rewriting the shared ``alignment_sessions`` row, which
        every pair would otherwise contend for and which stayed corrupted if a
        pair crashed mid-loop.  The ORM row is deliberately never mutated here:
        this engine commits results, and a dirty ``params_json`` would be flushed
        along with them.
        """
        if getattr(self, "_effective_params", None) is not None:
            return self._effective_params

        override_path = os.environ.get("ALIGNMENT_PAIR_CONFIG_FILE")
        if override_path:
            # Falling back to the session row here would align the pair the row
            # happens to describe while reporting it as this pair's result.
            with open(override_path, "r", encoding="utf-8") as handle:
                self._effective_params = json.load(handle)
        else:
            sess = self._get_session()
            self._effective_params = dict(sess.params_json) if sess and sess.params_json else {}
        return self._effective_params

    def fetch_data(self, is_old_run: bool) -> list[dict]:
        try:
            params_json = self._session_params()
            if not params_json:
                return []

            old_run, new_run, swap_persisted_runs = self._resolve_run_bindings(params_json)
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
                params_json.get(
                    "globalOffset",
                    params_json.get("tieInOffset", 0.0),
                )
            )
            tie_in_knots = validated_tiein_knots(params_json)
            # Prepared once for the whole run: the knot search axis is O(knots)
            # to build and this loop runs once per feature.
            tie_in_transform = prepare_transform(tie_in_knots) if tie_in_knots else None


            # Map them into the format expected by the engine (abs_distance_m, id, depth_pct, length_mm, width_mm)
            mapped = []
            invalid_distance_count = 0
            for f in features:
                # Distance is the one load-bearing field in this engine.  A
                # fallback of 0.0 is never physically valid: it silently
                # relocates the feature to the pipe head, where it lands in
                # segment 0 and can be matched against an unrelated anomaly.
                # Unparseable rows are flagged and routed to the Filtered
                # buckets instead, which preserves row conservation while
                # keeping them out of the cost matrix.
                abs_dist = _coerce_distance(f.get("log_distance_m"))
                if abs_dist is None:
                    abs_dist = _coerce_distance(f.get("dist"))
                invalid_distance = abs_dist is None
                tiein_outside_domain = False

                if invalid_distance:
                    invalid_distance_count += 1
                    abs_dist = 0.0
                    source_abs_dist = 0.0
                else:
                    source_abs_dist = abs_dist
                    if is_old_run and tie_in_transform is not None:
                        master_distance = tie_in_transform(abs_dist)
                        tiein_outside_domain = master_distance is None
                        if master_distance is not None:
                            abs_dist = master_distance
                    elif not tie_in_knots and not is_old_run and tie_in_offset != 0.0:
                        abs_dist += tie_in_offset

                depth = _first_present(f, "depth_pct", "depth")
                try:
                    depth = float(depth) if str(depth).strip() else None
                except (TypeError, ValueError):
                    depth = None

                length = _first_present(f, "length_mm", "length")
                try:
                    length = float(length) if str(length).strip() else None
                except (TypeError, ValueError):
                    length = None

                width = _first_present(f, "width_mm", "width")
                try:
                    width = float(width) if str(width).strip() else None
                except (TypeError, ValueError):
                    width = None
                    
                dist_gw = self._read_us_gw_distance(f)
                    
                # Prefer the pre-converted 'clock' field from the frontend upload,
                # fall back to raw column values, and convert Excel time serials.
                clock = _first_present(f, "clock", "clock_position", "orientation")
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
                    "id": str(_first_present(f, "id", "feature_id")),
                    "abs_distance_m": abs_dist,
                    "source_abs_distance_m": source_abs_dist,
                    "tiein_outside_domain": tiein_outside_domain,
                    "invalid_distance": invalid_distance,
                    "filter_reason": "unparseable_log_distance" if invalid_distance else None,
                    "depth_pct": depth,
                    "length_mm": length,
                    "width_mm": width,
                    "dist_to_us_gw_m": dist_gw,
                    "clock_position": clock,
                    "originalType": str(f.get("feature_type") or f.get("originalType") or "").lower(),
                    "raw": f
                })
                
            if invalid_distance_count:
                print(
                    f"[WARN] {invalid_distance_count} feature(s) had an unparseable "
                    f"log distance and were routed to the Filtered bucket",
                    file=sys.stderr,
                )

            return sorted(mapped, key=lambda x: x["abs_distance_m"])
        except Exception as e:
            # Never swallow this.  Returning [] here printed to stdout and let
            # the process exit 0, so Node stored an empty comparison as a
            # *successful* alignment — a silently blank report.
            print(f"[ERROR] Failed to read run data: {e}", file=sys.stderr)
            raise

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
                
            params_json = self._session_params()
            if not params_json:
                print(f"[WARN] No AlignmentSession found for id={self.session_id}")
                return []

            gw_pairs_final = params_json.get("gwMatchesFinal", [])
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
                    for pair in params_json.get("gwMatches", [])
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
            # Same reasoning as fetch_data: an unreadable GW lock set must fail
            # the run, not quietly degrade it to "no locks".
            print(f"[ERROR] Failed to fetch GW matches: {e}", file=sys.stderr)
            raise

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

    @staticmethod
    def _is_filtered_feature(feature: dict) -> bool:
        # A feature is excluded from matching when the tie-in transform cannot
        # place it, or when its odometer could not be read at all.
        return bool(feature.get("tiein_outside_domain") or feature.get("invalid_distance"))

    def _partition_scenario_features(self, features: list[dict]):
        """Depth is post-match physics evidence, never a candidate filter."""
        return (
            [feature for feature in features if not self._is_filtered_feature(feature)],
            [feature for feature in features if self._is_filtered_feature(feature)],
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
    def _classification_labels(feature: dict) -> tuple[str, ...]:
        """The columns a vendor uses to classify a feature.

        Free-text columns such as ``comment`` are deliberately excluded: a
        remark reading "not a cluster" must not reclassify the row.
        """
        raw = feature.get("raw", {}) or {}
        return (
            str(feature.get("originalType") or ""),
            str(raw.get("feature_type") or ""),
            str(raw.get("type") or ""),
            str(raw.get("feature_identification") or ""),
            str(raw.get("dim_classification") or ""),
        )

    @classmethod
    def _is_cluster_feature(cls, feature: dict) -> bool:
        """A clustered metal-loss record: a vendor-merged group, not one defect.

        Its reported extent is a bounding box over several pits, and the vendor
        regroups those pits differently on every run — the same corrosion can
        be one cluster in the OLD report and three in the NEW one.  Pairing a
        cluster across runs therefore compares two different populations of
        metal loss, and any growth rate that comes out of it is an artefact of
        the grouping, not of corrosion.

        Clusters are conserved as bypass rows instead: they stay in the result
        table in distance order and still feed ERF / FFS, which read the
        reported dimensions of a single run.  The exclusion is from *alignment*
        only, never from the report.
        """
        return any(
            CLUSTER_LABEL_PATTERN.search(label)
            for label in cls._classification_labels(feature)
        )

    @classmethod
    def _is_matchable_anomaly(cls, feature: dict) -> bool:
        """Only anomaly / metal-loss records are eligible for Hungarian.

        Clustered records are anomalies but are never eligible; see
        ``_is_cluster_feature`` for why.
        """
        if cls._is_cluster_feature(feature):
            return False
        feature_type = str(feature.get("originalType", "")).strip().lower()
        raw_type = str(feature.get("raw", {}).get("type", "")).strip().lower()
        return feature_type in {"anomaly", "metal loss", "metal_loss"} or raw_type == "anomaly"

    @staticmethod
    def _gw_feature_labels(feature: dict) -> tuple[str, str]:
        raw = feature.get("raw", {})
        primary = str(
            feature.get("originalType")
            or raw.get("feature_type")
            or raw.get("type")
            or raw.get("originalType")
            or ""
        ).strip().lower()
        identification = str(raw.get("feature_identification") or "").strip().lower()
        if not primary or primary in {"other", "unknown", "unclassified"}:
            primary = identification
        return primary, identification

    @classmethod
    def _is_dtw_anchor_feature(cls, feature: dict) -> bool:
        """Tier-1/Tier-2 anchors that Phase 1 (DTW) is actually able to match.

        Must stay in step with ``dtw_engine.process_request``'s
        ``gw_types = {'weld', 'valve', 'tee'}`` and its ``_alignment_feature_kind``
        normalisation.  If a feature is in this set and Phase 1 did not consume
        it, that is genuine missing evidence.
        """
        primary, _identification = cls._gw_feature_labels(feature)
        return bool(re.search(
            r"\b(?:weld|girth|seam|valve|tee|offtake|branch(?:\s+connection)?)\b",
            primary,
        ))

    @classmethod
    def _is_structural_feature(cls, feature: dict) -> bool:
        """Physical fittings that are neither anomalies nor DTW anchors.

        DTW deliberately excludes these ("strict Tier-1/Tier-2 anchors only"),
        so they can never be consumed by Phase 1.  Reporting them as unmatched
        girth welds turned every bend and flange into permanent phantom missing
        evidence — a pipeline with 200 bends showed 400 unmatched GWs on every
        single run.  They are conserved as bypass rows instead.
        """
        primary, identification = cls._gw_feature_labels(feature)
        if re.search(r"\bflang(?:e|ed)\b", primary) or re.search(
            r"\bflang(?:e|ed)\b", identification
        ):
            return True
        return bool(re.search(r"\b(?:bend|elbow|launcher|receiver)\b", primary))

    @classmethod
    def _is_gw_feature(cls, feature: dict) -> bool:
        """Whether Phase 1 owns this feature, i.e. it is not an anomaly.

        Union of the two sets above.  Both are kept out of the Hungarian cost
        matrix; they differ only in how an unconsumed one is reported.
        """
        return cls._is_dtw_anchor_feature(feature) or cls._is_structural_feature(feature)

    @classmethod
    def _fitting_class(cls, feature: dict) -> str | None:
        """Which identity class this fitting belongs to, or None if unknown.

        A clustered record is never a fitting, and an unrecognised label returns
        None so it keeps flowing to the bypass bucket instead of being paired
        against something it may have nothing to do with.
        """
        if cls._is_cluster_feature(feature):
            return None
        primary, identification = cls._gw_feature_labels(feature)
        haystack = f"{primary} {identification}"
        for name, pattern in FITTING_CLASS_PATTERNS:
            if pattern.search(haystack):
                return name
        return None

    def match_fittings_in_order(
        self,
        old_features: list[dict],
        new_features: list[dict],
        offset_table: list[tuple[float, float]],
        offset_keys: list[float] | None = None,
        tolerance_m: float | None = None,
    ) -> tuple[list[tuple[dict, dict]], list[dict], list[dict]]:
        """Pair pipe furniture across the two runs, in order, within its class.

        Bends, valves, tees and flanges are physical objects that do not appear,
        disappear or swap places between runs; what changes is the odometer that
        reports them.  So the pairing rule is ordinal: inside one class, the
        sequence of old fittings is aligned to the sequence of new ones without
        ever crossing, and a pair is only kept when the girth-weld offset table
        already brings the two within ``tolerance_m`` of each other.

        Returns the pairs plus whatever is left over on each side.  Leftovers
        are conserved by the caller, never dropped.
        """
        gate = float(
            tolerance_m
            if tolerance_m is not None
            else getattr(self, "fitting_distance_tolerance_m", DEFAULT_FITTING_DISTANCE_TOLERANCE_M)
        )

        def grouped(features: list[dict]) -> dict[str, list[dict]]:
            buckets: dict[str, list[dict]] = {}
            for feature in features:
                name = self._fitting_class(feature)
                if name is None:
                    continue
                buckets.setdefault(name, []).append(feature)
            for bucket in buckets.values():
                bucket.sort(key=lambda item: float(item["abs_distance_m"]))
            return buckets

        old_buckets = grouped(old_features)
        new_buckets = grouped(new_features)

        pairs: list[tuple[dict, dict]] = []
        paired_keys: set = set()

        for name, olds in old_buckets.items():
            news = new_buckets.get(name)
            if not news:
                continue
            # Only pairs already inside the gate can ever be selected, so the
            # candidate set is found by binary search on the sorted NEW
            # distances rather than by filling an olds x news matrix. A line
            # with 3,000 bends per run used to allocate nine million cells and
            # run the pure-Python DP across all of them, which is what pushed
            # large runs into ALIGNMENT_PROCESS_TIMEOUT.
            new_distances = [float(feature["abs_distance_m"]) for feature in news]
            edges = []
            for old_index, old_feature in enumerate(olds):
                corrected = float(old_feature["abs_distance_m"]) + self._interpolate_offset(
                    float(old_feature["abs_distance_m"]), offset_table, offset_keys,
                )
                first = bisect.bisect_left(new_distances, corrected - gate)
                last = bisect.bisect_right(new_distances, corrected + gate)
                for new_index in range(first, last):
                    # Distance is the whole cost: the ordering constraint is
                    # already enforced by the solver, so the only thing left
                    # to prefer is the closer of two otherwise equal options.
                    edges.append(
                        (old_index, new_index, abs(new_distances[new_index] - corrected))
                    )
            for old_index, new_index in self.solve_sparse_monotonic_assignment(
                len(olds), len(news), edges,
            ):
                old_feature = olds[old_index]
                new_feature = news[new_index]
                pairs.append((old_feature, new_feature))
                paired_keys.add(("old", old_feature.get("source_key")))
                paired_keys.add(("new", new_feature.get("source_key")))

        unmatched_old = [
            feature for feature in old_features
            if ("old", feature.get("source_key")) not in paired_keys
        ]
        unmatched_new = [
            feature for feature in new_features
            if ("new", feature.get("source_key")) not in paired_keys
        ]
        return pairs, unmatched_old, unmatched_new

    @classmethod
    def _partition_hungarian_features(cls, features: list[dict]):
        """Split Phase-2 input without re-emitting any Phase-1 GW feature."""
        # Phase ownership is determined by feature type, not identifier alone.
        # IDs are not guaranteed unique across vendor exports; filtering every
        # row whose ID appears in a GW lock can silently remove an anomaly —
        # which is why this takes no lock-id set at all.
        anomalies: list[dict] = []
        bypassed: list[dict] = []
        for feature in features:
            if cls._is_gw_feature(feature):
                continue
            # Clusters land here too: _is_matchable_anomaly rejects them.
            (anomalies if cls._is_matchable_anomaly(feature) else bypassed).append(feature)
        return anomalies, bypassed

    def resolve_cost_settings(self, tolerance_overrides: dict | None = None) -> dict:
        """Freeze the weights and tolerances one scoring pass will use.

        These are constant for a whole segment, so resolving them per candidate
        edge (which the sparse path did, via a 1x1 ``build_cost_matrix`` call)
        is pure overhead.
        """
        overrides = tolerance_overrides or {}
        # `gw_offset_tolerance` gates the difference between the two runs'
        # reported distance-to-upstream-weld.  It used to reuse
        # `us_gw_distance_tolerance`, which is the *odometer* search window, so
        # one slider silently governed two unrelated physical quantities: an
        # engineer widening the odometer window to accept a drifted run also
        # loosened the weld-relative gate that is the strongest identity
        # evidence in the record.  It defaults to the odometer window so a saved
        # session's numbers do not move until the value is set explicitly.
        upstream_window = float(overrides.get(
            "us_gw_distance_tolerance", self.us_gw_distance_tolerance
        ))
        return {
            "w_gw": float(getattr(self, "w_gw", 3.0)),
            "w_clock": float(getattr(self, "w_clock", 2.0)),
            "w_length": float(getattr(self, "w_length", 1.0)),
            "w_width": float(getattr(self, "w_width", 0.5)),
            "clock_tolerance": float(overrides.get("clock_tolerance", self.clock_tolerance)),
            "us_gw_distance_tolerance": upstream_window,
            "gw_offset_tolerance": float(overrides.get(
                "gw_offset_tolerance",
                getattr(self, "gw_offset_tolerance", None) or upstream_window,
            )),
            "ds_gw_distance_tolerance": float(overrides.get(
                "ds_gw_distance_tolerance", self.ds_gw_distance_tolerance
            )),
            "length_tolerance": float(overrides.get("length_tolerance", self.length_tolerance)),
            "use_us_gw_distance": overrides.get(
                "use_us_gw_distance", getattr(self, "use_us_gw_distance", True),
            ) is not False,
            "require_us_gw_distance": bool(getattr(self, "require_us_gw_distance", False)),
        }

    def pair_cost(self, old_feature: dict, new_feature: dict,
                  corrected_distance: float, settings: dict) -> float:
        """Cost of one candidate pair, or ``INF_COST`` when a gate rejects it.

        The single source of truth for pair scoring: the dense matrix builder
        fills its cells with this, and the sparse edge loop calls it directly
        instead of allocating a 1x1 matrix per edge.

        ``corrected_distance`` is the OLD odometer already shifted onto the NEW
        axis by the GW offset table; the caller resolves it once per OLD
        feature rather than once per pair.
        """
        signed_distance = new_feature["abs_distance_m"] - corrected_distance
        distance_tolerance = (
            settings["ds_gw_distance_tolerance"]
            if signed_distance >= 0
            else settings["us_gw_distance_tolerance"]
        )
        # Keep the historical base tolerance as a floor.  The UI values
        # refine the directional tolerance but must not make an existing
        # valid alignment disappear merely because the default was 0.5 m.
        # EDIT: Removed 0.5m floor to strictly obey UI input
        if abs(signed_distance) > distance_tolerance:
            return self.INF_COST

        gw_offset_tolerance = settings["gw_offset_tolerance"]
        use_us_gw_distance = settings["use_us_gw_distance"]
        base_cost = 0.0

        # 1. GW Penalty. Compares how far each run placed the feature from its
        # own upstream weld — a weld-relative quantity, gated independently of
        # the absolute odometer window above.
        gw1 = old_feature.get("dist_to_us_gw_m")
        gw2 = new_feature.get("dist_to_us_gw_m")
        if (
            use_us_gw_distance
            and settings["require_us_gw_distance"]
            and (gw1 is None or gw2 is None)
        ):
            return self.INF_COST
        if use_us_gw_distance and gw1 is not None and gw2 is not None:
            gw_distance_difference = abs(abs(gw1) - abs(gw2))
            if gw_distance_difference > gw_offset_tolerance:
                return self.INF_COST
            base_cost += settings["w_gw"] * (
                gw_distance_difference / max(gw_offset_tolerance, 0.001)
            )

        # 2. Clock Penalty
        clock_tolerance = settings["clock_tolerance"]
        cd = self._clock_diff(
            old_feature.get("clock_position"), new_feature.get("clock_position")
        )
        if cd is not None:
            if cd > clock_tolerance:
                return self.INF_COST
            base_cost += settings["w_clock"] * (cd / max(clock_tolerance, 1.0))

        # 3. Length Penalty. Depth is deliberately excluded from pair
        # selection and evaluated only after Hungarian as a physical
        # growth/decrease warning.
        length_tolerance = settings["length_tolerance"]
        l1, l2 = old_feature.get("length_mm"), new_feature.get("length_mm")
        if l1 is not None and l2 is not None:
            length_difference = abs(l1 - l2)
            if length_difference > length_tolerance:
                return self.INF_COST
            base_cost += settings["w_length"] * (
                length_difference / max(length_tolerance, 1.0)
            )

        # 4. Width Penalty
        wid1, wid2 = old_feature.get("width_mm"), new_feature.get("width_mm")
        if wid1 is not None and wid2 is not None:
            base_cost += settings["w_width"] * (min(abs(wid1 - wid2), 200.0) / 200.0)

        return base_cost

    def build_cost_matrix(
        self,
        anomalies_1: list[dict],
        anomalies_2: list[dict],
        offset_table: list[tuple[float, float]],
        offset_keys: list[float] = None,
        tolerance_overrides: dict | None = None,
    ) -> np.ndarray:
        """Dense scoring wrapper around :meth:`pair_cost`."""
        cost = np.full((len(anomalies_1), len(anomalies_2)), self.INF_COST, dtype=float)
        settings = self.resolve_cost_settings(tolerance_overrides)
        score = self.pair_cost

        for i, f1 in enumerate(anomalies_1):
            corrected_dist = f1["abs_distance_m"] + self._interpolate_offset(
                f1["abs_distance_m"], offset_table, offset_keys
            )
            row = cost[i]
            for j, f2 in enumerate(anomalies_2):
                row[j] = score(f1, f2, corrected_dist, settings)

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
            # Exiting 0 here emitted no result markers at all, and Node's
            # brace-scanning fallback then stored an empty comparison as a
            # completed alignment.  Fail loudly instead.
            raise EmptyDatasetError(
                f"Empty dataset: OLD={len(anomalies_1_all)} NEW={len(anomalies_2_all)}"
            )

        print("[2/5] Loading GW Matches from DB & Creating Segments...")
        gw_pairs = self.get_gw_matches()
        offset_table = self._build_offset_table(gw_pairs)
        offset_keys = [x[0] for x in offset_table] if offset_table else []

        # The Node worker invokes this script with a session id only, so the
        # persisted (or per-pair overridden) configuration is authoritative.
        params_json = self._session_params()
        # Matcher gates come from the persisted combined rules/tolerances step.
        # Legacy top-level distThresh is intentionally ignored because it was
        # never part of the engine contract.
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
        if "gw_offset_tolerance" in tol_config:
            self.gw_offset_tolerance = float(tol_config["gw_offset_tolerance"])
        if "length_tolerance" in tol_config:
            self.length_tolerance = float(tol_config["length_tolerance"])
        if "w_gw" in tol_config:
            self.w_gw = float(tol_config["w_gw"])
        if "w_clock" in tol_config:
            self.w_clock = float(tol_config["w_clock"])
        if "w_length" in tol_config:
            self.w_length = float(tol_config["w_length"])
        if "w_width" in tol_config:
            self.w_width = float(tol_config["w_width"])
        self.fitting_distance_tolerance_m = float(tol_config.get(
            "fitting_distance_tolerance", DEFAULT_FITTING_DISTANCE_TOLERANCE_M,
        ))

        gw_matches_final = [
            self._logical_gw_pair(pair)
            for pair in params_json.get("gwMatchesFinal", [])
        ]
        gw_orphans = [
            self._logical_gw_pair(pair)
            for pair in params_json.get("gwOrphans", [])
        ]

        # Legacy Fallback: If gwMatchesFinal is empty, try to reconstruct from gwMatches
        try:
            if not gw_matches_final and "gwMatches" in params_json:
                legacy_gws = params_json["gwMatches"]
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

        # Same filter, same swap normalisation and same ordering as gw_pairs, so
        # a section's start_index/end_index address the same pairs that seg_id
        # is derived from.
        locked_gw_pairs = self._canonical_locked_pairs(gw_matches_final)

        # Boundaries feed bisect_right on both axes; a crossed lock must fail
        # the run rather than scatter anomalies into the wrong segments.
        self._assert_monotonic_gw_pairs(gw_pairs)

        if len(locked_gw_pairs) != len(gw_pairs):
            raise ValueError(
                "Locked GW pair set is inconsistent with the segment boundaries "
                f"({len(locked_gw_pairs)} sectionable vs {len(gw_pairs)} segments). "
                "Recalculate the canonical GW matching result."
            )

        compiled_sections = self.compile_sections(
            params_json.get("matchingSections", []),
            locked_gw_pairs,
        )
        if not compiled_sections.is_valid:
            raise ValueError("Invalid matching sections: " + "; ".join(compiled_sections.errors))

        print(f"      [Validation] Locked GWs (MatchesFinal): {len(gw_matches_final)}", file=sys.stderr)
        print(f"      [Validation] Orphans GWs: {len(gw_orphans)}", file=sys.stderr)

        # Phase 1 owns every GW/anchor row.  Hungarian receives only anomaly /
        # metal-loss rows, while genuine non-GW features may remain visible in
        # the bypass buckets.  This prevents unmatched GWs from appearing once
        # in gw_unmatched and a second time as Bypassed OLD/NEW.
        anomalies_1, non_anomaly_old = self._partition_hungarian_features(anomalies_1_all)
        anomalies_2, non_anomaly_new = self._partition_hungarian_features(anomalies_2_all)

        print(f"      [Validation] Valid Anomaly Candidates Run1: {len(anomalies_1)} (Out of {len(anomalies_1_all)})", file=sys.stderr)
        print(f"      [Validation] Valid Anomaly Candidates Run2: {len(anomalies_2)} (Out of {len(anomalies_2_all)})", file=sys.stderr)

        # Non-anomaly records stay visible in bypass buckets. Missing depth is
        # not a bypass reason; identity matching must rely on position/shape.
        #
        # Anything that carries a recognised fitting class is held back from the
        # bypass bucket and offered to the ordinal matcher below instead: a
        # support or an anode reported by both runs is the same object, and
        # saying so is more useful than listing it twice as unpaired.
        fitting_pool_old = [f for f in non_anomaly_old if self._fitting_class(f) is not None]
        fitting_pool_new = [f for f in non_anomaly_new if self._fitting_class(f) is not None]
        held_old = {id(f) for f in fitting_pool_old}
        held_new = {id(f) for f in fitting_pool_new}
        excluded_old = [f for f in non_anomaly_old if id(f) not in held_old]
        excluded_new = [f for f in non_anomaly_new if id(f) not in held_new]

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
                # THRESHOLD GATE: drop any pair whose cost reached INF_COST.
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

        # BYPASS MECHANISM: gwOrphans / excluded features pass straight through
        # into the output buckets.
        for f1 in excluded_old:
            append_result(f1, None, "Bypassed OLD")
        for f2 in excluded_new:
            append_result(None, f2, "Bypassed NEW")
        for f1 in filtered_old:
            append_result(f1, None, "Filtered OLD")
        for f2 in filtered_new:
            append_result(None, f2, "Filtered NEW")

        # Mandatory validation counters, logged before returning.
        print(f"\n[VALIDATION] Total Anomaly Input OLD: {len(anomalies_1)}")
        print(f"[VALIDATION] Total Anomaly Input NEW: {len(anomalies_2)}")
        print(f"[VALIDATION] Total Excluded/Bypassed OLD: {len(excluded_old)}")
        print(f"[VALIDATION] Total Excluded/Bypassed NEW: {len(excluded_new)}")
        print(f"[VALIDATION] Matched: {total_matched} | Only OLD (Anom): {total_missing} | Only NEW (Anom): {total_new}")

        # --- Print JSON for Node.js ---
        print("\n[4/5] Outputting structured 5-key JSON for Node.js...")
        
        def index_features_by_id(features):
            index = {}
            for feature in features:
                index.setdefault(str(feature["id"]), []).append(feature)
            return index

        # find_feature runs once per GW row; scanning the full anomaly list
        # every time made result formatting O(n_gw * n_features).  The index
        # keeps candidates in source order, so "first match" semantics are
        # unchanged.
        old_features_by_id = index_features_by_id(anomalies_1_all)
        new_features_by_id = index_features_by_id(anomalies_2_all)

        def find_feature(features_by_id, feature_id, odometer=None, consumed=None):
            """Find a GW source record without silently collapsing duplicate IDs."""
            if feature_id is None:
                return None
            candidates = features_by_id.get(str(feature_id), [])
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
            f1 = old_feature or find_feature(old_features_by_id, old_id_val, old_odometer, consumed_old)
            f2 = new_feature or find_feature(new_features_by_id, new_id_val, new_odometer, consumed_new)
            physics_warnings = self._physics_warnings(f1, f2)
            year_span = self._growth_year_span()
            depth_growth = None
            length_growth = None
            if year_span is not None and year_span > 0 and f1 and f2:
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
            # The bypass bucket holds two very different things — supports and
            # markers that were never anomalies, and clusters that were held
            # back on purpose.  Say which, or the engineer cannot tell whether
            # a missing match is a rule or a defect in the run.
            bypass_reason = "-"
            if any(feature and self._is_cluster_feature(feature) for feature in (f1, f2)):
                bypass_reason = CLUSTER_BYPASS_REASON
            return {
                "session_id": self.session_id,
                "feature_old_id": safe_int(old_id_val) if old_id_val else None,
                "feature_new_id": safe_int(new_id_val) if new_id_val else None,
                "match_status": status,
                "Match/Unmatch": status,
                "Result Group": result_group,
                "Bypass Reason": bypass_reason,
                "Run Year OLD": self.run_1_year,
                "Run Year NEW": self.run_2_year,
                # The interval the rates above were divided by, in decimal
                # years. Consumers must not re-derive it from the two survey
                # years: those are whole numbers, and a Nov-2019 to Feb-2023
                # pair is 3.25 years of corrosion reported as 4.
                "Growth Interval (y)": year_span if year_span is not None else "-",
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
        # here instead of dropping it from both phases.
        #
        # Structural fittings (bends, flanges, launchers) are split out: DTW is
        # never able to match them, so an unconsumed one is expected, not
        # missing evidence.  They pass through as bypass rows.
        leftover_gw_old = []
        leftover_gw_new = []
        for feature in anomalies_1_all:
            if not self._is_gw_feature(feature) or feature["source_key"] in consumed_gw_old:
                continue
            consumed_gw_old.add(feature["source_key"])
            leftover_gw_old.append(feature)
        for feature in anomalies_2_all:
            if not self._is_gw_feature(feature) or feature["source_key"] in consumed_gw_new:
                continue
            consumed_gw_new.add(feature["source_key"])
            leftover_gw_new.append(feature)

        # Ordinal fitting matching.  Everything Phase 1 did not consume plus the
        # recognised furniture held back from the bypass bucket goes in: bends
        # and flanges that DTW is structurally unable to match, and the odd
        # valve or tee it happened to miss.  Pairing is within one class and in
        # sequence, so a run that gained an odometer offset still lines its
        # fittings up with the previous run's.
        fitting_pairs, unpaired_old, unpaired_new = self.match_fittings_in_order(
            leftover_gw_old + fitting_pool_old,
            leftover_gw_new + fitting_pool_new,
            offset_table,
            offset_keys,
        )
        print(
            f"      [Fittings] {len(fitting_pairs)} paired in order "
            f"({len(unpaired_old)} unpaired OLD, {len(unpaired_new)} unpaired NEW)",
            file=sys.stderr,
        )

        fitting_matched = [
            format_row(
                f1["id"], f2["id"], "Matched", "FITTING",
                odo_diff=float(f2["abs_distance_m"]) - float(f1["abs_distance_m"]),
                old_feature=f1, new_feature=f2,
            )
            for f1, f2 in fitting_pairs
        ]

        # Leftovers keep the reporting they always had, so a genuinely missing
        # anchor still reads as missing evidence and a bend still does not.
        structural_old = []
        structural_new = []
        for feature in unpaired_old:
            if self._is_dtw_anchor_feature(feature):
                gw_unmatched.append(format_row(
                    feature["id"], None, "ONLY_OLD", "GW", old_feature=feature,
                ))
            else:
                structural_old.append(format_row(
                    feature["id"], None, "Bypassed OLD", "BYPASSED", old_feature=feature,
                ))
        for feature in unpaired_new:
            if self._is_dtw_anchor_feature(feature):
                gw_unmatched.append(format_row(
                    None, feature["id"], "ONLY_NEW", "GW", new_feature=feature,
                ))
            else:
                structural_new.append(format_row(
                    None, feature["id"], "Bypassed NEW", "BYPASSED", new_feature=feature,
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

        # Structural fittings swept up above are bypass rows, not GW evidence.
        bypassed_old.extend(structural_old)
        bypassed_new.extend(structural_new)

        output_rows = [
            *gw_locked,
            *gw_unmatched,
            *fitting_matched,
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
            "fitting_matched": fitting_matched,
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
        # Warnings live inside `audit` (an object): Node's
        # normalizeComparisonResult flattens every top-level array into the
        # comparison table, so a top-level warnings list would become rows.
        run_warnings = self._missing_survey_year_warnings()
        json_output["audit"]["warnings"] = run_warnings
        for warning in run_warnings:
            print(f"[WARN] {warning['code']}: {warning['message']}", file=sys.stderr)

        result_path = os.environ.get("ALIGNMENT_RESULT_FILE")
        if result_path:
            with open(result_path, "w", encoding="utf-8") as fh:
                json.dump(json_output, fh)
            print(f"___RESULT_FILE___{result_path}")
        else:
            print("___RESULT_JSON_BEGIN___")
            print(json.dumps(json_output))
            print("___RESULT_JSON_END___")
        
        print(f"\n[5/5] Done. Matched: {total_matched} | New: {total_new} | Missing: {total_missing}")
        return results

def main(argv=None):
    argv = sys.argv if argv is None else argv
    session_id = int(argv[1]) if len(argv) > 1 else None

    if not session_id:
        print("[ERROR] No session_id provided", file=sys.stderr)
        return 1

    engine = HungarianAnomalyAlignmentEngine(
        session_id=session_id,
        distance_tolerance_m=0.5,
    )
    try:
        engine.perform_alignment()
    except Exception as error:
        import traceback

        traceback.print_exc(file=sys.stderr)
        print(f"[ERROR] Alignment failed: {error}", file=sys.stderr)
        return 1
    finally:
        engine.session.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
