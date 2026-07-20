# Spec: Alignment Data Review and GW Matching

## Objective

Improve the existing alignment wizard's Data Review and GW Matching stages in the light Synapse interface. The stages must expose persisted inspection evidence, let an engineer record an evidence review, and carry accepted/rejected GW locks into the next sectioning stage without changing the global header or navigation.

## Existing system contract

- The wizard is restored from an organization-scoped `alignment_sessions.params_json` record through `GET /api/wizard/session/:id`.
- Advancing a wizard stage calls `POST /api/wizard/save`, which updates the same owned session.
- `POST /api/align-dtw` resolves the two run IDs from the owned session, then stores its machine-derived `canonicalGwLocks` result before review can be saved.
- `gwMatchesFinal` is a derived ordered lock list consumed by sectioning and the downstream matcher; it cannot supply source IDs or odometers from the browser.

## Scope

### Data Review

- Present master and historical extraction counts, field coverage, anchor counts, and a concise evidence-readiness status.
- Require a deliberate acknowledgement before continuing when both runs contain records.
- Persist `dataReview` metadata with the session: status, server review timestamp, database-derived record counts, and reviewer acknowledgement.

### GW Matching

- Keep the DTW-derived pair data as the source of truth for odometer values.
- Add a selectable review disposition for a pair: accepted, needs review, or excluded, plus a bounded review note.
- Persist dispositions and notes in `gwReview` with the session, only for a known machine-derived canonical pair.
- Exclude pairs marked `excluded` from `gwMatchesFinal` when moving to sectioning; derive the resulting locks on the server and never mutate stored source coordinates or feature IDs.
- Show a light, responsive review queue with clear loading, empty, error, and saved states.

## Security and data boundaries

- All persistence remains behind the existing authenticated, organization-scoped wizard endpoints.
- Client review input is bounded and normalized before it is saved; the server repeats all validation, derives trusted counts/timestamps, and rejects unknown pair keys.
- Review saves carry the database row revision and fail with a conflict instead of overwriting a colleague's newer review.
- The feature does not create, expose, or query cross-organization data and adds no new dependency.

## Success criteria

- Data Review cannot silently continue with an unacknowledged populated run pair.
- GW review decisions survive wizard resume and influence the lock list sent to the sectioning stage.
- The visual implementation uses the existing light Synapse tokens, remains functional at narrow widths, and does not modify menu or header source files.
- Focused frontend and backend contract tests cover normalized review state, forged lock rejection, and server-derived evidence.
