"""
phylogenetic_engine.py — BullMQ Worker Wrapper for Phylogenetic Alignment
=========================================================================
Reads an alignment session from the database, resolves run bindings for
the phylogenetic (multi-run) strategy, executes the phylogenesis pipeline,
and outputs results in the same JSON format as hungarian_engine.py so the
Node.js worker can normalize them uniformly.

Usage:
    python phylogenetic_engine.py <session_id>

Environment:
    DATABASE_URL          — PostgreSQL connection string
    ALIGNMENT_RESULT_FILE — (optional) path to write JSON output
"""

import sys
import os
import json
import logging
import re
import numpy as np
from dataclasses import asdict

# Add parent paths so engine/phylogenesis and sibling modules resolve
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', '..'))
sys.path.insert(0, os.path.dirname(__file__))

from models import SessionLocal, AlignmentSession, ILIFeature, SurveyRun
from engine.phylogenesis.filogenesis_core import (
    DEFAULT_SAMPLING_INTERVAL_M,
    MAX_SIGNAL_SAMPLES,
    resolve_sampling_interval,
)
from engine.phylogenesis.pipeline_service import (
    run_phylogenetic_alignment,
    load_ancestral_anchors,
    load_features,
)

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("phylogenetic_engine")

# Mirrors dtw_engine._alignment_feature_kind's weld classification: 'Weld',
# 'Girth Weld', 'GW' and seam-weld labels are girth-weld evidence, not
# anomalies. A bare upper() membership test routed "Girth Weld" rows into the
# corrosion buckets.
_WELD_KIND_PATTERN = re.compile(r"\b(?:gw|weld|girth|seam)\b")


def _is_weld_kind(feature_type) -> bool:
    return bool(_WELD_KIND_PATTERN.search(str(feature_type or "").strip().lower()))


# Same rule as hungarian_engine._is_cluster_feature: a vendor-merged corrosion
# group is not aligned across runs by default, because the grouping itself
# changes between reports.  It is conserved as a bypass row so ERF / FFS still
# see it.  A session may opt out through `ToleranceConfig.cluster_alignment` —
# keep the two engines' reading of that key identical.
_CLUSTER_KIND_PATTERN = re.compile(r"\b(?:cluster|klaster|kluster)s?(?:ed|ing)?\b", re.IGNORECASE)

CLUSTER_BYPASS_REASON = "Clustered metal loss — excluded from alignment"


def _is_cluster_feature(feature: ILIFeature | None) -> bool:
    if feature is None:
        return False
    return any(
        _CLUSTER_KIND_PATTERN.search(str(label or ""))
        for label in (feature.feature_type, feature.feature_identification)
    )


def _resolve_cluster_alignment(params: dict) -> bool:
    """True when this session asked for clusters to be aligned like anomalies.

    Mirrors ``hungarian_engine.resolve_cluster_alignment``: anything
    unrecognised, including a session saved before the setting existed, keeps
    the bypass rule.
    """
    tol_config = params.get("ToleranceConfig") or {}
    return str(tol_config.get("cluster_alignment", "") or "").strip().lower() == "align"


def _resolve_phylogenetic_runs(params_json: dict) -> list[dict]:
    """Extract run references from a phylogenetic session.

    Returns a list of run dicts sorted by year ascending.  Each dict has
    at least ``runId`` and ``year``.
    """
    summary = params_json.get("summaryData", {})

    runs = []
    for key in ("ancestorRun", "run1", "run2", "run3", "run4", "run5"):
        run = summary.get(key)
        if run and run.get("runId"):
            runs.append(run)

    if not runs:
        master = summary.get("masterRun")
        historical = summary.get("historicalRuns") or []
        if master and master.get("runId"):
            runs.append(master)
        for h in historical:
            if h and h.get("runId"):
                runs.append(h)

    runs.sort(key=lambda r: int(r.get("year") or 0))
    return runs


def _load_run_odometers(session, run_id: int) -> np.ndarray:
    """Ordered log distances for a run, as a float array.

    Only the odometer column is selected: the signal builder needs nothing
    else, and pulling whole ORM rows for a 200k-feature run costs hundreds of
    megabytes for data that is discarded immediately.
    """
    rows = (
        session.query(ILIFeature.log_distance_m)
        .filter(ILIFeature.run_id == run_id)
        .order_by(ILIFeature.log_distance_m)
        .all()
    )
    if not rows:
        return np.zeros(0)
    return np.array(
        [float(value) if value is not None else 0.0 for (value,) in rows],
        dtype=float,
    )


