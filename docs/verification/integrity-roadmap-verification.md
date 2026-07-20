# Integrity Roadmap Verification

## Verified on 2026-07-16

### Automated suites

- Backend Node tests: 63 passed.
- Python engine suites: DTW 7, Hungarian 27, tie-in 3, manual alignment 1, export layout 1, parser dictionary 4, parser ingestion 7.
- Frontend tests: 61 passed.
- Frontend production build: passed.
- Frontend lint: no errors; three pre-existing Fast Refresh warnings remain in context modules.
- `git diff --check`: no whitespace errors.

### Production artifact smoke

The Vite production preview returned HTTP 200 and the application root for:

- `/`
- `/integrity-timeline`
- `/integrity-workbench`
- `/repair-evidence`
- `/compliance-indonesia`
- `/pipeline-risk`
- `/direct-assessment`
- `/integrity/rbi`
- `/integrity/advanced-threats`
- `/integrity/copilot`

### PostgreSQL/PostGIS migration smoke

A disposable `postgis/postgis:15-3.3` container was started on an isolated port. The SQLAlchemy base schema and schema bootstrap completed successfully.

Migration ledger:

- `001_tenant_ownership.sql`
- `002_ingestion_evidence.sql`
- `003_integrity_execution.sql`
- `004_direct_assessment_field.sql`

Verified tables:

- `integrity_cases`
- `integrity_approvals`
- `repair_plans`
- `integrity_evidence`
- `compliance_requirements`
- `compliance_evidence_links`
- `direct_assessment_projects`
- `cp_surveys`
- `field_packages`

Verified constraints include integrity stage, evidence status, and repair-plan status checks.

### Real persistence lifecycle smoke

Using the repository layer against the disposable PostgreSQL instance:

1. Created an organization, owner, independent approver, and pipeline.
2. Created an integrity case.
3. Advanced Import → Validate → Align → Assess → Decide.
4. Confirmed owner self-approval was rejected.
5. Recorded independent approval.
6. Advanced the case to Repair.
7. Created a repair plan and dig-sheet payload.
8. Created NDE evidence.
9. Advanced Required → Requested → Submitted → Reviewed → Accepted.
10. Reloaded the case bundle and confirmed one approval, one repair plan, and one accepted evidence record.

The disposable container was removed after verification.

## Verification not available in this session

Visual browser, keyboard, accessibility-tree, console, and responsive checks at 320, 768, 1024, and 1440 px could not be executed because the required browser/computer-control runtime was not exposed to this session.

This is the only remaining verification gate. It is not evidence of a known UI defect; it is missing runtime evidence and must remain open before the roadmap can be declared fully complete.
