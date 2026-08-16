# FFS intake rework — alignment-gated, engineer-selected

Status: accepted (27 Jul 2026) · Supersedes the CSV upload intake in `FfsSetupPage`
Amended (16 Aug 2026): **the review is a scope, not a gate** — see "Amendment:
coverage" at the foot of this document. Gates B and C below describe the original
design and no longer describe the product.

## Problem

Two defects in the current FFS module:

1. **Intake format.** `csvTemplate.ts` emits a flat 14-column CSV in which four
   pipeline-level parameters (Design Factor, OD, SMYS, P₀) are repeated on every
   anomaly row. The column set does not match the data the engine actually needs
   from an ILI run, and CSV is not the format the business works in.
2. **No gate on ILI data.** The "Import from ILI Alignment" tab feeds *every*
   comparison row that carries a `Source Key NEW` into B31G. Alignment output is
   not an FFS work list: it contains unmatched features, welds, geometry-only
   anomalies, and features whose growth evidence is not trustworthy. Deciding
   which features are worth a fitness-for-service calculation is an engineering
   judgement and must be recorded as one.

A third defect is fixed as part of this work: `alignmentImport.ts:195` writes the
mojibake key `'Operating Pressure Pâ‚€ [MPa]'` while the validator reads
`'Operating Pressure P₀ [MPa]'`, so every alignment import currently fails
validation with "Missing value". `ffsAlignmentImport.test.ts` asserts the broken
key and must be corrected with it.

## Decisions

| Decision | Choice |
| --- | --- |
| Intake source | **Alignment only.** The manual file-upload path is removed. |
| Intake format | Derived from what the B31G engine needs; materialised as Excel, not CSV. |
| Selection UI | **Its own page/step** after alignment, not another tab in `ResultsPanel`. |
| Default selection | **Nothing pre-checked.** Every FFS candidate is a deliberate engineer decision. |

## Eligibility — three gates

A feature reaches FFS only if all three hold:

**Gate A — session reached the final phase.**
`alignment_sessions.status = 'completed'`, produced by the Hungarian engine (not
manual alignment), with `params_json.resultSummary` present. Sessions that
stopped earlier never appear in the FFS session picker.

**Gate B — Corrosion Analysis review exists.**
The session has a saved FFS candidate selection with at least one selected
feature, and its `result_signature` still matches the current alignment result.

**Gate C — the feature itself is selected.**
`mapAlignmentRowsToFfs` receives the selected `Source Key NEW` set. Rows outside
it are counted in `skipped` — `noNewFeature` for the OLD side of the comparison,
`notReleased` for features the review held back. Neither is a rejection, and
listing them as one buried the released features that genuinely could not be
assessed: the operator was shown the first entry of that list, which is
invariably an OLD-only row, and told their release "does not contain a NEW-run
feature". `rejected` now holds released features alone, each with the field that
stopped it.

**Gate D — the feature carries the measurements B31G needs.**
`readMeasuredGeometry` is the single reader of this rule: `summariseReleasedIntake`
shows what the release would produce before the assessment runs, and
`mapAlignmentRowsToFfs` applies the same rule when it does. Position, depth,
length and width must come from the run — nothing else can supply them. Wall
thickness may fall back to a line nominal entered on the setup screen, because it
is a property of the pipe rather than of the defect; where it is used, the
feature carries a warning and `wallThicknessSource: 'line-nominal'` in its
provenance.

## Corrosion Analysis page

Route: `/alignment/:sessionId/corrosion`, reachable from the final alignment
phase (`/ili-comparison`) and from the alignment history list.

Every column below already exists in the comparison row produced by
`hungarian_engine.format_row` — no new engine work is needed for the table:

| Group | Fields |
| --- | --- |
| Identity | `Identif. NEW`, `Source Key NEW`, `Section NEW`, `Log Dist NEW (m)`, `O'Clock NEW` |
| Geometry | `Depth NEW (%WT)`, `Length NEW (mm)`, `Width NEW (mm)`, `Wall WT NEW (mm)`, `Surface NEW` |
| Growth | `Depth Growth (%WT/yr)`, `Length Growth (mm/yr)`, `Run Year OLD` → `Run Year NEW` |
| Screening | `ERF ASME NEW`, `Psafe NEW (bar)` |
| Confidence | `Match/Unmatch`, `Physics Warning`, `Data Kelengkapan` |

Interaction:

- One checkbox per row — **unchecked by default**.
- Bulk helpers that *propose* a selection the engineer can amend (metal loss with
  ERF ≥ review band; active growth; depth ≥ threshold). A bulk helper only ticks
  boxes; it never saves on its own.
- Optional free-text reason per selected feature, carried into the FFS
  provenance record.
- Explicit Save. Saving writes the selection plus the reviewer and timestamp.

## Persistence

New table (migration `010_ffs_candidate_selection.sql`). A row exists only for a
feature the engineer touched; absence means "not selected".

```sql
CREATE TABLE IF NOT EXISTS ffs_candidates (
    id               BIGSERIAL PRIMARY KEY,
    session_id       INTEGER NOT NULL REFERENCES alignment_sessions(id) ON DELETE CASCADE,
    organization_id  INTEGER REFERENCES organizations(id),
    source_key_new   TEXT NOT NULL,
    feature_id       TEXT,
    selected         BOOLEAN NOT NULL DEFAULT FALSE,
    reason           TEXT,
    result_signature TEXT NOT NULL,
    reviewed_by      INTEGER REFERENCES users(id),
    reviewed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (session_id, source_key_new)
);
```

