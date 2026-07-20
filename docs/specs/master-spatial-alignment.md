# Spec: Master Spatial Alignment and Conservation

## Objective

Build a universal alignment workflow where the newest ILI run is the master, historical runs are aligned without reassigning locked GWs, every source feature is conserved exactly once, and spatial sectioning plus manual intervention remain auditable.

## Tech Stack

- React 19, TypeScript, Tailwind, Leaflet, Three.js.
- Express, PostgreSQL-backed alignment sessions, Socket.IO job events.
- Python NumPy engines for DTW, tie-in, and monotonic anomaly assignment.
- Redis/local job storage may cache work but must not be the only persisted copy.

## Commands

- Backend tests: `cd backend && npm test`
- Backend syntax check: `cd backend && npm run check`
- Focused Python tests: `python -m unittest backend.tests.test_dtw_engine_regressions backend.tests.test_hungarian_engine`
- Frontend lint: `cd frontend && npm run lint`
- Frontend build: `cd frontend && npm run build`

## Project Structure

- `backend/src/python_engines/`: alignment algorithms and conservation checks.
- `backend/src/modules/alignment/`: persisted session/job/API contracts.
- `backend/tests/`: engine and public-contract regression tests.
- `frontend/src/sectioning/`: linked master GW schematic and map.
- `frontend/src/wizard/`: upload, DTW, section, strategy, and execution flow.
- `frontend/src/ResultsPanel.tsx`: result review and intervention presentation.

## Code Style

```ts
type FeatureDisposition =
  | { type: 'MATCHED'; counterpartKey: string }
  | { type: 'UNMATCHED' }
  | { type: 'FILTERED'; reason: string }
  | { type: 'BYPASSED'; reason: string };
```

Use explicit variants and stable source keys. Do not use odometer alone as identity and do not mutate source rows during intervention.

## Testing Strategy

- Pure unit tests for stable keys, conservation, section partitioning, evidence scoring, and tie-in estimation.
- Scenario tests proving no data disappears through filters or manual reassignment.
- Contract tests for invalid section/intervention payloads.
- Production build plus authenticated browser smoke test when credentials are available.

## Boundaries

- Always: NEW is master; preserve raw features; validate ordered GW/anomaly paths; expose audit totals.
- Ask first: database migrations, external map services requiring credentials, new dependencies.
- Never: silently drop filtered records, represent inferred bends as surveyed geometry, report untrained probability as Naive Bayes, or store the only result copy in Redis.

## Success Criteria

- For each run: `input = matched + unmatched + filtered + bypassed`, with every stable source key appearing exactly once.
- No matched pair reuses an OLD or NEW feature and no ordered path crosses.
- DTW output and hidden raw features remain available after moving to sectioning.
- Sections cover the master axis exactly once; unnamed ranges are `UNCLASSIFIED`.
- Historical-only GWs are visible, sectioned by projected master chainage, and exported as `MISSING_IN_MASTER`.
- Depth decreases are preserved as matches but carry a physics-review warning.
- Manual strategy skips automatic anomaly assignment and routes records to intervention.
- Intervention is persisted as reversible events and cannot delete source identifiers.
- Tie-in returns a robust offset, overlap range, inlier statistics, and controlled failure for ambiguous partial runs.

## Multi-run Contract

The current `oldRun/newRun` fields remain supported. The additive target shape is `masterRun` plus `historicalRuns[]`; each pairwise result references stable run and feature keys. The first implementation keeps the existing two-run UI while making new data contracts extension-safe.

