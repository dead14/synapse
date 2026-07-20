# Spec: Synapse End-to-End Optimization

## Objective

Make Synapse a truthful, loss-audited, fast pipeline-integrity workbench from
vendor-agnostic ingestion through tie-in, alignment, FFS, and RBI screening.
The application must never report a successful engineering calculation when a
mock or placeholder ran, and it must preserve every source row or explain its
disposition.

## Tech Stack

- React 19.2, TypeScript 6, Vite 8, Tailwind CSS 4.
- Express 5, PostgreSQL, Socket.IO, and bounded local jobs with a Redis-ready
  contract.
- Python NumPy/Pandas/SQLAlchemy engines for ingestion and alignment.
- ASME B31G-2023 for the existing corrosion screening implementation; API
  579-1/ASME FFS-1, API RP 580, and API RP 581 are reference boundaries. A
  feature may not claim conformance beyond its validated calculation scope.

## Commands

- Backend tests: `cd backend && npm test`
- Backend syntax: `cd backend && npm run check`
- Frontend tests: `cd frontend && node --test tests/*.test.ts`
- Frontend lint: `cd frontend && npm run lint`
- Frontend build: `cd frontend && npm run build`
- Full start: `npm start`

## Project Structure

- `backend/src/python_engines/`: ingestion, tie-in, and alignment engines.
- `backend/src/modules/`: tenant-scoped API and persistence boundaries.
- `engine/phylogenesis/`: multi-run canonical-anchor engine.
- `frontend/src/utils/`: API and file parsing contracts.
- `frontend/src/lib/ffs/`: B31G input validation and calculation.
- `frontend/src/lib/rbi/`: qualitative RBI screening, audit metadata, and tests.
- `docs/specs/`: engineering contracts and scope boundaries.

## Code Style

```ts
type SourceRowDisposition =
  | { type: 'ACCEPTED'; sourceRow: number; featureKey: string }
  | { type: 'REJECTED'; sourceRow: number; reasons: string[] };
```

Use stable source identities, explicit result variants, additive API fields,
and deterministic pure functions for engineering calculations. Avoid `any` at
new public boundaries.

## Testing Strategy

- Red/green unit tests for header detection, normalization, calculation, and
  alignment conservation.
- Scenario tests against the repository's representative XLSX files.
- Contract tests for tenant scoping, bounded payloads, pagination, and job
  failure semantics.
- Production build and browser checks at 320, 768, 1024, and 1440 px.
- Before/after measurements for ingestion reads, build chunks, API timing, and
  critical UI rendering.

## Boundaries

- Always: preserve source rows or return an auditable rejection; NEW remains
  the master; validate external input; use organization-scoped persistence;
  show method/version/assumptions with engineering results.
- Ask first: destructive data migration, deletion of legacy strategies,
  production deployment, or changing a validated engineering threshold.
- Never: silently coerce missing odometer to zero, silently drop filtered
  features, fabricate coordinates/confidence/trends, claim API 579/581
  compliance for an unvalidated approximation, or mark a mock job successful.

## Success Criteria

1. The parser selects the actual header row for all six representative ILI
   workbooks and the dictionary workbook; synchronous ZIP inflation is removed
   from the browser path for large workbooks.
2. Dictionary seeding resolves the repository workbook correctly, is
   repeatable, and populates PostgreSQL without deleting valid custom aliases.
3. Ingestion reads each workbook once for header discovery and once for data,
   reports accepted/rejected counts, and never leaves an orphan run on failure.
4. Alignment satisfies source conservation, unique pairing, ordered paths, and
   controlled failure. Tie-in exposes overlap, inliers, scale, residuals, and
   an ambiguity reason.
5. The phylogenetic option invokes a real, tested multi-run adapter or is
   explicitly unavailable; it can never pass through the mock worker.
6. List/dashboard queries are bounded, tenant-scoped, backed by appropriate
   indexes, and contain no fabricated metrics or coordinates.
7. FFS accepts aligned metal-loss data, validates physical ranges, exposes
   B31G method/version/units, and can be reproduced after navigation.
8. RBI provides an auditable qualitative screening and inspection-priority
   workflow. Quantitative API 581 claims remain disabled until validated input
   models and reference cases are supplied.
9. Initial JavaScript remains below 200 KB gzip; heavy 3D, chart, and workbook
   code loads only on demand; large tables remain responsive.
10. Backend tests/check, frontend tests/lint/build, runtime console/network,
    accessibility checks, and representative browser flows pass.

## Open Questions

- Production-grade FFS/RBI persistence should use additive tenant-owned tables;
  the first safe slice may persist draft metadata in the existing session JSON
  contract until a reviewed migration is ready.
- Quantitative API 581 implementation requires licensed calculation details and
  validated reference cases; it is outside the qualitative screening claim.
