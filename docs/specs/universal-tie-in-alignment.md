# Spec: Universal Partial-Run Tie-In Alignment

## Objective

Locate the physical overlap between a historical/partial ILI run and the newest
master run, align the historical chainage onto the master axis, and refuse an
automatic decision when the evidence is ambiguous.

The source rows are immutable. `OLD` is the historical/source coordinate and
`NEW` is the master/target coordinate.

## Engineering Model

### 1. Physical sequence evidence

Use girth welds as ordered knots and use valves, tees/offtakes, bends, wall
thickness, and short fitting welds as supporting landmarks. Absolute odometer
is not used to identify the overlap because the runs may start at unrelated
locations.

For a transition from matched knot `(i, j)` to `(i+r, j+s)`, compare the
physical spans

`L_old = x_old[i+r] - x_old[i]`

`L_new = x_new[j+s] - x_new[j]`

with robust relative error

`e_L = |L_old - L_new| / max(L_old, L_new, epsilon)`.

The transition score combines a Huber-like bounded length score, landmark/type
agreement, wall-thickness agreement, and an explicit penalty for skipped welds.
Allowing `r` or `s` greater than one handles a missed/extra weld or a short
replacement spool without crossing the ordered path.

Dynamic programming is local/semi-global: starts and ends are free, so an OLD
run can overlap the beginning, middle, or end of NEW. The selected path
maximizes cumulative evidence subject to strictly increasing OLD and NEW
indices.

### 2. Ambiguity boundary

Calculate at least the two strongest materially different overlap paths.
Automatic acceptance requires all of the following:

- enough matched knots and physical coverage;
- low robust span error and no non-monotonic mapping;
- best-path evidence materially exceeds the runner-up;
- local scale remains inside the configured ILI odometer tolerance;
- no abrupt offset jump outside an explicitly reported repair/break interval.

The returned `confidence` is an evidence score, not a trained probability.
Failed gates produce `REVIEW_REQUIRED`; they must not silently apply a transform.

### 3. Historical-to-master transform

For accepted matched knots `(o_k, n_k)`, transform OLD chainage to NEW master
chainage with monotonic piecewise-linear interpolation:

`F(o) = n_k + (o - o_k) * (n_(k+1)-n_k) / (o_(k+1)-o_k)`.

This is the same within-spool proportional correction used for defect location:
it removes cumulative odometer drift while preserving relative position inside
the matched spool. Outside the accepted overlap, extrapolation is disabled by
default.

An affine OLD-to-NEW fallback is also reported:

`n = a * o + b`.

The legacy scalar `offset` remains additive to NEW only for backward
compatibility with the current DTW endpoint; the canonical contract is
`transform.direction = OLD_TO_NEW` and its piecewise knots.

## API Contract

Successful estimation returns:

- `decision.status`: `AUTO_ACCEPTED` or `REVIEW_REQUIRED`;
- `tieIn.oldDistanceM` and `tieIn.newDistanceM` for the first accepted physical
  common knot;
- `transform` with direction, affine fallback, piecewise knots, domain, and
  extrapolation policy;
- a server-signed evidence token bound to organization, run pair (or raw anchor
  digest), excluded ranges, decision evidence, transform, and method version;
- `candidates` with runner-up evidence and rejection reasons;
- matched/unmatched pairs, overlap, residuals, coverage, exclusions, and an
  auditable method version;
- legacy `offset`, `scale`, and existing diagnostics during migration.

## HU-CPA Regression

The 2024 launcher assembly before the permanent line must not be forced onto the
2026 full run. The first strong common sequence is expected near OLD `4.243 m`
and NEW `1868.810 m`, followed by the matching weld/tee/bend sequence through
CPA. The model must map 2024 onto 2026; it must not add a negative transform to
the master run.

## Verification

- Unit: partial overlap at every run boundary, missed/extra welds, drift,
  outliers, exclusions, repeated-pattern ambiguity, and transform direction.
- Regression: compact HU-CPA physical anchor sequence plus a full-workbook
  validation command when the supplied workbooks are present.
- Integration: endpoint preserves old keys while exposing the new contract;
  the wizard blocks automatic use for `REVIEW_REQUIRED`.
- Build: backend test/check and frontend test/build.

## Boundaries

- Never mutate raw source rows.
- Rows outside the accepted transform domain remain explicit filtered/audit
  evidence and are never silently discarded.
- Never label evidence score as a statistical probability.
- Never extrapolate outside overlap without an explicit user decision.
- Manual approval and excluded ranges remain audit evidence.
- No database migration or new dependency is required for this change.
