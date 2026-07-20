# ADR-001: Use a tenant-owned integrity execution ledger

## Status

Accepted

## Date

2026-07-16

## Context

Synapse previously held most alignment and FFS work in browser navigation state or alignment-session JSON. The product roadmap requires a reproducible path from inspection evidence through assessment, approval, repair, and verification. Compliance evidence must also remain attributable to a controlled requirement edition.

## Decision

Use additive PostgreSQL tables for integrity cases, approvals, repair plans, evidence, compliance requirements, Direct Assessment projects, CP surveys, and field packages.

All records are tenant-owned either directly by `organization_id` or indirectly through an organization-owned integrity case. Workflow transitions are validated by the service and constrained by database status checks. Repair requires an approved decision, and approval uses a four-eyes rule: the case owner cannot approve their own case.

## Alternatives considered

### Continue storing workflow in browser state

Rejected because decisions would disappear after navigation and could not support audit, approval, or evidence traceability.

### Store all new workflow inside alignment session JSON

Rejected because it prevents bounded queries, relational ownership checks, stable evidence identities, and controlled lifecycle constraints.

### Combine pipeline integrity and Facility RBI

Rejected because their asset models, calculation methods, validation evidence, and commercial scope differ. Facility RBI remains a separate add-on boundary.

## Consequences

- Migrations `003_integrity_execution.sql` and `004_direct_assessment_field.sql` are additive.
- New list APIs are tenant-scoped and bounded.
- Engineering calculations remain separate from approval records.
- Quantitative API 581 remains unavailable until licensed details and independent benchmarks exist.
- Production rollout requires applying migrations before enabling the new routes.
