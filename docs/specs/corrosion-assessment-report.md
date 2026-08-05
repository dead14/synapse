# Spec: Post-Alignment Corrosion Assessment Report

## Objective

After a completed alignment session, the user can generate a **Corrosion
Assessment Report** (Excel workbook) directly from the alignment results, and
optionally hand the assessed dataset to the FFS module via an opt-in checkbox.

Corrosion assessment is **not** FFS and must not replace it:

- **Corrosion assessment (this report)** — screening-level, run-comparison
  driven: corrosion growth rates from matched anomalies, ERF screening per
  POF 100 §2.6.2, remaining-life and reinspection-interval estimates, response
  categories, and POF-style statistics. It is the primary deliverable of the
  application (the app exists to analyse corrosion).
- **FFS module (`/ffs`)** — detailed per-defect ASME B31G assessment with its
  own workflow, screening tiers, and narrative outputs. The checkbox at the end
  of the corrosion-assessment flow feeds it; nothing more.

## Standards basis (traceability)

| Element | Source |
| --- | --- |
| Report structure, general info block, statistics, dig sheet | POF 100 "Specifications and requirements for in-line inspection of pipelines" §7.3, App 6/7/9 |
| Run-comparison layout (RUN OLD \| Δ \| RUN NEW + comment) | POF 100 §7.5, App 9 — matches the existing `export_excel.py` layout |
| ERF definition | POF 100 §2.6.2: `ERF = MAOP / Psafe` (MAOP, not MOP/Pop) |
| Psafe / failure pressure | ASME B31G-2023 Level 1 (Original + Modified 0.85dL), parity with `frontend/src/lib/ffs/calcEngine.ts` |
| Metal-loss dimension classes | POF 100 §2.4.1 (GENE, PITT, AXGR, CIGR, PINH, AXSL, CISL; `A = max(10 mm, t)`) |
| Response categories & timing | ASME B31.8S §7 (Pf/MAOP ratio bands), 49 CFR 192.933 / 195.452 screening concepts |
| CGR from run comparison, half-life rule, reassessment = ½ remaining life | NACE SP0102 / industry practice (ROSEN CGA, Irth CIM, TDW) |
| Tool sizing tolerance context | API 1163; default MFL depth tolerance ±10 %WT at 80 % certainty |

A feature may not claim conformance beyond its validated calculation scope
(see `docs/product/integrity-platform-boundaries.md`). The cover sheet states
method editions and every assumption used.

## Workbook layout

File: `synapse_corrosion_assessment_<pipeline>_<sessionId>.xlsx`, generated
server-side (openpyxl). Six sheets, in user-facing order:

### Sheet 1 — General Information (cover)

POF 100 requires this block on every list. Three sections, values from the
Pipeline Data form (see UI flow) plus session metadata:

1. **Report** — report title, report ID (sessionId), generation date, operator
   /client name, prepared-by, ILI contractor(s).
2. **Pipeline data** (user-entered, required unless noted):
   - Pipeline name, from → to, product, length (km)
   - Outside diameter OD (mm), nominal wall thickness (mm, fallback when a
     feature has no WT), pipe grade (API 5L picker) → SMYS (MPa)
   - MAOP (bar), operating pressure Pop (bar, optional), design factor F,
     construction year (optional), coating type (optional), CP status
     (optional)
3. **ILI runs** — for OLD and NEW: vendor, tool technology (MFL/UT/…), run
   date, features reported, depth sizing tolerance (± %WT) and certainty
   (default ±10 %WT @ 80 %).
4. **Assessment settings** — method (B31G Modified default / Original), flow
   stress mode (`SMYS+69 MPa` default / `1.1·SMYS`), forecast horizon N years
   (default 5), CGR basis for unmatched-new defects (full interval default /
   half interval), depth limit (80 %WT), ERF thresholds (repair ≥ 1.0, review
   ≥ 0.9), method editions (ASME B31G-2023, POF 100:2021).

