# Spec: AURORA-ILI Universal Registration (`aurora_ili`)

Implementation of the AURORA-ILI v1.2 Universal Technical Design Specification
as a fourth alignment strategy alongside `dtw_hungarian_onedirection`,
`manual` and `phylogenetic`.

## Objective

Correlate in-line inspection runs of one physical line across years, vendors,
tool generations and reporting conventions, by estimating physical identity and
the local coordinate transformation *before* deciding whether two reported
anomalies are the same feature.

The failure this exists to remove: a matcher that bridges two runs with a fixed
tolerance window has only one lever when the runs disagree, and widening it
admits look-alikes from elsewhere on the line. AURORA registers the structure,
reconstructs local coordinates from it, and only then compares — so a two-hour
clock difference becomes a two-degree residual when the whole local
constellation independently supports a two-hour rotation, and stays a mismatch
when it does not.

## Universality rule

No branch in `engine/aurora/` may depend on an inspection year, a vendor name, a
spreadsheet column or one reference pipeline. Everything source-specific stops
at the adapter that produces the canonical records the package consumes; in this
codebase that adapter is the ingestion pipeline plus
`hungarian_engine.fetch_data`.

Every threshold lives in `engine/aurora/config.py`, is overridable per session
through `params_json.auroraConfig`, and travels with the result as
`configVersion` / `modelVersion`.

## Pipeline

```
STRUCTURE -> REGISTER COORDINATES -> TEST DIRECT CORRESPONDENCE
          -> RESCUE REGIONAL PATTERN IF NEEDED -> SOLVE RELATIONSHIPS
          -> SCORE -> REVIEW
```

| Stage | Module | Artifact |
| --- | --- | --- |
| Canonicalisation | `canonical.py` | canonical features, masks, circular clock |
| Capability and mode | `profile.py` | `CapabilityProfile`, operating mode M1–M6 |
| Anchors and fingerprints | `anchors.py` | multi-scale descriptors, coarse offset vote |
| Monotonic registration | `structure.py` | `AnchorMap` with match / gap / insertion events, change zones |
| Persistent physical space | `registry.py` | `PersistentJointMap`, PJID, local `u` |
| Coordinate registration | `transform.py` | `TransformField` (`a_j`, `b_j`, `phi_j`) |
| Relative geometry | `pattern.py` | neighbour descriptors, density map, regions |
| Pattern Rescue | `rescue.py` | `RescueCase` with votes, inliers, uniqueness |
| Re-identification | `reid.py` | `MatchGroup` 1:1 / 1:N / N:1 / N:M |
| Uncertainty and scoring | `uncertainty.py`, `score.py` | `Sigma_total`, calibrated `P(match)`, confidence class |
| Orchestration | `orchestrator.py` | job state machine, review queue |

### Structural registration is order-preserving

Anchor correspondence is a banded affine-gap sequence alignment. Permitted
events are MATCH, INSERTION and DELETION. `i1 < i2` implies `j1 < j2` is a hard
invariant: `assert_non_crossing` raises rather than lowering a confidence,
because a crossing map is a defect and not a weak match.

Registration runs twice. The first pass has only fingerprints and sequence to
work with, so its positional term is broad — a drifted odometer would poison a
sharp one. A monotonic coarse map is then fitted to the trusted pairs, with
residual outliers rejected against their own neighbourhood, and the second pass
scores against that prediction with a tight positional term. The refinement is
kept only when it explains at least as much structure as the pass it came from.

### Coordinates are local, never global

Inside a joint bounded by two matched anchors, `a_j = L_B / L_A` and
`b_j = x_B,US - a_j x_A,US`. Vendor joint numbers are run-local aliases; identity
is the `PersistentJointID`, minted from the pipeline and the two boundary
positions. Accumulated drift is checked against the identity
`delta_(j+1) - delta_j = L_B,j - L_A,j` and reported as *explained* when it
holds, because a large absolute drift that this identity accounts for is not
evidence of a wrong match.

### Clock is a rotation, not a tolerance

`phi_j` is estimated — globally from high-confidence direct matches, locally by
Pattern Rescue — and applied as a coordinate correction. The raw clock gate is
never widened. Longitudinal clock shear `k_j` exists but is off by default,
bounded, and adopted only when it measurably improves the residual fit.

### Pattern Rescue is conditional and bounded

Triggered per joint when direct-match health `H_direct` collapses *and*
structural support is strong enough to constrain the search *and* the region
carries enough features to make a relative-geometry argument. It votes local
transforms from descriptor-weighted correspondences and from density
cross-correlation, reaches a robust consensus on the inlier count rather than on
the vote mass, and declines when the best and second-best modes are too close.
It cannot leave the registered corridor, so a distant look-alike is never a
candidate however well it scores.

