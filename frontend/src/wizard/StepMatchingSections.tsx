import { useEffect, useMemo, useState } from 'react';
import { FiAlertTriangle, FiChevronLeft, FiChevronRight, FiMap, FiTarget } from 'react-icons/fi';
import { type SectionDraft } from '../sectioning/SectionComposer';
import GwPositionCard from '../sectioning/GwPositionCard';
import SectioningSchematic from '../sectioning/SectioningSchematic';
import { bendAngleDeg } from '../sectioning/bendGeometry';
import SectionMap from '../sectioning/SectionMap';
import SectionTable from '../sectioning/SectionTable';
import SectionWorkbench from '../sectioning/SectionWorkbench';
import type { BrushMarker } from '../sectioning/SectionRangeBrush';
import type { BoundaryEdge } from '../sectioning/SectionBoundaryInputs';
import { lockedIndexOf } from '../sectioning/sectionBuilder';
import { buildMatchingSpatialFeatures } from '../sectioning/matchingSpatialFeatures';
import { MAX_SCHEMATIC_ZOOM, canInspectGwPrecisely, clampSchematicZoom } from '../sectioning/viewOptions';
import { coveragePercent } from '../sectioning/sectionRanges';
import type { SectionDef, SpatialFeature } from '../sectioning/types';
import { apiFetch } from '../utils/api';
import {
  type MatchingSection,
  deleteMatchingSection,
  normalizeLockedGws,
  resolveSectionDistances,
  saveSectionRange,
  validateSectionOrder,
} from './matchingSections';
import { fetchSectioningAnchors } from './sectioningEvidence';
import { pairGwResult, primaryRunPair, resolveRunPairs, sectionsForPair } from '../domain/runPairs';
import ShareSnapshotButton from '../components/sharing/ShareSnapshotButton';
import {
  ActionBar,
  Button,
  Callout,
  Panel,
  PanelBody,
  PanelHeader,
  Segmented,
  Stat,
  StatGrid,
} from '../components/ds';

interface Props {
  config: any;
  onBack: () => void;
  onNext: (data: { matchingSections: MatchingSection[] }) => void;
}

const SECTION_TYPES: Array<[string, string]> = [
  ['UNCLASSIFIED', 'Unclassified'], ['BUR', 'Buried'], ['AL', 'Aerial'],
  ['RL', 'River Crossing'], ['ROC', 'Road Crossing'], ['RIS', 'Riser'],
  ['CAS', 'Cased'], ['OTH', 'Other'],
];
const EMPTY_RUN: Record<string, unknown> = {};

const lockedKey = (feature: SpatialFeature) => String(feature.rawData.lockedKey ?? '');

