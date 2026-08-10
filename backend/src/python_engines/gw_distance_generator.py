"""Generate the absolute U/S girth weld distance for one run, from its odometer.

Many pipetally exports leave "Dist. to U/S GW" blank. It is the strongest
identity evidence the alignment matcher has — it survives an odometer that
drifted — and it is recoverable: a run that reports its girth welds as features
already carries every reference point needed.

Run as::

    python src/python_engines/gw_distance_generator.py <runId>            # preview
    python src/python_engines/gw_distance_generator.py <runId> --apply    # write

Preview and apply compute identically; only the write differs. That is the whole
reason the preview is trustworthy — it is not a separate estimate of what would
happen, it is the same pass with the commit withheld.

**Why a separate column.** The result goes to ``dist_to_us_gw_derived_m``, never
over ``dist_to_us_gw_m``. A vendor measures to the weld centreline; this measures
to the odometer the weld feature was reported at, and the two differ by a fixed
bias per run. Overwriting would destroy a surveyed number and leave nothing able
to tell a computed value from a measured one.

**Why the engine still decides.** Generating a column does not mean the matcher
must use it — see ``us_gw_distance_source`` in ``ToleranceConfig``, which owns
the rule that both runs use the same provenance or neither does. This script
fills the column; the session decides whether to read it.
"""

import argparse
import json
import sys
from datetime import datetime

import gw_distance_derivation as derivation
from models import ILIFeature, RunGwDistanceGeneration, SessionLocal, SurveyRun

# Features are written back in batches so a 200k-feature run does not build one
# enormous statement, and so a failure part-way leaves the transaction to roll
# the whole thing back rather than half-filling a column.
WRITE_BATCH_SIZE = 5_000

# How many worked examples the preview returns. Enough for an engineer to check
# the arithmetic against the pipetally by hand, few enough to stay a response.
PREVIEW_SAMPLE_SIZE = 15


def _feature_dict(feature: ILIFeature) -> dict:
    """The shape ``gw_distance_derivation`` works in.

    Deliberately the same shape the alignment engine builds in ``fetch_data``,
    so the generator and the engine classify a feature identically. ``raw``
    carries the two label columns the girth-weld predicate reads.
    """
    return {
        "id": feature.id,
        "feature_id": feature.feature_id,
        # No tie-in transform is involved here: this is the run's own chainage,
        # which is the only axis a weld-relative distance may be measured in.
        "source_abs_distance_m": feature.log_distance_m,
        "abs_distance_m": feature.log_distance_m,
        "dist_to_us_gw_m": feature.dist_to_us_gw_m,
        "originalType": feature.feature_type,
        "raw": {
            "feature_type": feature.feature_type,
            "feature_identification": feature.feature_identification,
        },
    }