## Result contract

`aurora_engine.py` emits the standard buckets, so the results table, the Excel
export, the corrosion review and the FFS intake need no strategy branch:

- `gw_locked` / `fitting_matched` — registered anchors, split by class.
- `gw_unmatched` — girth welds, valves and tees with no partner, i.e. genuine
  missing structural evidence. Bends, flanges and markers go to the bypass
  buckets instead, because their absence from one report is routine.
- `anomaly_matched` — one row per member of the larger side of each group, all
  members sharing one `AURORA Group ID`. `MANY_TO_MANY_REGION` members carry
  the status `Region only`: the region corresponds, the box mapping does not.
- `anomaly_only_old` / `anomaly_only_new` — no candidate passed the gate.
- `bypassed_*` — clusters, structural-change zones, features outside the
  registered map, and pipe furniture. Excluded from alignment, never from the
  report. Clusters are here only under the default `ToleranceConfig.cluster_alignment`
  of `bypass`; a session set to `align` hands them to the matcher as ordinary
  metal loss, and they then appear in the anomaly buckets like anything else.
- `filtered_*` — unreadable odometer or outside the tie-in domain.

Every input source key appears exactly once; `audit.isConserved` is checked in
tests, not assumed.

Rows also carry the shared match-evidence columns: `Match Method` is
`AURORA_ILI` and `Match Confidence (%)` is the calibrated probability.
`Match Cost` and `Match Log Bayes Factor` stay empty because AURORA has
neither, and no `match_evidence` payload is attached — the evidence drawer
renders either a tolerance-cost breakdown or a posterior breakdown, and AURORA's
evidence is neither. Its explanation lives in the AURORA columns and in the
registration evidence panel.

AURORA is deliberately *not* registered in `anomalyMatchers.js`. That registry
picks the Phase-2 matcher for a run whose girth-weld phase is already fixed;
AURORA owns both phases, so it is dispatched by `resolveEngineScript` in the
worker, which lets an end-to-end strategy win over any saved matcher choice.

Extra columns: `AURORA Group ID`, `AURORA Match Type`, `AURORA PJID`,
`AURORA Confidence Class`, `AURORA P(match)`, `AURORA Evidence Score`,
`AURORA Ambiguity Margin`,
`AURORA Region Confidence`, `AURORA Feature Confidence`,
`AURORA Axial Residual (m)`, `AURORA Clock Residual (deg)`,
`AURORA Rescue Mode`, `AURORA Explanation`.

Stage artifacts ride inside `audit.aurora`. They cannot be a top-level key:
`normalizeComparisonResult` flattens every top-level array of the engine payload
into the comparison table, so an artifact list would become result rows.

## Two confidences, stored separately

`RegionCorrespondenceConfidence` and `FeatureCorrespondenceConfidence` are
independent. A HIGH region correspondence with LOW individual correspondence is
a valid, expected result across tool generations, and individual matching
failure never implies regional failure.

## UI

The wizard is unchanged for every strategy. Selecting AURORA adds:

- a one-paragraph description under the strategy selector;
- a per-step note (`wizard/AuroraStepNote.tsx`) saying what AURORA does with
  that step's input — necessary because AURORA registers its own structure and
  derives its gates from tool uncertainty rather than from the tolerance
  sliders, and an engineer must not tune a control that has no effect;
- an evidence panel on the comparison page
  (`components/comparison/AuroraEvidencePanel.tsx`) built from the same design
  system as the rest of the app: operating mode and why, capability coverage,
  structural map health, the local transform field, change zones, rescue cases
  and the review queue.

For a chain alignment the panel renders once per run pair, read from
`audit.pairs[].aurora`.

## Validation

`backend/tests/test_aurora_engine.py` covers the section 32 matrix: global
offset, progressive drift, accumulated-drift explanation, two-hour clock
recovery, an outlier that must *not* be rescued by the region's rotation,
missing welds as gaps, inserted welds as a change zone, a distant look-alike
rejected by the corridor, rescue acceptance and rescue refusal on a repetitive
pattern, split and merge, region-versus-feature confidence, insufficient
evidence, cluster conservation, configuration merging, and the worker bucket
contract.

## Not built

Deferred, and deliberately not stubbed: multi-run latent-frame inference for
N >= 3 (the data model supports it; the solver is pairwise), the optional
recurring-state HMM of section 12.1, Gromov-Wasserstein relational matching of
section 16.2, and learned probability calibration — the logistic coefficients
are transparent starting values, not fitted ones, and the model version says so.
