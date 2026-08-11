# Spec: Derived Weld Distance and Bayesian Drift Matching

## Objective

Two problems on the same axis — what happens after the girth welds are locked.

1. **A pipetally with no U/S GW distance column.** The distance from a defect to
   its own upstream girth weld is the strongest identity evidence in the record,
   because it survives an odometer that drifted. Many vendor exports do not carry
   it. It is recoverable from the odometer and the run's own girth-weld features,
   and the engine now does so.

2. **A section where the welds matched and the metal loss did not.** When the two
   runs are displaced by metres inside a locked section, a tolerance window
   centred on zero rejects every anomaly pair and the section returns welds only.
   A second matcher answers by weight of evidence instead of by window, and
   reports a posterior probability with the calculation behind it.

Neither change alters the tolerance-gated matcher's behaviour. The existing
engine's cost function, gates and solver are untouched; a seam was extracted so a
second matcher could plug in beside it.

## Tech Stack

- Python alignment engines (`backend/src/python_engines/`)
- Express/BullMQ alignment worker (`backend/src/modules/alignment/`)
- React 19 + TypeScript wizard and results panel

## Commands

- Backend tests: `npm test` from `backend/`
- Backend syntax: `npm run check` from `backend/`
- Frontend tests: `npm test` from `frontend/`
- Frontend build: `npm run build` from `frontend/`

## Part 1 — Deriving the U/S girth weld distance

### Rule

`dist_to_us_gw_m = feature odometer − odometer of the last girth weld at or
before it`, measured in the run's **native** chainage, before any tie-in
transform. A weld-relative quantity has to be measured in the axis the weld was
measured in; differencing two transformed values stretches it by whatever the
transform did locally.

Only **circumferential joint welds** are references. Seam, long-seam, spiral and
helical welds run along the pipe and are excluded; so are bends, valves, flanges
and tees, which `_is_gw_feature` accepts but a vendor's "U/S GW" column never
means.

### The generator

Derivation is also available as a standalone, reviewable step rather than only
as something the engine does at match time.

`backend/src/python_engines/gw_distance_generator.py` runs over one persisted
run:

```
python src/python_engines/gw_distance_generator.py <runId>          # preview
python src/python_engines/gw_distance_generator.py <runId> --apply  # write
```

Behind `GET` / `POST /api/runs/:id/gw-distance`, surfaced in the Data review step
as one panel per run. The preview and the apply are the **same pass** with the
commit withheld — not a separate estimate of what applying would do — which is
what makes the preview worth reading. It returns the girth-weld count, the
measured median joint length, vendor coverage, and worked samples
(`log distance − upstream weld = derived`) an engineer can check against the
pipetally by hand.

**Where the result goes.** `ili_features.dist_to_us_gw_derived_m`, plus
`us_gw_reference_m` recording which girth weld it was measured from — never over
`dist_to_us_gw_m`. Overwriting would destroy a surveyed number and leave nothing
able to tell a computed value from a measured one. `run_gw_distance_generation`
holds one row per run saying when the generator last ran and what it reached;
re-running replaces it, because only the current state of the column is
meaningful. Migration `014_derived_us_gw_distance.sql`.

**Generating is not using.** The column existing does not commit a comparison to
reading it. That stays with `us_gw_distance_source` below, which owns the
provenance-consistency rule. In `derived` mode the engine prefers the generator's
persisted values — those are the ones an engineer previewed and accepted — and
derives only what the generator did not cover, counting the two separately in
`audit.usGwDistance` (`fromGenerator` vs `derivedInEngine`).

**One girth-weld predicate.** The generator does not import the alignment engine
(that would drag pandas, numpy and the ORM into a job that needs arithmetic).
Both delegate to `gw_distance_derivation.is_girth_weld_feature`, and a test
asserts the two classify identically — one regex in one place.

### Provenance consistency

Derivation is applied to **both runs or to neither**. A vendor measures to the
weld centreline; this code measures to the odometer the weld feature was reported
at, and the two differ by a fixed bias per run. Comparing a vendor value on OLD
against a derived value on NEW would feed that bias straight into the identity
gate. This is why there is no per-run "fill the gaps" mode.

### Modes (`ToleranceConfig.us_gw_distance_source`)