### Sheet 2 — Alignment Data

The existing `export_excel.py` layout (DATA NEW | KOMPARASI NEW−OLD | DATA
OLD) unchanged, **plus two comparison columns that the engine already
computes but the export drops**: `Depth Growth (%WT/yr)` and
`Length Growth (mm/yr)` (`hungarian_engine.py:1404-1411`). Physics warnings
(`DEPTH_DECREASE`) surface in the comment/status column.

### Sheet 3 — Metal Loss Listing (NEW run)

Pipe-tally-style list (POF App 7) filtered to metal-loss anomalies of the NEW
run (matched + only-NEW). Columns: No · Feature ID · Log Dist (m) · Joint No ·
Dist to US GW (m) · Wall WT (mm) · O'Clock · Surface (Int/Ext) · Feature
Identification · Dimension Class (POF) · Depth (%WT) · Depth (mm) · Length
(mm) · Width (mm) · Vendor ERF · Vendor Psafe (bar) · Comment.

Feature filter: `Result Group == 'ANOMALY'` and feature type/identification
mapping to metal loss (corrosion, metal loss, mill anomaly, grinding);
non-metal-loss anomalies (dents, gouges as deformation, cracks) are excluded
from assessment and counted separately in Sheet 5.

### Sheet 4 — Corrosion Assessment (core)

One row per metal-loss anomaly of the NEW run. Column groups:

**A. Identity & location** — No · Feature ID NEW · Log Dist NEW (m) · Joint
No · Dist GW (m) · O'Clock · Surface · Dimension Class.

**B. Size (NEW)** — WT ref (mm) · Depth (%WT) · Depth (mm) · Length (mm) ·
Width (mm).

**C. Growth (run comparison)**
- Match status (`Matched` / `New`)
- Depth OLD (%WT) · ΔDepth (%WT) · ΔLength (mm)
- Interval Δt (years, from run dates; fallback run years)
- CGR depth (mm/yr and %WT/yr); CGR length (mm/yr)
  - Matched: pit-to-pit `Δd / Δt`; negative Δ floors to 0 for projection and
    flags `Review (depth decrease)`.
  - New (only-NEW): grown-from-zero over Δt (default, conservative) or over
    Δt/2 (half-life option); basis flagged per row.
- **Activity classification** against combined tool tolerance
  `tol_c = √(tol_OLD² + tol_NEW²)` (default √(10²+10²) ≈ 14.1 %WT):
  `Active (significant)` if ΔDepth > tol_c · (band factor 1.0) ·
  `Possibly active (within tolerance)` if 0 < ΔDepth ≤ tol_c ·
  `Stable` if ΔDepth ≤ 0 with |Δ| ≤ tol_c · `Review (depth decrease)` if the
  engine emitted `DEPTH_DECREASE`.

**D. Integrity today (computed, B31G)** — Failure stress Sf (MPa) · Failure
pressure Pf (bar) · **Psafe = Pf / SF** (bar) · **ERF = MAOP / Psafe** · vendor
ERF (for cross-check; discrepancy > 0.1 flagged, not reconciled).

SF is the safety factor, not the design factor. Where the assessment supplies
the para. 1.9 hydrotest-to-MAOP ratio it is used directly; otherwise it falls
back to the historic `SF = 1/F`, and the report states which of the two it
applied. `Psafe = Pf · F` is only equivalent in the second case.

**E. Projection & remaining life** — Projected depth at +N yr
(`d + CGR·N`, capped at wall) · Projected ERF at +N yr (recomputed with
projected depth and, where a rate exists, projected length) · Remaining life to
d = 80 %WT (closed form) · Remaining life to ERF = 1 (bisection over the
analysis horizon) · Governing remaining life = min · Estimated date (run date +
governing life).

A limit that falls outside the analysis horizon is reported as **not reached**,
never as the horizon itself. The earlier draft answered `200` years with the
criterion `N/A (≥200yr)`, which reads as a service-life claim rather than the
absence of one — a reader cannot tell a genuine 200-year projection from a
search that simply stopped. Where no positive growth rate exists at all, the
status is `insufficient-growth-basis` and no date is issued.

