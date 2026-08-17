import json
import os
import sys

from hungarian_engine import CLUSTER_BYPASS_REASON, HungarianAnomalyAlignmentEngine


def _manual_row(feature, side, status, result_group, old_year, new_year, align_clusters=False):
    is_old = side == "OLD"
    return {
        "match_status": status,
        "Match/Unmatch": status,
        "Result Group": result_group,
        # Only a bypass this run actually applied is named.  A session that
        # aligns clusters bypassed nothing, so the column stays empty.
        "Bypass Reason": (
            CLUSTER_BYPASS_REASON
            if not align_clusters
            and HungarianAnomalyAlignmentEngine._is_cluster_feature(feature)
            else "-"
        ),
        "Run Year OLD": old_year,
        "Run Year NEW": new_year,
        "Source Key OLD": feature.get("source_key") if is_old else "-",
        "Source Key NEW": "-" if is_old else feature.get("source_key"),
        "Identif. OLD": feature.get("id", "-") if is_old else "-",
        "Identif. NEW": "-" if is_old else feature.get("id", "-"),
        "Log Dist OLD (m)": feature.get("abs_distance_m", "-") if is_old else "-",
        "Log Dist NEW (m)": "-" if is_old else feature.get("abs_distance_m", "-"),
        "Feature Type OLD": feature.get("originalType", "-") if is_old else "-",
        "Feature Type NEW": "-" if is_old else feature.get("originalType", "-"),
        "Depth OLD (%WT)": feature.get("depth_pct", "-") if is_old else "-",
        "Depth NEW (%WT)": "-" if is_old else feature.get("depth_pct", "-"),
        "Length OLD (mm)": feature.get("length_mm", "-") if is_old else "-",
        "Length NEW (mm)": "-" if is_old else feature.get("length_mm", "-"),
        "Width OLD (mm)": feature.get("width_mm", "-") if is_old else "-",
        "Width NEW (mm)": "-" if is_old else feature.get("width_mm", "-"),
        "O'Clock OLD": feature.get("clock_position", "-") if is_old else "-",
        "O'Clock NEW": "-" if is_old else feature.get("clock_position", "-"),
        "Physics Warning": "-",
        "physics_warnings": [],
    }


def build_manual_output(old_features, new_features, old_year, new_year, align_clusters=False):
    HungarianAnomalyAlignmentEngine._ensure_source_keys(old_features, "OLD")
    HungarianAnomalyAlignmentEngine._ensure_source_keys(new_features, "NEW")
    output = {
        "gw_locked": [],
        "gw_unmatched": [],
        "anomaly_matched": [],
        "anomaly_only_old": [],
        "anomaly_only_new": [],
        "bypassed_old": [],
        "bypassed_new": [],
        "filtered_old": [],
        "filtered_new": [],
    }

    for side, features in (("OLD", old_features), ("NEW", new_features)):
        for feature in features:
            if HungarianAnomalyAlignmentEngine._is_gw_feature(feature):
                bucket = "gw_unmatched"
                group = "GW"
            elif HungarianAnomalyAlignmentEngine._is_matchable_anomaly(feature, align_clusters):
                bucket = "anomaly_only_old" if side == "OLD" else "anomaly_only_new"
                group = "ANOMALY"
            else:
                bucket = "bypassed_old" if side == "OLD" else "bypassed_new"
                group = "BYPASSED"
            output[bucket].append(_manual_row(
                feature,
                side,
                f"Only {side}",
                group,
                old_year,
                new_year,
                align_clusters,
            ))

    rows = [row for value in output.values() for row in value]
    output["audit"] = HungarianAnomalyAlignmentEngine._build_conservation_audit(
        old_features,
        new_features,
        rows,
    )
    return output


def main(session_id):
    engine = HungarianAnomalyAlignmentEngine(session_id)
    old_features = engine.fetch_data(is_old_run=True)
    new_features = engine.fetch_data(is_old_run=False)
    output = build_manual_output(
        old_features,
        new_features,
        engine.run_1_year,
        engine.run_2_year,
        engine.align_clusters,
    )
    result_path = os.environ.get("ALIGNMENT_RESULT_FILE")
    if result_path:
        with open(result_path, "w", encoding="utf-8") as fh:
            json.dump(output, fh)
        print(f"___RESULT_FILE___{result_path}")
    else:
        print("___RESULT_JSON_BEGIN___")
        print(json.dumps(output))
        print("___RESULT_JSON_END___")


if __name__ == "__main__":
    main(int(sys.argv[1]))
