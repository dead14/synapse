# FFS intake rework — alignment-gated, engineer-selected

Status: accepted (27 Jul 2026) · Supersedes the CSV upload intake in `FfsSetupPage`

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
`mapAlignmentRowsToFfs` receives the selected `Source Key NEW` set. Anything not
in it is returned as `rejected` with the reason
`"Not selected in Corrosion Analysis"`, so the count is visible rather than
silently dropped.

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