| Mode | Behaviour |
| --- | --- |
| `uploaded` | Vendor column only. The historical behaviour. |
| `auto` | Vendor when **both** runs report it above `us_gw_distance_min_coverage` (default 0.9), derived for both otherwise. Default for new sessions. |
| `derived` | Always compute, ignoring the vendor column. |
| `off` | No weld-relative evidence. Equivalent to the old unchecked box. |

A session saved before the selector existed carries only `use_us_gw_distance`;
`false` resolves to `off` and `true` to `uploaded`, so no saved session's results
move.

Every result row carries `Dist GW Source OLD` / `Dist GW Source NEW`
(`vendor` or `derived`), and `audit.usGwDistance` records the mode, the reason,
per-run coverage and the derivation counts.

### Edge cases

- A defect upstream of the run's first girth weld has no upstream weld; the value
  stays `None` rather than being measured from nothing.
- A defect sitting exactly on a weld measures 0.0 from that weld.
- A run reporting no girth welds keeps whatever the vendor gave and raises a
  warning in the audit.

## Part 2 — Bayesian drift matching

### Selection

`ToleranceConfig.anomaly_matcher` ∈ `hungarian` | `bayesian_drift`, chosen in the
Tolerances step. It is a separate axis from `algorithm`, which still owns Phase 1
(the DTW girth-weld lock). `manual` and `phylogenetic` own both phases and ignore
the choice.

### The question it answers

> Given everything the two runs report about these two defects, how much more
> likely is the evidence if they are the same defect than if they are two
> unrelated defects that happen to lie near each other?

That ratio is a Bayes factor. It has no window, so it cannot empty a section.

### Stages

1. **Drift discovery.** Every OLD defect proposes a displacement to every NEW
   defect. Genuine pairs pile up at one value; coincidental ones scatter. The
   densest window of proposals is the section's displacement — a one-dimensional
   Hough vote, which is what makes a metres-wide shift harmless. An optional
   Theil–Sen slope catches a stretched odometer as well as a shifted one — it is
   guarded to ±2 %, accepted only when it tightens the fit, and only when it
   differs from 1 at all, so a section that never stretched does not report a
   correction it did not make. The displacement is measured *after* the
   locked-GW offset table, so it is the residual slip the locks did not explain.

   The vote is quadratic. Past `max_vote_pairs` (default 400,000) both runs are
   thinned by a deterministic stride; support and sigma are still measured
   against every defect, so only the *search* is sampled, never the evidence.

2. **Noise scale from the data.** Sigma is `1.4826 × MAD` of the supporting
   residuals, clamped to `[min_sigma_m, max_sigma_m]`. Nothing here is a slider.

3. **Evidence per channel.** Each channel contributes
   `log p(observation | same defect) − log p(observation | coincidence)`:

   | Channel | Same-defect model | Coincidence model |
   | --- | --- | --- |
   | Position | Normal(0, σ), σ measured above | Uniform over the section span |
   | U/S weld distance | Folded normal(σ = 0.10 m) | Folded triangular over the joint length |
   | Clock | Folded normal(σ = 12°) | Uniform over 180° |
   | Length | Two-piece normal — shrinkage σ 20 mm, growth σ 60 mm | Triangular over the section's observed length range |
   | Width | Two-piece normal — 25 / 75 mm | Triangular over the observed width range |

   The coincidence model is the actual distribution of the quantity in this
   section, so a channel that cannot discriminate contributes nothing rather than
   free confidence. Each channel is capped at ±12 nats so one mis-estimated
   spread cannot swamp the others.

   **The informativeness guard.** A channel counts only when the measurement is
   finer than the population it must discriminate within
   (`null_spread > spread`); otherwise its log-LR is set to exactly 0 and the
   channel is flagged `informative: false`. Without the guard the arithmetic
   misfires in a way that is easy to miss and hard to defend: a tool that sizes
   width to ±75 mm, used on a section whose widths all fall within 10 mm, has a
   same-defect density at zero difference *below* the coincidence density — so
   two defects agreeing perfectly on width score evidence *against* being the
   same defect. The maths is right and the conclusion is absurd, because the
   model was asked a question the data cannot answer. On the reference fixture
   this alone moved a pair from 5.89 to 8.42 nats (99.72 % → 99.98 %).

   **Depth is excluded.** It is the growth measurement the alignment exists to
   produce; using it to choose pairs would make the result circular. This matches
   the rule the tolerance-gated matcher already follows.

