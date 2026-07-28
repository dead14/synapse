# FFS Manual Intake and Sectioning UX

## Objective

Restore a controlled manual FFS intake path and make section creation practical
from the alignment evidence viewer, including unaligned girth welds.

## FFS source rules

- An assessment uses exactly one source: Corrosion Analysis release or manual
  workbook.
- Released alignment data retains the existing final-phase and engineer-review
  gates.
- Manual input accepts XLSX, XLS, or CSV up to 10 MB and 10,000 data rows.
- The downloadable workbook uses the exact B31G engine input columns.
- Both sources pass through the same engineering-domain validation and
  calculation engine.
- Manual provenance records the source filename and row count.

## Sectioning interaction

- The evidence viewer can be resized vertically and provides keyboard-operable
  size controls.
- BEND evidence is marked directly at its longitudinal position.
- Selecting two distinct GWs immediately establishes the inclusive section
  range and opens the section form.
- A visible option controls whether OLD-only and NEW-only GWs can be used as
  boundaries. They remain visually distinct and are never presented as matched.
- The selected interval is highlighted in the viewer before save.
- The Results toolbar no longer contains the redundant `Sectional` shortcut;
  sectioning remains part of the alignment workflow.

## Persistence boundary

Existing matched boundary keys remain backward compatible. Unmatched boundaries
need a stable side-qualified identity and their own measured distance. Saving a
section must not invent a counterpart GW or silently convert unmatched evidence
into a match.

## Verification

- Regression test for PostgreSQL eligibility query with a JSON session config.
- Workbook template, parse, header, empty-file, and row-limit tests.
- Range selection tests for matched and unmatched boundaries.
- Viewer model tests for BEND markers and optional unmatched GWs.
- Frontend build, frontend tests, and relevant backend test suites.
