# Spec: Integrity Overview Dashboard

## Objective

Provide the authenticated organization with a compact, evidence-backed integrity overview on the existing `/` dashboard route. The layout takes structural cues from the supplied reference: operational metrics, a pipeline context strip, severity distribution, latest inspection detail, corridor markers, and recent findings. The existing application header and all navbar menu positions remain unchanged.

The dashboard must present only measured or persisted values. A missing engineering value is displayed as unavailable; the UI must not fabricate pipeline length, an integrity score, personnel contact data, or map coordinates.

## Tech Stack

- React 19, TypeScript 6, Vite 8
- Express 5 and PostgreSQL
- Existing `GET /api/dashboard/stats` authenticated endpoint
- Node test runner and Oxlint

## Commands

```powershell
npm test --prefix backend -- --test-name-pattern dashboard
npm test --prefix frontend -- --test-name-pattern dashboard
npm run check --prefix backend
npm run lint --prefix frontend
npm run build --prefix frontend
```

## Project Structure

- `backend/src/modules/dashboard/` owns read-only organization-scoped dashboard aggregation.
- `frontend/src/domain/dashboard.ts` owns defensive normalization of the API response.
- `frontend/src/pages/Dashboard/` owns data presentation and page-scoped styling.
- `backend/tests/dashboard_metrics.test.js` and `frontend/tests/dashboardViewModel.test.ts` protect transformation contracts.

## API Contract

`GET /api/dashboard/stats` remains backward compatible and adds an `overview` object. The endpoint rejects requests without an organization context; all values are scoped to `req.user.orgId` through parameterized SQL.

```ts
type DashboardOverview = {
  primaryPipeline: { id: number | null; name: string | null; measuredLengthM: number | null; runCount: number };
  metrics: { activeIngestionJobs: number; criticalCases: number; dataQualityConfidencePct: number | null };
  latestRun: { id: number | null; vendor: string | null; surveyYear: number | null; uploadedAt: string | null; featureCount: number; measuredLengthM: number | null } | null;
  heatmap: { featureType: string; cells: Array<{ bucket: number; severity: 'none' | 'low' | 'medium' | 'high' | 'critical' }> }[];
  corridorMarkers: Array<{ id: string; chainageM: number; featureType: string; severity: 'low' | 'medium' | 'high' | 'critical' }>;
  recentFindings: Array<{ id: number; anomalyKey: string; title: string; responseCategory: string | null; stage: string; dueAt: string | null; owner: string | null; confidencePct: number | null }>;
};
```

### Measurement Semantics

- The primary pipeline is selected deterministically by the most recent `survey_runs.uploaded_at`, then `pipeline.id`. Its displayed measured length and all run/heatmap/corridor content are from that pipeline's latest run.
- `activeIngestionJobs` is organization-wide and counts only durable ingestion job states `queued` and `running`.
- `criticalCases` counts cases with persisted `response_category = immediate`; it is not an engineering severity score.
- `dataQualityConfidencePct` is the organization-wide mean of persisted integrity-case `data_quality_confidence`, expressed as a percent. It is explicitly not an integrity score.
- Heatmap and corridor colors are visual depth bands for sorting only: `<20`, `20–<40`, `40–<60`, and `>=60` percent wall-thickness depth. They are not a risk classification or engineering disposition. The heatmap includes at most five feature types and 24 fixed chainage buckets. Markers include at most five valid-depth features, sorted by depth, chainage, then ID.
- Invalid, negative, infinite, and unavailable chainages are excluded. The corridor is a chainage schematic, never a geographic map.
- The finding table is a bounded, priority-ordered case list (immediate-response first, then latest update), not a claim that all cases are newly discovered or open.

## Code Style

Use focused presentation components, semantic tables and headings, established `syn-*` tokens, native buttons and links, plus `aria-busy`, `role="status"`, and `role="alert"` for dynamic states. SQL must be parameterized and query only the organization associated with the authenticated request.

## Testing Strategy

- Backend unit tests verify severity mapping, numerical safety, and that the overview serializer retains unavailable values instead of inventing measurements.
- Frontend unit tests verify defensive normalization of optional overview fields and the existing next-action behavior.
- Browser verification checks the dashboard at 320px, 768px, 1024px, and 1440px; it also checks console output and the authenticated dashboard request.

## Boundaries

- Always: preserve the existing navbar, use actual persisted data, parameterize SQL, retain existing dashboard fields, and run tests/builds before handoff.
- Ask first: database migrations, new dependencies, navigation changes, or any production deployment.
- Never: fabricate engineering values, expose data from another organization, modify the existing header/navigation files, or commit unrelated working-tree changes.

## Success Criteria

- The dashboard displays four operational metrics, a primary pipeline context strip, heatmap, latest run, corridor schematic, and recent findings using `/api/dashboard/stats`.
- Empty, loading, and API-error states remain accessible and useful.
- Existing dashboard consumers continue to receive their prior response fields unchanged.
- Navbar markup, routes, and positioning remain untouched.