def _resolve_pair_sampling_interval(odometer_sets) -> tuple[float, bool]:
    """Shared sampling step for a pair of runs.

    ``pipeline_service`` converts block boundaries to indices with a single
    interval, so both signals of a pair must be sampled identically.  The step
    is driven by whichever run is longer.

    Accuracy tradeoff: coarsening multiplies the odometer quantisation of every
    warping index by the same factor.  At the 20_000-sample cap a 4 km run
    resolves to 0.2 m instead of 0.1 m, still finer than the tools' own
    odometer repeatability, but the caller reports the effective step so the
    result is never read as 0.1 m precision.
    """
    longest = 0.0
    for odometers in odometer_sets:
        if odometers.size:
            longest = max(longest, float(odometers.max()))
    return resolve_sampling_interval(longest, DEFAULT_SAMPLING_INTERVAL_M, MAX_SIGNAL_SAMPLES)


def _build_signal_from_odometers(
    odometers: np.ndarray,
    sampling_interval: float = DEFAULT_SAMPLING_INTERVAL_M,
) -> np.ndarray:
    """Build a synthetic MFL-like signal from feature odometers.

    The phylogenetic core expects a 1-D signal array resampled at a fixed
    interval.  When raw MFL data is not stored we synthesize a sparse
    impulse signal from the feature odometer positions — the DTW still
    works because the algorithm constrains via anchor positions.
    """
    if odometers.size == 0:
        return np.zeros(100)

    max_dist = float(odometers.max())
    length = max(int(max_dist / sampling_interval) + 10, 100)
    signal = np.zeros(length)
    indices = (odometers / sampling_interval).astype(np.int64)
    indices = indices[(indices >= 0) & (indices < length)]
    signal[indices] = 1.0
    return signal


def _build_signal_from_features(
    session,
    run_id: int,
    sampling_interval: float | None = None,
) -> np.ndarray:
    """Convenience wrapper: load a run's odometers and build its signal."""
    odometers = _load_run_odometers(session, run_id)
    if sampling_interval is None:
        sampling_interval, _coarsened = _resolve_pair_sampling_interval([odometers])
    return _build_signal_from_odometers(odometers, sampling_interval)


def _feature_to_row(feature: ILIFeature, run_label: str, match_status: str,
                    paired: ILIFeature | None = None,
                    pair_label: str = "") -> dict:
    """Convert an ILIFeature ORM object to the flat dict format expected
    by ``normalizeComparisonResult`` in the Node.js layer."""
    row: dict = {
        "match_status": match_status,
    }
    if run_label == "new":
        row["feature_new_id"] = feature.id
        row["new_log_distance_m"] = feature.log_distance_m
        row["new_feature_type"] = feature.feature_type
        row["new_feature_id"] = feature.feature_id
        row["new_joint_number"] = feature.joint_number
        row["new_dist_to_us_gw_m"] = feature.dist_to_us_gw_m
        row["new_clock_position"] = feature.clock_position
        row["new_depth_pct"] = feature.depth_pct
        row["new_length_mm"] = feature.length_mm
        row["new_width_mm"] = feature.width_mm
        row["feature_old_id"] = paired.id if paired else None
        row["old_log_distance_m"] = paired.log_distance_m if paired else None
        row["old_feature_type"] = paired.feature_type if paired else None
        row["old_feature_id"] = paired.feature_id if paired else None
        row["old_joint_number"] = paired.joint_number if paired else None
        row["old_dist_to_us_gw_m"] = paired.dist_to_us_gw_m if paired else None
        row["old_clock_position"] = paired.clock_position if paired else None
        row["old_depth_pct"] = paired.depth_pct if paired else None
        row["old_length_mm"] = paired.length_mm if paired else None
        row["old_width_mm"] = paired.width_mm if paired else None
    else:
        row["feature_old_id"] = feature.id
        row["old_log_distance_m"] = feature.log_distance_m
        row["old_feature_type"] = feature.feature_type
        row["old_feature_id"] = feature.feature_id
        row["old_joint_number"] = feature.joint_number
        row["old_dist_to_us_gw_m"] = feature.dist_to_us_gw_m
        row["old_clock_position"] = feature.clock_position
        row["old_depth_pct"] = feature.depth_pct
        row["old_length_mm"] = feature.length_mm
        row["old_width_mm"] = feature.width_mm
        row["feature_new_id"] = paired.id if paired else None
        row["new_log_distance_m"] = paired.log_distance_m if paired else None
        row["new_feature_type"] = paired.feature_type if paired else None
        row["new_feature_id"] = paired.feature_id if paired else None
        row["new_joint_number"] = paired.joint_number if paired else None
        row["new_dist_to_us_gw_m"] = paired.dist_to_us_gw_m if paired else None
        row["new_clock_position"] = paired.clock_position if paired else None
        row["new_depth_pct"] = paired.depth_pct if paired else None
        row["new_length_mm"] = paired.length_mm if paired else None
        row["new_width_mm"] = paired.width_mm if paired else None

    if paired:
        old_d = row.get("old_log_distance_m") or 0
        new_d = row.get("new_log_distance_m") or 0
        row["odo_diff"] = round(abs(new_d - old_d), 4)
        row["gw_diff"] = None
        old_depth = row.get("old_depth_pct")
        new_depth = row.get("new_depth_pct")
        if old_depth is not None and new_depth is not None:
            row["depth_diff"] = round((new_depth or 0) - (old_depth or 0), 2)
        else:
            row["depth_diff"] = None
    return row