**Staleness.** `result_signature` is derived from the session's result identity
(run pair + row count + result revision). When alignment is re-run the signature
changes, the saved selection is reported as `stale`, and Gate B fails until the
engineer re-reviews. This mirrors the guard already used for GW pair review in
`gwPairReviewPersistence.ts`, and exists so an FFS number can never quietly refer
to a superseded alignment.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/alignment-sessions/:id/ffs-candidates` | Saved selection + signature + `stale` flag |
| PUT | `/api/alignment-sessions/:id/ffs-candidates` | Replace the selection; validates the signature and that every key exists in the session result |
| GET | `/api/ffs/eligible-sessions` | Sessions passing Gates A and B, for the FFS session picker |

All three are org-scoped through the existing `authMiddleware` + owned-session
query pattern.

## FFS dataset

Since intake is alignment-only, the "template" is no longer an upload contract —
it is the **materialised dataset** the assessment ran on, written into the
results workbook as an auditable sheet. Fields are exactly what `processRow`
consumes, split by scope instead of repeated per row:

*Pipeline scope* (entered once on the Corrosion Analysis / FFS setup form):
Outer Diameter [mm], SMYS [MPa], Design Factor, Operating Pressure P₀ [MPa],
assessment method, flow-stress basis, ILI date.

*Per feature* (sourced from alignment, never typed by hand):
LD [m], Section, Surface, Max Depth [%WT], Length [mm], Width [mm],
Orientation, Nominal Wall Thickness [mm], CR Depth [mm/y], CR Length [mm/y],
plus provenance: `Source Key NEW`, `Identif. NEW`, alignment session id,
selection reason.

`CR Depth` comes from `Depth Growth (%WT/yr) × wall / 100` and `CR Length` from
`Length Growth (mm/yr)`. Fallback rates stay explicit inputs and every feature
that uses one is flagged in the import warnings.

## Removals

- `frontend/src/lib/ffs/csvTemplate.ts` and its download button.
- The PapaParse upload branch in `FfsSetupPage` (`runAssessment`, file state,
  drop zone, the upload/import tab switch).
- `REQUIRED_COLUMNS`-based header validation for user files. `validation.ts`
  keeps validating the mapped dataset, since the mapper can still produce
  out-of-domain values.

## Phasing

1. Backend: migration, contract, repository, controller, routes, tests.
2. Frontend: Corrosion Analysis page + entry points + persistence client.
3. FFS: remove the upload path, gate the import, fix the mojibake key, update
   `ffsAlignmentImport.test.ts`, add the dataset sheet to the results workbook.

---

## Amendment: coverage (16 Aug 2026)

Status: accepted · Amends Gates B and C above

### What went wrong

The original design made the Corrosion Analysis review both the *scope* of an
assessment and the *gate* on reaching one. In practice a run holds thousands of
anomalies and a review is ticked one feature at a time, so:

- an alignment with no review offered **nothing** to FFS, however complete it was;
- an anomaly nobody had got round to reviewing was absent from the assessment
  **with no trace of it anywhere in the report** — and absent from a report reads
  as "not there on the pipe", not as "not assessed";
- a feature whose vendor reported no circumferential width was refused outright,
  although B31G reads only depth and axial length, so entire runs from some
  vendors produced an empty assessment while the data the calculation needed was
  all present.

The common failure is the same one: a decision to *not look* at something was
being recorded as *nothing to see*.

### Decisions

| Decision | Choice |
| --- | --- |
| Gate A | **Unchanged.** No completed engine run, no assessment. |
| Gate B | **No longer a gate.** A missing, empty or stale review does not withhold the session; it only means there is no release to narrow the assessment to. |
| Gate C | **Becomes a scope.** `FfsIntakeScope` is `all` (default) or `released`. |
| Gate D | **Narrowed to what B31G reads.** Width is optional; distance, depth, axial length and wall remain required. |
| Coverage | Every NEW-run metal-loss anomaly is accounted for: assessed, or listed with the reason it was not. |

### Consequences

- `evaluateSession` returns `{ eligible, release: { available, stale, reason } }`.
  Eligibility follows Gate A alone; the release state is reported beside it so
  the setup screen can offer both scopes and name the one in use.
- `mapAlignmentRowsToFfs` takes `selection.scope`. Under `all` it assesses every
  row `isMetalLossCandidate` accepts — the same predicate the spool census uses,
  so "every anomaly on the line" and "every anomaly FFS considered" cannot mean
  two populations. Girth welds, fittings, dents and cracks are never candidates,
  and a row a reviewer excluded is never assessed under either scope.
- `RejectedAlignmentRow` carries `sourceKey`, `ldM` and `depthPct` as well as the
  reason, because this list is how the report accounts for an anomaly with no
  result. An anomaly that is neither assessed nor listed here has vanished.
- The results workspace gains a **Coverage** tab and the exported workbook gains
  a **Coverage** sheet, both built from `rejected` + `skipped` + `census`.
- `Width [mm]` moves from `REQUIRED_COLUMNS` to `OPTIONAL_COLUMNS`. A width of 0
  means "not reported"; the interaction screen and the spool area estimate
  already treated a non-positive width as unknown, and exports leave the cell
  blank rather than writing a zero nobody measured.
- Validation rules are keyed by column *name*. They were positional indexes into
  `REQUIRED_COLUMNS`, so moving a column silently re-pointed every rule at its
  neighbour.

### What is unchanged

The review still means what it meant: features an engineer deliberately released.
Choosing the `released` scope assesses exactly those and nothing else, and a
feature held back is reported as held back rather than dropped. What changed is
that not having made that decision yet no longer removes anomalies from the
report.
