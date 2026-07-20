# Spec: Universal Partial-Run Tie-In Alignment

## Objective

Locate the physical overlap between a historical/partial ILI run and the newest
master run, align the historical chainage onto the master axis, and refuse an
automatic decision when the evidence is ambiguous.

The source rows are immutable. `OLD` is the historical/source coordinate and
`NEW` is the master/target coordinate.

## Engineering Model

### 1. Physical sequence evidence

Use girth welds as ordered knots and use valves, tees/offtakes, bends, flanges,
wall thickness, clock position, and short fitting welds as supporting
landmarks. Normalize vendor labels before scoring: a primary weld remains a
weld even when its description mentions valve pipe, while explicit flange or
flanged-joint records become flange landmarks. Clock values are converted to
circular decimal hours. Absolute odometer is not used to identify the overlap
because the runs may start at unrelated locations.

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

Grossly incompatible spans are rejected before scoring. A transition is not a
candidate when `|L_old - L_new| > max(3 m, 0.25 * max(L_old, L_new))`. This
prevents a type-compatible but physically impossible repeated pattern from
accumulating score.

### 2. Stable physical boundary

The highest-scoring sequence can start inside a launcher/receiver flange
assembly. If a matched facility boundary appears within 10 m of the candidate
start, the operational TIE IN is the first downstream matched girth weld. The
facility assembly remains in `evidenceOverlap`; it is not used as a transform
knot. This rule is type- and distance-based, not HU-CPA hard-coding.

### 3. Ambiguity and quality boundary

Calculate at least the two strongest materially different overlap paths.
Automatic acceptance requires all of the following:

- enough matched knots and physical coverage;
- low robust span error and no non-monotonic mapping;
- best-path evidence materially exceeds the runner-up;
- local scale remains inside the configured ILI odometer tolerance;
- no abrupt offset jump outside an explicitly reported repair/break interval.
- P95 absolute consecutive-span residual does not exceed `1.5 m`.

The returned `confidence` is an evidence score, not a trained probability.
Failed gates produce `REVIEW_REQUIRED`; they must not silently apply a transform.

Affine residuals are diagnostic only. A dependency-free deterministic robust
fit is used in every runtime: median sampled pair slopes (Theil-Sen style),
followed by iteratively refitted least squares on residuals within `2.0 m`.
This fit detects outliers and reports RMSE; it does not replace ordered matching
or determine the final within-spool mapping.

### 4. Historical-to-master transform

For accepted matched knots `(o_k, n_k)`, transform OLD chainage to NEW master
chainage with monotonic piecewise-linear interpolation:

`F(o) = n_k + (o - o_k) * (n_(k+1)-n_k) / (o_(k+1)-o_k)`.

This is the same within-spool proportional correction used for defect location:
it removes cumulative odometer drift while preserving relative position inside
the matched spool. Outside the accepted overlap, extrapolation is disabled by
default.

`transform.domain` is exactly the first-to-last accepted knot domain on both
OLD and NEW. `evidenceOverlap` may be wider because it can end on a bend,
flange, tee, or valve. No non-knot landmark may extend the interpolation domain.

An affine OLD-to-NEW fallback is also reported:

`n = a * o + b`.

The legacy scalar `offset` remains additive to NEW only for backward
compatibility with the current DTW endpoint; the canonical contract is
`transform.direction = OLD_TO_NEW` and its piecewise knots.

### 5. Downstream locking

After server acceptance, every piecewise knot is resolved back to one weld in
OLD and one weld in NEW using source distance and, when available, vendor ID.
Those pairs use `matchingMode = TIEIN_LOCKED`; DTW and OTA are not allowed to
reassign them. Missing or ambiguous source welds produce
`TIEIN_LOCK_RESOLUTION_FAILED`. Vendor rows without IDs are supported only when
the source distance identifies a unique weld.

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
- matched/unmatched pairs, transform-domain `overlap`, wider
  `evidenceOverlap`, affine and consecutive-span residuals, deterministic
  robust-fit metadata, coverage, exclusions, and an auditable method version;
- legacy `offset`, `scale`, and existing diagnostics during migration.

## HU-CPA Regression

The 2024 launcher assembly before the permanent line must not be forced onto the
2026 full run. With the supplied workbooks, the deterministic regression is:

- operational TIE IN: OLD `4.243 m` / ID `70008` to NEW `1868.810 m`;
- accepted anchor pairs: `321`, including `258` weld knots;
- transform domain: OLD `4.243–2095.565 m`, NEW `1868.810–3946.498 m`;
- wider evidence envelope: OLD `4.243–2095.798 m`, NEW
  `1868.810–3947.278 m`;
- consecutive-span P95 absolute residual: `0.8501 m`;
- identical result with and without optional scientific packages.

The model must map 2024 onto 2026; it must not add a negative transform to the
master run.

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
- A partial run cannot fall back to a single manual scalar offset; manual
  scalar mode is retained only for legacy full-run comparison.
- Manual approval and excluded ranges remain audit evidence.
- No database migration or new dependency is required for this change.

Full-workbook regression command from the repository root:

```powershell
python backend/tests/validate_tiein_workbooks.py HU_CPA_2024.xlsx HU_CPA_2026.xlsx
```

## Engineering References

- Cenosco, [Girth Weld Matching Data](https://ims-handbook.cenosco.com/docs/pl-ili-comparison-girth-weld-matching-data): ordered weld matching, spool-length comparison, skipped/missing weld handling, and offset-trend review.
- Cenosco, [Match Defects and Corrosion Rates Tables](https://ims-handbook.cenosco.com/docs/pl-ili-comparison-match-defects-and-corrosion-rates-tables): proportional within-spool position mapping.
- Pipeline Operators Forum, [POF 310 Field verification for in-line inspection](https://pipelineoperators.org/cdn/d8bff8a1-5879-4028-b09d-cb1db576ec08/POF%20310%20Field%20verification%20for%20in-line%20inspection%20-%20Dec%202023.pdf): field landmark/GW referencing and traceable verification context.
