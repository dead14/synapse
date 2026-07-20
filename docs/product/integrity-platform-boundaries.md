# Synapse Integrity Platform Boundaries

## Product sequence

1. Data Trust Foundation: vendor-agnostic ingestion, row disposition, tie-in, alignment, stable identity, provenance, and confidence.
2. Polyginesis Multi-Run Integrity Timeline: genealogy, growth, uncertainty, exceptions, and auditable overrides.
3. Integrity Execution Core: FFS decision support, ordered case workflow, approval, repair, excavation, NDE, and close-out evidence.
4. Indonesia Compliance Pack: controlled requirement editions, applicability, evidence mapping, gap actions, and dossier readiness.
5. Planning and field modules: transparent risk/what-if, Direct Assessment and CP, GIS/LRS, and offline field packages.
6. Facility RBI add-on: isolated facility data model and commercial boundary.
7. Advanced threats and copilot: bounded crack, dent/strain, geohazard workflows and advisory-only engineering assistance.

## Engineering claim policy

- ASME B31G-2023 is currently exposed as pipeline corrosion remaining-strength screening.
- Every FFS decision must retain source run, source feature, calculation version, units, assumptions, confidence, and missing evidence.
- A calculated acceptance result is not an approval. Human engineering review remains mandatory.
- Pipeline risk is an internal qualitative screening method with transparent drivers and uncertainty. It does not claim API 580 or API 581 compliance.
- Quantitative Facility RBI API 581 remains unavailable until licensed calculation details, validated input models, independent benchmarks, and documented verification are supplied.
- Direct Assessment workflows do not select procedures or acceptance criteria automatically; qualified engineering approval is required.
- GPS is a spatial observation. It does not silently replace authoritative engineering chainage.
- Advanced-threat calculations remain unavailable until validated adapters and benchmark cases are supplied.
- Copilot output cannot approve assessments, set operating limits, accept evidence, or close repair actions.

## Lifecycle invariants

- Integrity cases advance only through Import → Validate → Align → Assess → Decide → Repair → Verify.
- Repair cannot begin without an approved decision.
- Evidence advances only through controlled status transitions and must be reviewed before acceptance.
- Accepted evidence is never edited in place; replacement evidence supersedes the prior record.
- Compliance readiness counts only accepted evidence. Submitted evidence remains pending review.
- Mobile conflicts are explicit when local and server revisions both diverge from the downloaded base.

## Persistence

Migration `003_integrity_execution.sql` adds tenant-owned integrity cases, approvals, repair plans, evidence, compliance requirements, and evidence links. The schema is additive and keeps pipeline integrity separate from Facility RBI.