def perform_phylogenetic_alignment(session_id: int):
    """Run the full phylogenetic alignment pipeline for a session."""
    db_session = SessionLocal()
    raw_conn = None
    try:
        sess = db_session.query(AlignmentSession).filter(
            AlignmentSession.id == session_id
        ).first()
        if not sess:
            raise RuntimeError(f"Session {session_id} not found")

        params = sess.params_json or {}
        align_clusters = _resolve_cluster_alignment(params)
        runs = _resolve_phylogenetic_runs(params)

        if len(runs) < 2:
            raise RuntimeError(
                f"Phylogenetic alignment requires at least 2 runs, got {len(runs)}"
            )

        logger.info("Phylogenetic alignment for session %d with %d runs", session_id, len(runs))
        for i, r in enumerate(runs):
            logger.info("  Run %d: id=%s year=%s", i, r.get("runId"), r.get("year"))

        pipeline_id = sess.pipeline_id
        if not pipeline_id:
            sr = db_session.query(SurveyRun).filter(
                SurveyRun.id == int(runs[0]["runId"])
            ).first()
            pipeline_id = sr.pipeline_id if sr else None
        if not pipeline_id:
            raise RuntimeError("Cannot resolve pipeline_id for this session")

        # Use raw psycopg2 connection for the phylogenesis engine.
        # Closed deterministically in the finally block below.
        raw_conn = db_session.get_bind().raw_connection()

        all_pair_results = []
        failed_pairs = []
        combined_report_summary = {
            "pairs": [],
            "total_matches": 0,
            "total_blocks": 0,
        }

        # Pairwise chain: align (run[0] -> run[1]), (run[1] -> run[2]), etc.
        for pair_idx in range(len(runs) - 1):
            source_run = runs[pair_idx]
            target_run = runs[pair_idx + 1]
            source_id = int(source_run["runId"])
            target_id = int(target_run["runId"])

            logger.info(
                "=== Pair %d/%d: run %d (%s) -> run %d (%s) ===",
                pair_idx + 1, len(runs) - 1,
                source_id, source_run.get("year"),
                target_id, target_run.get("year"),
            )

            source_odometers = _load_run_odometers(db_session, source_id)
            target_odometers = _load_run_odometers(db_session, target_id)
            sampling_interval, resolution_coarsened = _resolve_pair_sampling_interval(
                [source_odometers, target_odometers]
            )
            if resolution_coarsened:
                logger.warning(
                    "Signal resolution coarsened to %.3f m (from %.3f m) so neither "
                    "run exceeds %d samples; warping indices now localise features "
                    "to %.3f m instead of %.3f m",
                    sampling_interval, DEFAULT_SAMPLING_INTERVAL_M, MAX_SIGNAL_SAMPLES,
                    sampling_interval, DEFAULT_SAMPLING_INTERVAL_M,
                )
            signal_source = _build_signal_from_odometers(source_odometers, sampling_interval)
            signal_target = _build_signal_from_odometers(target_odometers, sampling_interval)

            pair_error = None
            try:
                report = run_phylogenetic_alignment(
                    db_conn=raw_conn,
                    pipeline_id=pipeline_id,
                    source_run_id=source_id,
                    target_run_id=target_id,
                    signal_source=signal_source,
                    signal_target=signal_target,
                    sampling_interval=sampling_interval,
                )
            except Exception as e:
                # A crashed pair is a failure, not "nothing matched". Record
                # it so the run as a whole can fail instead of silently
                # reporting every feature as Only OLD / Only NEW.
                logger.exception("Pair %d (run %d -> run %d) crashed", pair_idx + 1, source_id, target_id)
                report = None
                pair_error = str(e)
                failed_pairs.append({"pair_index": pair_idx, "error": pair_error})

            # Build output rows for this pair
            source_features = {
                f.id: f for f in
                db_session.query(ILIFeature)
                .filter(ILIFeature.run_id == source_id)
                .all()
            }
            target_features = {
                f.id: f for f in
                db_session.query(ILIFeature)
                .filter(ILIFeature.run_id == target_id)
                .all()
            }

            matched_rows = []
            only_old_rows = []
            only_new_rows = []
            bypassed_old_rows = []
            bypassed_new_rows = []

            matched_source_ids = set()
            matched_target_ids = set()

            if report and report.block_results:
                for block in report.block_results:
                    for match in block.matches:
                        src_feat = source_features.get(match.source_feature_id)
                        tgt_feat = target_features.get(match.target_feature_id)
                        if not align_clusters and (
                            _is_cluster_feature(src_feat) or _is_cluster_feature(tgt_feat)
                        ):
                            # Neither id is marked consumed, so both sides fall
                            # through to the bypass sweep below and stay in the
                            # report as unaligned rows.
                            continue
                        if src_feat and tgt_feat:
                            row = _feature_to_row(tgt_feat, "new", "Matched", src_feat)
                            row["pair_index"] = pair_idx
                            row["pair_label"] = f"{source_run.get('year', '?')}-{target_run.get('year', '?')}"
                            row["confidence"] = match.confidence
                            row["method"] = match.method
                            matched_rows.append(row)
                            matched_source_ids.add(match.source_feature_id)
                            matched_target_ids.add(match.target_feature_id)

            # "Only OLD" is a claim that the feature was looked for and not
            # found.  A cluster was never looked for, so it is reported as
            # bypassed instead — otherwise every cluster reads as a defect that
            # disappeared between runs.
            for fid, feat in source_features.items():
                if fid in matched_source_ids:
                    continue
                clustered = not align_clusters and _is_cluster_feature(feat)
                row = _feature_to_row(feat, "old", "Bypassed OLD" if clustered else "Only OLD")
                row["pair_index"] = pair_idx
                row["pair_label"] = f"{source_run.get('year', '?')}-{target_run.get('year', '?')}"
                if clustered:
                    row["Bypass Reason"] = CLUSTER_BYPASS_REASON
                    bypassed_old_rows.append(row)
                else:
                    only_old_rows.append(row)

            for fid, feat in target_features.items():
                if fid in matched_target_ids:
                    continue
                clustered = not align_clusters and _is_cluster_feature(feat)
                row = _feature_to_row(feat, "new", "Bypassed NEW" if clustered else "Only NEW")
                row["pair_index"] = pair_idx
                row["pair_label"] = f"{source_run.get('year', '?')}-{target_run.get('year', '?')}"
                if clustered:
                    row["Bypass Reason"] = CLUSTER_BYPASS_REASON
                    bypassed_new_rows.append(row)
                else:
                    only_new_rows.append(row)

            pair_summary = {
                "pair_index": pair_idx,
                "source_run_id": source_id,
                "target_run_id": target_id,
                "source_year": source_run.get("year"),
                "target_year": target_run.get("year"),
                "matched": len(matched_rows),
                "only_old": len(only_old_rows),
                "only_new": len(only_new_rows),
                "bypassed_old": len(bypassed_old_rows),
                "bypassed_new": len(bypassed_new_rows),
                "status": "error" if pair_error is not None else "completed",
                # Resolution metadata: every warping index for this pair is
                # quantised to this step, so downstream readers must not treat
                # the result as 0.1 m precision when it was coarsened.
                "signal_sampling_interval_m": sampling_interval,
                "signal_resolution_coarsened": resolution_coarsened,
            }
            if pair_error is not None:
                pair_summary["error"] = pair_error
            if report:
                pair_summary["ransac_inliers"] = report.ransac_inliers
                pair_summary["ransac_outliers"] = report.ransac_outliers
                pair_summary["total_blocks"] = report.total_blocks
                pair_summary["corrupt_blocks"] = report.corrupt_blocks
                pair_summary["joint_violations"] = report.joint_violations
                combined_report_summary["total_matches"] += report.total_matches
                combined_report_summary["total_blocks"] += report.total_blocks

            combined_report_summary["pairs"].append(pair_summary)

            all_pair_results.append({
                "anomaly_matched": matched_rows,
                "anomaly_only_old": only_old_rows,
                "anomaly_only_new": only_new_rows,
                "bypassed_old": bypassed_old_rows,
                "bypassed_new": bypassed_new_rows,
            })

        # Flatten into the standard output format
        gw_locked = []
        gw_unmatched = []
        anomaly_matched = []
        anomaly_only_old = []
        anomaly_only_new = []
        bypassed_old = []
        bypassed_new = []

        for pair_result in all_pair_results:
            for row in pair_result["anomaly_matched"]:
                if _is_weld_kind(row.get("old_feature_type")) or _is_weld_kind(row.get("new_feature_type")):
                    gw_locked.append(row)
                else:
                    anomaly_matched.append(row)
            anomaly_only_old.extend(pair_result["anomaly_only_old"])
            anomaly_only_new.extend(pair_result["anomaly_only_new"])
            bypassed_old.extend(pair_result["bypassed_old"])
            bypassed_new.extend(pair_result["bypassed_new"])

        json_output = {
            "gw_locked": gw_locked,
            "gw_unmatched": gw_unmatched,
            "anomaly_matched": anomaly_matched,
            "anomaly_only_old": anomaly_only_old,
            "anomaly_only_new": anomaly_only_new,
            "bypassed_old": bypassed_old,
            "bypassed_new": bypassed_new,
            "filtered_old": [],
            "filtered_new": [],
            "phylogenetic_summary": combined_report_summary,
            "audit": {
                "total_input_old": sum(
                    p.get("matched", 0) + p.get("only_old", 0) + p.get("bypassed_old", 0)
                    for p in combined_report_summary["pairs"]
                ),
                "total_input_new": sum(
                    p.get("matched", 0) + p.get("only_new", 0) + p.get("bypassed_new", 0)
                    for p in combined_report_summary["pairs"]
                ),
                "total_output": (
                    len(gw_locked) + len(anomaly_matched)
                    + len(anomaly_only_old) + len(anomaly_only_new)
                    + len(bypassed_old) + len(bypassed_new)
                ),
            },
        }
        if failed_pairs:
            json_output["success"] = False
            json_output["error"] = (
                f"{len(failed_pairs)} of {len(runs) - 1} alignment pair(s) crashed"
            )

        result_path = os.environ.get("ALIGNMENT_RESULT_FILE")
        if result_path:
            with open(result_path, "w", encoding="utf-8") as fh:
                json.dump(json_output, fh)
            print(f"___RESULT_FILE___{result_path}")
        else:
            print("___RESULT_JSON_BEGIN___")
            print(json.dumps(json_output))
            print("___RESULT_JSON_END___")

        if failed_pairs:
            # The result payload above carries the per-pair statuses; the
            # process itself must still exit nonzero so the worker does not
            # record a crashed run as a successful alignment.
            raise RuntimeError(
                "; ".join(
                    f"pair {f['pair_index'] + 1} crashed: {f['error']}"
                    for f in failed_pairs
                )
            )

        total_m = combined_report_summary["total_matches"]
        print(f"\n[DONE] Phylogenetic alignment complete: {total_m} matches across {len(runs)-1} pairs")

    finally:
        if raw_conn is not None:
            raw_conn.close()
        db_session.close()


def _force_utf8_io():
    """Never let the locale codepage decide how requests are decoded.

    Node sets PYTHONIOENCODING, but this keeps the engine correct when it is
    run by hand.  ``errors='replace'`` matters as much as the encoding: an
    encode error while printing the result envelope would kill the run after
    the alignment already succeeded.  Mirrors dtw_engine._force_utf8_io.
    """
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass


def main(argv=None):
    argv = sys.argv if argv is None else argv
    session_id = int(argv[1]) if len(argv) > 1 else None

    if not session_id:
        print("[ERROR] No session_id provided", file=sys.stderr)
        return 1

    try:
        perform_phylogenetic_alignment(session_id)
    except Exception as error:
        import traceback
        traceback.print_exc(file=sys.stderr)
        print(f"[ERROR] Phylogenetic alignment failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    _force_utf8_io()
    sys.exit(main())
