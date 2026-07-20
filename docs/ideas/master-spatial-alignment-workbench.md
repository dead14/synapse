# Master Spatial Alignment Workbench

## Problem Statement

How might we let integrity engineers align the newest ILI run against one or more historical runs, classify every pipeline interval spatially, and correct uncertain matches without ever losing, duplicating, or silently rewriting a source feature?

## Recommended Direction

Use the newest uploaded ILI run as the immutable master axis. DTW locks the GW identity path first, section annotations partition that master axis, and ordered anomaly matching works only inside those locked boundaries. The GW schematic and optional map share one selection state, so a section created in either view appears in both.

Historical-only GWs remain first-class records with `MISSING_IN_MASTER` status and a projected master chainage derived from neighboring locked GWs. Manual intervention is an immutable event overlay on the machine result, never a destructive row copy. Until accepted/rejected intervention history exists, the UI reports a transparent evidence score rather than claiming a trained Naive Bayes probability.

## Key Assumptions to Validate

- [ ] Endpoint coordinates are sufficient for the first map MVP; richer route uploads can be added later.
- [ ] An inferred bend schematic is useful when clearly labelled `INFERRED`, even though it is not survey geometry.
- [ ] The newest run is always the master and one session may eventually contain multiple historical runs.
- [ ] A complete, non-overlapping partition with automatic `UNCLASSIFIED` coverage is safer than allowing section gaps.

## MVP Scope

- NEW-master GW viewer with an OLD comparison lane and explicit missing/only-master markers.
- Automatic inferred bend geometry using deterministic paired-bend behavior.
- Map route defined by manually entered endpoint coordinates; viewer and map selection stay synchronized.
- Complete section coverage with `UNCLASSIFIED` defaults and click-to-split boundaries.
- Data-conservation audit from source upload through export.
- Physics warnings for depth decrease and other implausible growth signals.
- Persistent, undoable intervention events with an explainable evidence score.
- A manual strategy that skips automatic anomaly assignment and opens intervention-ready results.

## Not Doing Yet

- Claiming inferred bend geometry is physical survey truth.
- Training Naive Bayes without labelled accepted/rejected intervention history.
- Depending on Redis as the source of truth; database/session data remains authoritative.
- Full KML/GeoJSON/GPX ingestion in the endpoint-coordinate MVP.
- Rendering all historical runs simultaneously before the two-run contract and conservation audit are stable.

## Open Questions

- Which route file formats should follow endpoint coordinates first?
- Which intervention decisions should be organization-wide training labels versus session-local overrides?