export default function StepMatchingSections({ config, onBack, onNext }: Props) {
  const pairs = useMemo(() => resolveRunPairs(config?.summaryData), [config?.summaryData]);
  const primaryPair = useMemo(() => primaryRunPair(config?.summaryData), [config?.summaryData]);
  const [activePairKey, setActivePairKey] = useState<string | null>(null);
  const activePair = pairs.find((pair) => pair.key === activePairKey) ?? primaryPair ?? pairs[0] ?? null;

  // Sections are drawn against the NEW side of the pair being sectioned, which in
  // an intermediate chain transition is not the master run.
  const masterRun = useMemo(
    () => activePair?.newRun || config?.summaryData?.masterRun || config?.summaryData?.newRun || EMPTY_RUN,
    [activePair, config?.summaryData?.masterRun, config?.summaryData?.newRun],
  );
  const masterRunId = Number(masterRun.runId);
  const rawMasterRows = useMemo(
    () => Array.isArray(masterRun.rawFeatures) ? masterRun.rawFeatures : [],
    [masterRun.rawFeatures],
  );
  const [persistedMasterRows, setPersistedMasterRows] = useState<any[]>([]);
  const [isLoadingMasterEvidence, setIsLoadingMasterEvidence] = useState(false);
  const lockedGws = useMemo(
    () => normalizeLockedGws(pairGwResult(config, activePair)?.gwMatchesFinal || []),
    [config, activePair],
  );

  useEffect(() => {
    if (!Number.isSafeInteger(masterRunId) || masterRunId < 1) {
      setPersistedMasterRows([]);
      return;
    }
    const controller = new AbortController();
    setIsLoadingMasterEvidence(true);
    void fetchSectioningAnchors(
      masterRunId,
      controller.signal,
      (path, signal) => apiFetch(path, { signal }),
    )
      .then((rows) => {
        if (!controller.signal.aborted) setPersistedMasterRows(rows);
      })
      .catch((error) => {
        if ((error as Error).name !== 'AbortError') console.error('Failed to load master feature evidence for sectioning:', error);
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoadingMasterEvidence(false);
      });
    return () => controller.abort();
  }, [masterRunId]);

  const features = useMemo(() => buildMatchingSpatialFeatures({
    masterRun,
    historicalRuns: Array.isArray(config?.summaryData?.historicalRuns)
      ? config.summaryData.historicalRuns
      : config?.summaryData?.oldRun ? [config.summaryData.oldRun] : [],
    masterRows: persistedMasterRows.length > 0 ? persistedMasterRows : rawMasterRows,
    lockedGws,
    gwOrphans: config?.gwOrphans,
    route: Array.isArray(config?.pipelineRoute) ? config.pipelineRoute : [],
  }), [config?.gwOrphans, config?.pipelineRoute, config?.summaryData?.historicalRuns, config?.summaryData?.oldRun, lockedGws, masterRun, persistedMasterRows, rawMasterRows]);
  // Every pair's sections live in one saved array, so this step edits the slice
  // belonging to the pair on screen and carries the rest through untouched.
  const [allSections, setAllSections] = useState<MatchingSection[]>(
    () => (Array.isArray(config?.matchingSections) ? config.matchingSections : []),
  );
  const sections = useMemo(
    () => sectionsForPair(allSections, activePair, primaryPair),
    [allSections, activePair, primaryPair],
  );
  const setSections = (update: MatchingSection[] | ((current: MatchingSection[]) => MatchingSection[])) => {
    const next = (typeof update === 'function' ? update(sections) : update)
      .map((section) => ({ ...section, pairKey: activePair?.key ?? section.pairKey }));
    const otherPairs = allSections.filter((section) => !sections.some((mine) => mine.id === section.id));
    setAllSections([...otherPairs, ...next]);
  };
  // Boundaries are held as indexes into `lockedGws` rather than as picked canvas
  // features, so a drag, a typed KP, a weld row, and a marker click can all feed
  // the same state.
  const [startIndex, setStartIndex] = useState<number | null>(null);
  const [endIndex, setEndIndex] = useState<number | null>(null);
  const [inspectedGw, setInspectedGw] = useState<SpatialFeature | null>(null);
  const [viewMode, setViewMode] = useState<'schematic' | 'map'>('schematic');
  const [zoom, setZoom] = useState(1);
  const [draft, setDraft] = useState<SectionDraft>({ name: 'Section 1', sectionType: 'BUR', policy: 'MATCH' });
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const validationError = validateSectionOrder(sections, lockedGws);

  // The schematic still highlights whichever GWs the boundaries resolve to.
  const selectedGws = useMemo(() => {
    const keys = [startIndex, endIndex]
      .filter((index): index is number => index !== null && index >= 0 && index < lockedGws.length)
      .map((index) => lockedGws[index].key);
    return keys
      .map((key) => features.gws.find((gw) => lockedKey(gw) === key))
      .filter((gw): gw is SpatialFeature => Boolean(gw));
  }, [endIndex, features.gws, lockedGws, startIndex]);

  const brushMarkers = useMemo<BrushMarker[]>(
    () =>
      features.allFeatures
        .filter((feature) => {
          const type = feature.type.toLowerCase();
          return type.includes('bend') || type.includes('valve') || type.includes('tee');
        })
        .map((feature) => {
          const type = feature.type.toLowerCase();
          const kind: BrushMarker['kind'] = type.includes('valve') ? 'valve' : type.includes('tee') ? 'tee' : 'bend';
          return { id: `${kind}-${feature.id}-${feature.dist}`, distM: feature.dist, kind, label: `${feature.type} · ${(feature.dist / 1000).toFixed(3)} km` };
        }),
    [features.allFeatures],
  );

  const masterFeatures = useMemo(
    () => features.allFeatures.filter((feature) => feature.runRole === 'MASTER'),
    [features.allFeatures],
  );

  const displaySections = useMemo<SectionDef[]>(() => sections.map((section) => {
    const resolved = resolveSectionDistances(section, lockedGws);
    const startFeature = features.gws.find((gw) => lockedKey(gw) === section.startGwKey);
    const endFeature = features.gws.find((gw) => lockedKey(gw) === section.endGwKey);
    return {
      id: section.id,
      name: section.name,
      type: section.sectionType || 'UNCLASSIFIED',
      startGw: startFeature?.id || '', endGw: endFeature?.id || '',
      startM: resolved.newStartM!, endM: resolved.newEndM!,
      length: resolved.newEndM! - resolved.newStartM!, notes: '',
      latStart: startFeature?.lat, lngStart: startFeature?.lng,
      latEnd: endFeature?.lat, lngEnd: endFeature?.lng,
    };
  }), [features.gws, lockedGws, sections]);

  const coverage = useMemo(
    () => coveragePercent(displaySections, features.stats.totalLength),
    [displaySections, features.stats.totalLength],
  );

  const bendFeatures = useMemo(
    () => features.allFeatures.filter((feature) => feature.type.toLowerCase().includes('bend')).sort((left, right) => left.dist - right.dist),
    [features.allFeatures],
  );

  /** Clicking a marker on the schematic fills the next empty boundary. */
  const handleGwClick = (gw: SpatialFeature) => {
    if (gw.runRole !== 'MASTER' || !lockedKey(gw)) return;
    const index = lockedIndexOf(lockedGws, lockedKey(gw));
    if (index < 0) return;
    if (startIndex === null || (endIndex !== null && startIndex !== null)) {
      setStartIndex(index);
      setEndIndex(null);
      return;
    }
    setBoundary('end', index);
  };

  /**
   * Writes one edge and keeps the pair ordered — picking an end upstream of the
   * current start swaps them instead of rejecting the input.
   */
  const setBoundary = (edge: BoundaryEdge, index: number) => {
    if (edge === 'start') {
      if (endIndex !== null && index > endIndex) {
        setStartIndex(endIndex);
        setEndIndex(index);
        return;
      }
      setStartIndex(index);
      return;
    }
    if (startIndex !== null && index < startIndex) {
      setStartIndex(index);
      setEndIndex(startIndex);
      return;
    }
    setEndIndex(index);
  };

  const selectRange = (nextStart: number, nextEnd: number) => {
    setStartIndex(nextStart);
    setEndIndex(nextEnd);
  };

  const closeComposer = () => {
    setStartIndex(null);
    setEndIndex(null);
    setEditingSectionId(null);
    setDraft({ name: `Section ${sections.length + 1}`, sectionType: 'BUR', policy: 'MATCH' });
  };

  const applySelectedSection = () => {
    if (startIndex === null || endIndex === null || endIndex <= startIndex || !draft.name.trim()) return;
    const existing = editingSectionId ? sections.find((section) => section.id === editingSectionId) : undefined;
    const sectionId = editingSectionId ?? `section-${Date.now()}`;
    const nextSection: MatchingSection = {
      ...existing,
      id: sectionId,
      name: draft.name.trim(),
      sectionType: draft.sectionType,
      policy: draft.policy,
      startGwKey: lockedGws[startIndex].key,
      endGwKey: lockedGws[endIndex].key,
    };
    setSections((current) => saveSectionRange(current, nextSection, lockedGws));
    setStartIndex(null);
    setEndIndex(null);
    setEditingSectionId(null);
    setDraft({ name: `Section ${sections.length + (editingSectionId ? 1 : 2)}`, sectionType: 'BUR', policy: 'MATCH' });
  };

  const editSection = (sectionId: string) => {
    const section = sections.find((item) => item.id === sectionId);
    if (!section) return;
    const start = lockedIndexOf(lockedGws, section.startGwKey);
    const end = lockedIndexOf(lockedGws, section.endGwKey);
    if (start < 0 || end < 0) return;
    setDraft({ name: section.name, sectionType: section.sectionType ?? 'UNCLASSIFIED', policy: section.policy });
    setStartIndex(Math.min(start, end));
    setEndIndex(Math.max(start, end));
    setEditingSectionId(section.id);
  };

  const deleteSection = (sectionId: string) => {
    setSections((current) => deleteMatchingSection(current, sectionId));
    if (editingSectionId === sectionId) closeComposer();
  };

  const applyPresets = (next: MatchingSection[]) => {
    setSections(next);
    closeComposer();
  };

  return (
    <div className="ds-stack">
      <Panel>
        <PanelHeader
          icon={<FiTarget aria-hidden="true" />}
          eyebrow="NEW is the spatial master"
          title="GW view &amp; sectioning"
          subtitle="OLD is only a comparison lane; red means a legacy GW is missing from the NEW master."
          actions={
            <Segmented<'schematic' | 'map'>
              ariaLabel="Viewer mode"
              value={viewMode}
              onChange={setViewMode}
              options={[
                { value: 'schematic', label: 'GW view', icon: <FiTarget aria-hidden="true" /> },
                { value: 'map', label: 'Maps', icon: <FiMap aria-hidden="true" /> },
              ]}
            />
          }
        />

        <PanelBody className="ds-stack">
          {pairs.length > 1 && (
            <div className="ds-row">
              <span className="ds-panel__eyebrow">Sections per run pair</span>
              {pairs.map((pair) => {
                const count = sectionsForPair(allSections, pair, primaryPair).length;
                const isActive = pair.key === activePair?.key;
                return (
                  <Button
                    key={pair.key}
                    size="sm"
                    variant={isActive ? 'primary' : 'secondary'}
                    aria-pressed={isActive}
                    onClick={() => { setActivePairKey(pair.key); closeComposer(); }}
                  >
                    {pair.label} ({count})
                  </Button>
                );
              })}
            </div>
          )}

          <StatGrid>
            <Stat
              lead
              label="NEW axis"
              value={activePair?.newRun?.year || config?.summaryData?.masterRun?.year || '—'}
              hint="Spatial master"
              compact
            />
            <Stat label="Locked GW" value={lockedGws.length.toLocaleString()} hint="Usable boundaries" compact />
            <Stat label="Bends inferred" value={features.stats.bendCount} tone="warning" compact />
            <Stat label="Missing in NEW" value={features.stats.missingGwCount} tone="danger" compact />
            <Stat
              label="Coverage"
              value={sections.length ? `${coverage.toFixed(1)}%` : 'Global'}
              tone={validationError ? 'danger' : 'success'}
              hint={validationError ? 'Needs attention' : sections.length ? `${sections.length} sections` : 'Sectioning is optional'}
              compact
            />
          </StatGrid>
        </PanelBody>
      </Panel>

      <SectionWorkbench
        lockedGws={lockedGws}
        sections={sections}
        markers={brushMarkers}
        masterFeatures={masterFeatures}
        sectionTypes={SECTION_TYPES}
        startIndex={startIndex}
        endIndex={endIndex}
        onSetBoundary={setBoundary}
        onSelectRange={selectRange}
        onClear={closeComposer}
        draft={draft}
        onDraftChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
        isEditing={editingSectionId !== null}
        onSave={applySelectedSection}
        onEditSection={editSection}
        onApplyPresets={applyPresets}
      />

      {/* The detailed viewer stays available for evidence checks, but it is no
          longer the only way to bound a section. */}
      <Panel>
        <div className="ds-toolbar">
          <span className="ds-toolbar__label">Detailed viewer</span>
          <span className="ds-toolbar__divider" />
          <span className="ds-toolbar__hint">
            {canInspectGwPrecisely(zoom)
              ? 'Click a GW marker to fill the next empty boundary.'
              : 'Zoom past 600% to click individual GWs — or use the rail above.'}
          </span>
          <span className="ds-toolbar__spacer" />
          <Button size="sm" variant="secondary" onClick={() => setZoom(1)}>Fit</Button>
          <div className="ds-btn-group">
            <Button size="sm" variant="secondary" iconOnly aria-label="Zoom out" onClick={() => setZoom(clampSchematicZoom(zoom - 0.5))}>−</Button>
            <span className="ds-readout">{Math.round(zoom * 100)}%</span>
            <Button size="sm" variant="secondary" iconOnly aria-label="Zoom in" onClick={() => setZoom(clampSchematicZoom(zoom + 0.5))}>+</Button>
          </div>
          <Button size="sm" variant="secondary" onClick={() => setZoom(MAX_SCHEMATIC_ZOOM)}>
            {MAX_SCHEMATIC_ZOOM * 100}%
          </Button>
          <input
            type="range"
            className="ds-range"
            style={{ width: '7rem' }}
            aria-label="Zoom level"
            min="0.5"
            max={MAX_SCHEMATIC_ZOOM}
            step="0.5"
            value={zoom}
            onChange={(event) => setZoom(clampSchematicZoom(Number(event.target.value)))}
          />
        </div>

        <div className="sectioning-light-viewer">
          {viewMode === 'schematic' ? (
            <SectioningSchematic features={features} sections={displaySections} zoom={zoom} onZoomChange={setZoom} selectedGWs={selectedGws} onGwClick={handleGwClick} onInspectGw={setInspectedGw} />
          ) : Array.isArray(config?.pipelineRoute) && config.pipelineRoute.length >= 2 ? (
            <SectionMap sections={displaySections} features={features} selectedGWs={selectedGws} onGwClick={handleGwClick} drawnRoute={config.pipelineRoute} />
          ) : (
            <div className="sectioning-light-empty"><FiMap size={30} /><strong>Route coordinates not set</strong><span>GW View still works; the map is optional.</span></div>
          )}
        </div>

        {inspectedGw && <GwPositionCard feature={inspectedGw} onDismiss={() => setInspectedGw(null)} />}

        <PanelBody className="ds-stack ds-stack--sm">
          <div className="ds-row" style={{ justifyContent: 'space-between' }}>
            <span className="ds-panel__eyebrow">Bends ({bendFeatures.length})</span>
            <span className="ds-toolbar__hint">Inferred physical features</span>
          </div>
          <div className="sec-bend-grid">
            {isLoadingMasterEvidence && <span className="ds-toolbar__hint">Loading bend locations from master data…</span>}
            {bendFeatures.map((bend, index) => (
              <span key={bend.id} className="sec-bend">
                <i aria-hidden="true">◆</i>
                <strong>BEND {String(index + 1).padStart(2, '0')}</strong>
                <small>{(bend.dist / 1000).toFixed(2)} km · {bendAngleDeg(bend).toFixed(0)}°</small>
              </span>
            ))}
            {!isLoadingMasterEvidence && bendFeatures.length === 0 && (
              <span className="ds-toolbar__hint">No bends detected from master data yet.</span>
            )}
          </div>
        </PanelBody>
      </Panel>

      <SectionTable sections={sections} lockedGws={lockedGws} sectionTypes={SECTION_TYPES} onEdit={editSection} onDelete={deleteSection} />

      {validationError && (
        <Callout tone="danger" role="alert" icon={<FiAlertTriangle aria-hidden="true" />} title="Section layout is not valid">
          {validationError}
        </Callout>
      )}

      <ActionBar
        back={
          <Button variant="ghost" startIcon={<FiChevronLeft aria-hidden="true" />} onClick={onBack}>
            GW matching
          </Button>
        }
        center={
          <ShareSnapshotButton
            kind="SECTIONING"
            title={`Sectioning${activePair?.label ? ` · ${activePair.label}` : ''}`}
            sourceRef={config?.sessionId ? `alignment-session:${config.sessionId}` : undefined}
            rows={displaySections}
            summary={[
              { label: 'Coverage', value: `${coverage.toFixed(1)}%` },
              { label: 'Locked GW', value: lockedGws.length },
              { label: 'Missing in NEW', value: features.stats.missingGwCount },
            ]}
            notes={[
              'Sections are frozen against the NEW spatial master at the time this link was created.',
            ]}
            disabled={Boolean(validationError)}
            label="Share sectioning"
          />
        }
        next={
          <Button
            disabled={Boolean(validationError)}
            endIcon={<FiChevronRight aria-hidden="true" />}
            onClick={() => onNext({
              matchingSections: allSections.map((section) => {
                const isActivePair = sections.some((mine) => mine.id === section.id);
                // Only the pair on screen has its boundaries resolvable right now;
                // other pairs keep the distances resolved when they were edited.
                return isActivePair ? resolveSectionDistances(section, lockedGws) : section;
              }),
            })}
          >
            Save &amp; continue
          </Button>
        }
      />
    </div>
  );
}
