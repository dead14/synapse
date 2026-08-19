# Pipeline dossier

## The problem

The alignment intake asked for the line's design data — diameter, wall, grade,
MAOP — and then threw it away. `pipelineData` lived in the wizard's navigation
state, reached the Excel export, and was gone on the next visit. FFS asked the
same engineer for the same numbers again, in different units and under different
names (`maopPsi` against a required pressure in MPa, a free-text
`"10 inch or 273.1 mm"` outer diameter against a numeric one), with nothing
linking the two screens to the same line.

A line built from more than one size had no answer at all. B31G carries the
outside diameter in the failure pressure and in the Folias term, and SMYS sets
the flow stress, so a line that steps from 20 in to 24 in at a reducer cannot be
assessed on one diameter — but the intake stamped a single value onto the whole
line and the only place a second one could be entered was the FFS section table,
by hand, once per assessment.

## The record

One dossier per pipeline, in two tables (`017_pipeline_specification.sql`):

- `pipeline_specifications` — one row per pipeline: asset and operations, the
  line default pipe, the pressures, and the ASME B31.4 code inputs.
- `pipeline_segments` — the **pipe register**: one row per stretch of uniform
  pipe, bounded on odometer metres from the launcher, carrying whatever it does
  not share with the line default.

Everything numeric is stored canonical — millimetres and megapascals, the units
the B31G kernel works in. Screens offer inches, bar and psi; what is stored
never depends on which was selected. Every field is nullable: "not recorded" is
an answer an assessment has to be able to report, and a defaulted zero is a
number that would silently be assessed against.

## Who writes it and who reads it

- **Alignment intake** (`wizard/StepUploadILI.tsx`) files it against the
  pipeline the runs import into. The upload response now carries `pipeline_id`
  for exactly this. Typing a line name that already has a dossier loads it back,
  unless the form has been typed into.
- **Pipeline register** (`/pipelines`) reads and corrects it without starting an
  alignment.
- **FFS setup** loads it when a session is selected and fills the line-level
  inputs from it. Only a field nobody has typed into is filled — an assessment
  that ran against a value the engineer chose keeps running against it.
- **Alignment Excel export** flattens it onto the Data Pipeline sheet, register
  included (`domain/pipelineExport.ts` ↔ `python_engines/export_excel.py`).

## Register versus section

The register is the **asset record**; the FFS section table is the
**assessment**. They are not merged, and the register does not replace the
section mechanism decided in the multi-diameter work: FFS still resolves
diameter, wall, SMYS and design factor per named section, because sections are
bounded on girth welds an engineer actually clicked.

What the register does is pre-fill them. A section's `[startLd, endLd]` is
matched against the register by `segmentForRange`, which picks the stretch it
**overlaps most** rather than requiring containment — the pipe book's chainage
and a girth-weld boundary describe the same line and will not agree to the
metre. A section that overlaps nothing takes the line default. Only what differs
from the line is written into the section cell, so a stretch that merely
restates the line diameter does not make every section report an override that
nobody entered.

## Boundaries

- The register never overwrites a typed section value; it fills blanks and
  replaces the seeded line default, nothing else.
- Wall thickness stays last in the evidence order it already had:
  `run-reported` > `joint-inherited` > `section-nominal` > `line-nominal`. A
  registered wall reaches the assessment as a section nominal, which is only
  used where the run reported none.
- Manual-workbook assessments are unaffected: those rows carry their own
  geometry and are never mixed with a released alignment.
