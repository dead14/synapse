# Spec: OneDirection Ordered Section Matching

## Objective

Add a `DTW_HUNGARIAN_ONE_DIRECTION` alignment strategy in which DTW owns the
GW pairing, users define processing sections on the current/NEW run from locked
GW pairs, and anomaly matching is monotonic. Each NEW anomaly searches for at
most one historical/OLD identity. A matched anomaly sequence must never cross,
reverse, or leave its NEW section.

## Tech Stack

- React 19 + TypeScript wizard UI
- Express controller and persisted wizard configuration
- Python DTW and anomaly matching engines
- Existing PostgreSQL `alignment_sessions.params_json` persistence

## Commands

- Backend tests: `npm test` from `backend/`
- Backend syntax: `npm run check` from `backend/`
- Frontend build: `npm run build` from `frontend/`
- Frontend lint: `npm run lint` from `frontend/`

## Project Structure

- `backend/src/python_engines/`: GW and anomaly matching logic
- `backend/tests/`: Python and Node regression tests
- `frontend/src/wizard/`: strategy-specific wizard steps
- `frontend/src/AlignmentPage.tsx`: wizard routing and persisted config

## Code Style

Matching helpers are deterministic pure functions where possible. Public
configuration uses explicit enum-like values (`MATCH`, `BYPASS`, `REVIEW`) and
additive fields so existing sessions remain readable.

## Testing Strategy

- Unit tests prove a crossing cost matrix cannot produce crossing pairs.
- Unit tests prove section boundaries must reference locked GW pairs and cannot
  overlap.
- Scenario tests prove output ordering and GW immutability.
- Frontend build and lint verify the wizard integration.

## Boundaries

- Always: NEW is the current reference run; OLD is the historical candidate run.
- Always: GW pairs come only from `gwMatchesFinal`.
- Always: anomaly matches increase in both OLD and NEW odometer order.
- Always: section/tolerance changes leave the locked GW snapshot unchanged.
- Ask first: database migrations, new dependencies, or removal of legacy strategies.
- Never: send GW rows into the anomaly cost matrix or silently repair invalid sections.

## Success Criteria

1. A crossing assignment is rejected even when it has a lower total cost.
2. Anomalies never match across a locked GW segment or configured NEW section.
3. Invalid/overlapping section definitions fail validation with a clear error.
4. `BYPASS` and `REVIEW` sections do not auto-match anomalies.
5. Empty section configuration remains backward compatible through an automatic
   full-pipeline section.
6. Wizard order is GW Matching -> Sectioning -> Scenario -> Anomaly Tolerances.
7. Existing backend tests, frontend build, and lint pass.

## Accepted Assumptions

- A section boundary is selected on NEW from a matched GW pair, never an orphan GW.
- Gaps between user sections are `UNSECTIONED` and are not auto-matched.
- Per-section tolerances are optional overrides of the global tolerance profile.
- Growth calculations run only after identity matching and never influence the
  matcher into accepting an invalid/crossing pair.
- The first implementation keeps the existing Results flow while making its
  anomaly matcher ordered and section-aware; unified live preview remains a
  later vertical slice.