4. **Assignment.** An order-preserving dynamic program maximises the *total* log
   Bayes factor. Unlike the gated solver it does **not** maximise cardinality
   first: an extra pair carrying no evidence is not worth taking, and forcing
   cardinality is how a matcher invents identities. A pair is eligible only when
   its score exceeds `accept_log_bayes_factor` (default 0 — "same defect" must
   beat coincidence).

5. **Posterior.** `exp(score)` is already odds against coincidence, so the "no
   match" hypothesis enters each normalisation with weight 1 and never
   disappears. The reported confidence is `min(row posterior, column posterior)`:
   a pair is confident only when it is the best explanation of **both** defects.

6. **Monte-Carlo calibration (optional, default 200 trials).** The section is
   re-matched against synthetic runs with the same defect count and the same
   attribute marginals, with the association between position and attributes
   destroyed. The reported p-value is the fraction producing evidence at least as
   strong, with the standard `(k+1)/(n+1)` correction. Seeded, so it is
   reproducible. Skipped — and said to be skipped — when the section exceeds
   `max_permutation_cells`.

### Tuning (`ToleranceConfig.bayesian`)

`drift_bandwidth_m`, `max_drift_m`, `min_sigma_m`, `max_sigma_m`, `weld_sigma_m`,
`joint_length_m` (defaults to the line's measured median joint length),
`clock_sigma_deg`, `length_shrink_sigma_mm`, `length_growth_sigma_mm`,
`width_shrink_sigma_mm`, `width_growth_sigma_mm`, `prior_match_probability`,
`accept_log_bayes_factor`, `allow_scale`, `permutation_trials`.

None of these is a gate. Widening one makes the matcher less discriminating; it
does not make it admit a pair it had rejected on distance, because there is no
distance rejection.

`accept_log_bayes_factor` is clamped to ≥ 0. The solver maximises a *sum* of
scores, so a negative-scoring pair always makes its chain worse and is dropped
whatever the threshold says; a negative setting would be an inert knob, so it is
refused rather than offered.

## Keeping the two matchers apart

A cost and a posterior are different claims. Every matched row carries
`Match Method`, and then **either** `Match Cost` (tolerance-gated) **or**
`Match Confidence (%)` and `Match Log Bayes Factor` (Bayesian) — never both. The
unused columns hold `-` so the table schema stays stable.

The full calculation is attached as `match_evidence`, hidden from the table by
`isAlignmentDisplayMetadata` and rendered by `MatchEvidenceDrawer`, which has two
separate renderers for the same reason.

That object is stored once per matched row, so it carries **numbers only** —
roughly 1.1 KB for a Bayesian pair, 0.6 KB for a gated one. The wording lives in
the drawer and is rebuilt from the channel name and `nullSpread`. Prose in the
payload would be the same sentences written tens of thousands of times into
`alignment_job_rows`.

`audit.matcher` reports the method, per-segment statistics, and the matcher's own
configuration: gates and weights for the tolerance-gated engine, model spreads
and decision thresholds for the Bayesian one. Nothing merges the two.

## Registering a matcher

Four places, or the UI and the engine will disagree about what ran:

1. `ANOMALY_MATCHERS` in `backend/src/modules/alignment/anomalyMatchers.js`
2. `ANOMALY_MATCHERS` in `frontend/src/wizard/matchingRules.ts`
3. the engine script, with its own `MATCH_METHOD`
4. `MATCH_METHOD_LABELS` in `frontend/src/utils/alignmentDisplay.ts`

`anomaly_matchers.test.js` enforces 1 and 3 against each other.

## Project Structure

- `backend/src/python_engines/gw_distance_derivation.py`: weld-relative distance, pure.
  Derivation happens inside the run, driven by `us_gw_distance_source` in the
  Tolerances step; there is no separate per-run generate-and-persist step.
- `backend/src/python_engines/bayesian_matcher.py`: the probability model, pure
- `backend/src/python_engines/bayesian_engine.py`: adapts run features into it
- `backend/src/python_engines/hungarian_engine.py`: shared pipeline, `match_segment` seam
- `backend/src/modules/alignment/anomalyMatchers.js`: matcher registry
- `frontend/src/components/comparison/MatchEvidenceDrawer.tsx`: the calculation, per matcher

## Out of scope

The Excel report keeps its fixed 42-column layout; the evidence columns are
on-screen only. Adding them means extending `NEW_HEADERS`/`CENTER_HEADERS` in
`export_excel.py` and updating `test_export_excel_layout.py`.