Formula parity with `frontend/src/lib/ffs/b31g.ts` and `remnantLife.ts` is
enforced by `backend/tests/test_b31g_parity.py` and
`frontend/tests/ffsB31gParity.test.ts`, which read one shared vector file
(`backend/tests/b31g_golden_vectors.json`) generated from the TypeScript engine.

**F. Response** — Category:
- `IMMEDIATE` — ERF ≥ 1.0 or depth ≥ 80 %WT
- `SCHEDULED` — 0.9 ≤ ERF < 1.0, or governing remaining life < forecast
  horizon N
- `MONITOR` — otherwise
Priority rank (sort ERF desc, tie → remaining life asc) · Recommendation text
(generic: verify in field / repair per operator procedure; no repair-method
engineering claims).

### Sheet 5 — Statistics & Summary (POF §7.3.4.1)

- **Run comparison** — features OLD/NEW totals, matched count & rate, new,
  not-re-detected (only-OLD), bypassed/filtered counts (conservation audit).
- **Counts** — internal vs external; per POF dimension class; per 10 % depth
  band; per 0.1 ERF band starting at 0.6.
- **CGR statistics** — mean / P50 / P95 / max (overall, internal, external);
  count of Active vs Possibly-active vs Stable.
- **KPI box** — max depth, max ERF, min remaining life, # IMMEDIATE,
  # SCHEDULED, **recommended reinspection interval =
  clamp(½ · min governing remaining life, 1, 10) years** with basis note
  (B31.8S half-life practice).
- **Top 20 critical anomalies** (by ERF, then remaining life) with location.
- Charts (phase 2, openpyxl native): depth histogram OLD vs NEW, ERF band bar,
  clock-orientation distribution, CGR histogram.

### Sheet 6 — Repair / Dig List

Rows with category ≠ MONITOR, POF §7.3.6 subset for field verification: rank ·
feature ID · log dist · joint no · joint length · dist to US/DS GW · clock ·
surface · dims · WT · ERF · remaining life · category · target date
(IMMEDIATE → now; SCHEDULED → run date + min(remaining life/2, 2 yr)).

## Calculation rules (engine)

- **B31G Modified** (default): `z = L²/(D·t)`; `M = √(1+0.6275z−0.003375z²)`
  for z ≤ 50 else `0.032z+3.3`; `d/t` cap 0.8; Sf = Sflow ·
  `(1−0.85·d/t)/(1−0.85·d/t/M)`; Sflow per saMode. **Original**: parabolic
  2/3dL for z ≤ 20, cap `d/t ≤ 0.8`. Pf = 2·Sf·t/D; Psafe = Pf·F;
  ERF = MAOP/Psafe. Port to Python with golden-vector tests against the
  frontend implementation (`ffsCalcBranches.test.ts` fixtures) — the two must
  not drift.
- Depth mm = %WT · WT_ref/100; WT_ref = feature WT, fallback nominal WT from
  form (flagged when fallback used).
- Units: vendor pressures bar; SMYS MPa; conversions explicit
  (1 MPa = 10 bar).
- Δt from ILI run dates (form; prefilled from `SurveyRun.survey_year`),
  minimum 0.5 yr guard against divide-by-near-zero.
- All text cells pass `safe_cell_value` (formula-injection guard) as in
  `export_excel.py`.

## Architecture

- New engine: `backend/src/python_engines/corrosion_assessment_report.py`.
  Shared styling/guard helpers extracted from `export_excel.py` into
  `excel_common.py` (no behaviour change to the existing export).
- New endpoint: `POST /api/alignment/export-corrosion-report` in the alignment
  module, same guardrails as export-excel (row cap 100k, concurrency 3, 2-min
  timeout, temp-file JSON handoff). Server re-reads comparison rows from
  `alignment_jobs.result_json` by sessionId (do not trust a client payload for
  an engineering report); client sends only `pipelineData` +
  `assessmentConfig`.