def generate_for_run(session, run_id: int, *, apply: bool, generated_by=None) -> dict:
    """Derive the weld-relative distance for every feature of one run."""
    run = session.query(SurveyRun).filter(SurveyRun.id == run_id).first()
    if run is None:
        raise LookupError(f"Run {run_id} does not exist")

    features = (
        session.query(ILIFeature)
        .filter(ILIFeature.run_id == run_id)
        .order_by(ILIFeature.log_distance_m.asc(), ILIFeature.id.asc())
        .all()
    )
    if not features:
        raise LookupError(f"Run {run_id} has no features to generate from")

    records = [_feature_dict(feature) for feature in features]
    predicate = derivation.is_girth_weld_feature

    vendor_coverage = derivation.vendor_coverage(records, predicate)
    median_joint_length = derivation.median_joint_length(records, predicate)
    weld_odometers = derivation.girth_weld_odometers(records, predicate)

    # overwrite=True: the generator's job is to produce a complete derived
    # column, not to fill the gaps in a vendor one. Which of the two the matcher
    # reads is a separate decision, and the vendor column is untouched either
    # way.
    stats = derivation.derive_us_gw_distances(records, predicate, overwrite=True)

    sample = [
        {
            "featureId": record.get("feature_id"),
            "featureType": record.get("originalType"),
            "logDistanceM": record.get("source_abs_distance_m"),
            "derivedM": record.get("dist_to_us_gw_m"),
            "referenceWeldM": (
                record["source_abs_distance_m"] - record["dist_to_us_gw_m"]
                if record.get("dist_to_us_gw_m") is not None
                and record.get("source_abs_distance_m") is not None
                else None
            ),
            "vendorM": feature.dist_to_us_gw_m,
        }
        for feature, record in zip(features, records)
        if record.get("dist_to_us_gw_m") is not None
    ][:PREVIEW_SAMPLE_SIZE]

    summary = {
        "runId": run_id,
        "runYear": run.survey_year,
        "runSourceFile": run.source_file,
        "applied": bool(apply),
        "featureCount": len(features),
        "girthWelds": stats["girthWelds"],
        "derivedCount": stats["derived"],
        "noUpstreamWeldCount": stats["noUpstreamWeld"],
        "unreadableDistanceCount": stats["unreadableDistance"],
        "vendorReportedCount": vendor_coverage["reported"],
        "vendorCoverage": vendor_coverage["coverage"],
        "medianJointLengthM": median_joint_length,
        "firstGirthWeldM": weld_odometers[0] if weld_odometers else None,
        "lastGirthWeldM": weld_odometers[-1] if weld_odometers else None,
        "sample": sample,
        "warnings": [],
    }

    if not weld_odometers:
        summary["warnings"].append(
            "This run reports no girth welds, so no weld-relative distance can be "
            "derived from it. Check that the girth weld rows survived ingestion."
        )
    if stats["noUpstreamWeld"]:
        summary["warnings"].append(
            f"{stats['noUpstreamWeld']} feature(s) sit upstream of the first girth "
            "weld and have no upstream reference; they are left empty rather than "
            "measured from nothing."
        )
    if stats["unreadableDistance"]:
        summary["warnings"].append(
            f"{stats['unreadableDistance']} feature(s) have no readable odometer, "
            "so nothing could be derived for them."
        )

    if not apply:
        # Nothing was written, and nothing needs undoing: the ORM objects were
        # never mutated, only the plain dicts built from them.
        return summary

    if not weld_odometers:
        raise ValueError(
            f"Run {run_id} reports no girth welds; there is nothing to measure from."
        )

    for start in range(0, len(records), WRITE_BATCH_SIZE):
        for feature, record in zip(
            features[start:start + WRITE_BATCH_SIZE],
            records[start:start + WRITE_BATCH_SIZE],
        ):
            derived = record.get("dist_to_us_gw_m")
            if derived is None or record.get("source_abs_distance_m") is None:
                feature.dist_to_us_gw_derived_m = None
                feature.us_gw_reference_m = None
                continue
            feature.dist_to_us_gw_derived_m = derived
            feature.us_gw_reference_m = record["source_abs_distance_m"] - derived
        session.flush()

    session.merge(RunGwDistanceGeneration(
        run_id=run_id,
        generated_at=datetime.utcnow(),
        girth_welds=stats["girthWelds"],
        derived_count=stats["derived"],
        no_upstream_weld_count=stats["noUpstreamWeld"],
        unreadable_distance_count=stats["unreadableDistance"],
        vendor_reported_count=vendor_coverage["reported"],
        feature_count=len(features),
        median_joint_length_m=median_joint_length,
        generated_by=generated_by,
    ))
    session.commit()
    return summary


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run_id", type=int)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write the derived column. Without it nothing is persisted.",
    )
    parser.add_argument("--generated-by", type=int, default=None)
    arguments = parser.parse_args(argv)

    session = SessionLocal()
    try:
        summary = generate_for_run(
            session,
            arguments.run_id,
            apply=arguments.apply,
            generated_by=arguments.generated_by,
        )
    except (LookupError, ValueError) as error:
        print(json.dumps({"error": str(error)}))
        return 1
    except Exception as error:  # noqa: BLE001 - reported as JSON, then re-raised to stderr
        import traceback

        traceback.print_exc(file=sys.stderr)
        print(json.dumps({"error": f"Generation failed: {error}"}))
        return 1
    finally:
        # A preview must not leave a mutated identity map behind for the next
        # caller on a pooled session.
        session.rollback()
        session.close()

    print(json.dumps(summary))
    return 0


if __name__ == "__main__":
    sys.exit(main())