- Persist the form in `alignment_sessions.params_json.pipelineProperties` so
  the next export prefills; a dedicated pipeline-properties table is a later
  migration (DB currently stores no pipe metadata — `models.py` `Pipeline` has
  name only).
- v1 scope: hungarian/manual sessions (display-schema rows). Phylogenetic
  sessions emit snake_case rows and are out of scope until a mapper exists.

## UI flow

At the end of alignment results (`ResultsPanel`, next to Export Excel):
**"Corrosion Assessment"** button → dialog:

1. Pipeline Data form (Sheet 1 fields; required: OD, nominal WT, grade/SMYS,
   MAOP, design factor; run dates prefilled and editable).
2. Assessment settings (defaults above).
3. Checkbox — **"Load results into FFS module after export"** (unchecked by
   default).

- Unchecked → generate & download the workbook. Done.
- Checked → download **and** navigate to `/ffs` with the session preloaded:
  the FFS alignment-import mapper receives the same pipeline params
  (OD, SMYS, design factor, pressure) and per-feature `CR Depth [mm/y]` /
  `CR Length [mm/y]` from the computed CGR, so FFS setup arrives pre-filled.

## Fixes required en route

1. `frontend/src/lib/ffs/alignmentImport.ts:195` — mojibake column key
   `'Operating Pressure Pâ‚€ [MPa]'` must be `'Operating Pressure P₀ [MPa]'`;
   `frontend/tests/ffsAlignmentImport.test.ts:46` currently asserts the broken
   key. Until fixed, every alignment→FFS import fails validation.
2. Alignment Excel export drops the growth columns the engine computes — add
   to Sheet 2 (and to the existing standalone export's comparison block).
3. MAOP vs P₀: the report uses MAOP for ERF (POF-compliant). FFS consumes
   operating pressure P₀; the handoff maps MAOP → P₀ by default with an
   explicit note. Adding a distinct MAOP field to FFS is phase 3.

## Non-goals / stated limitations

- No clustering / interaction rules (POF §2.6.1): single-defect B31G rectangle
  basis; stated on the cover sheet.
- No RSTRENG / DNV-RP-F101 / API 579 — B31G family only (existing platform
  boundary).
- Deterministic tolerance banding, not probabilistic CGR; signal-to-signal
  comparison is vendor territory.
- Two-run pit-to-pit CGR; ≥3-run trend fitting exists
  (`backend/src/python_engines/growth_analysis.py`, tested, unrouted) and is
  the phase-3 upgrade path for chain sessions.
- Vendor ERF is displayed for cross-check only; the report never averages or
  reconciles vendor vs computed values.

## Phases

1. **Phase 1** — engine + endpoint + dialog (form, settings), Sheets 1–6
   without charts, session prefill persistence.
2. **Phase 2** — FFS handoff checkbox incl. mojibake fix and mapper extension;
   native charts; optional P95-per-joint CGR mode (Irth-CIM-style).
3. **Phase 3** — multi-run chain CGR via `growth_analysis.py`, clustering /
   interaction rules, MAOP field in FFS, pipeline-properties table.

## Acceptance checks

- Python B31G outputs match frontend golden vectors (Original + Modified, both
  saModes, z branches, cap branches) to 1e-9 relative.
- Workbook opens in Excel/LibreOffice; no formula-injection (leading `=+-@`
  escaped); 100k-row session completes within the 2-min budget.
- ERF equals MAOP/Psafe on hand-checked vectors; response categories follow
  the threshold table; reinspection interval = clamp(½·min life, 1, 10).
- Matched pair with negative Δdepth → CGR 0, `Review (depth decrease)`, not
  Active; only-NEW feature gets grown-from-zero CGR with basis flag.
- Export with checkbox on lands in `/ffs` with rows passing `validateData`
  (post-fix) and CR Depth populated from CGR.
