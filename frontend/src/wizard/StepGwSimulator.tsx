import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Line } from 'react-chartjs-2';
import {
  FiActivity,
  FiAnchor,
  FiBox,
  FiChevronLeft,
  FiChevronRight,
  FiCrosshair,
  FiDownload,
  FiLayers,
  FiRotateCcw,
  FiSearch,
  FiX,
} from 'react-icons/fi';
import GwTimelineViewer from './GwTimelineViewer';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Tooltip } from 'chart.js';
import { apiFetch, ApiError } from '../utils/api';
import Modal from '../components/common/Modal';
import { extentOf, maxOf, minOf } from '../utils/numericRange.ts';
import { clampTooltipPosition } from '../utils/tooltipPosition';
import { gwReviewKey, normalizeGwReview, selectReviewedGwLocks, type GwReviewDisposition, type GwReviewState } from '../domain/alignmentReview';
import {
  buildTimelineModel,
  classifyTimelineMatch,
  offsetTrend,
  readMatchConfidence,
  sourceOdometerOffset,
  timelineLaneLabels,
  TIMELINE_STATUS_LABEL,
  type TimelineEvidence,
  type TimelineGeometry,
  type TimelineStatus,
} from '../domain/gwTimeline';
import { buildGwReviewTransitionPayload } from './gwReviewTransition';
import { canonicalGwReviewSignature, pairResultForPersistence } from './gwPairReviewPersistence';
import { pairGwResult, pairTieIn, primaryRunPair, resolveRunPairs } from '../domain/runPairs';
import type { MatchingSection } from './matchingSections';
import {
  ActionBar,
  Button,
  Panel,
  PanelBody,
  PanelFooter,
  PanelHeader,
  Segmented,
  SliderField,
  Switch,
} from '../components/ds';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip);

const Pipeline3DViewer = React.lazy(() => import('../components/3d/Pipeline3DViewer'));

interface StepGwSimulatorProps {
  initialOta: number;
  onNext: (data?: any) => Promise<void> | void;
  onBack: (data?: any) => void;
  config?: any;
}

function buildReviewSignature(config: any, settings: {
  ota: number;
  strictPenalty: boolean;
  useValveAnchor: boolean;
  dtwOn: boolean;
}) {
  return canonicalGwReviewSignature(config, settings);
}

type GwTableTab = 'all' | 'matched' | 'unmatched';
type GwTableSortKey = 'old' | 'new' | 'offset' | 'deviation';

const GW_TABLE_TABS: Array<{ id: GwTableTab; label: string }> = [
  { id: 'all', label: 'All GWs' },
  { id: 'matched', label: 'Matched' },
  { id: 'unmatched', label: 'Unmatched' },
];

/** A percentage rendered as four discrete bars, as the review screens do. */
function confidenceBand(confidence: number): { label: string; filled: number } {
  if (confidence >= 90) return { label: 'Very high', filled: 4 };
  if (confidence >= 70) return { label: 'High', filled: 3 };
  if (confidence >= 45) return { label: 'Medium', filled: 2 };
  return { label: 'Low', filled: 1 };
}

function metres(value: unknown, digits = 3): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(digits) : '—';
}

/** A share of the run, blank when there is no run to take a share of. */
function percentOfRun(count: number, total: number): string {
  return total === 0 ? '' : `${((count / total) * 100).toFixed(1)}%`;
}

function SortHeader({
  label,
  sortKey,
  activeKey,
  direction,
  onSort,
}: {
  label: string;
  sortKey: GwTableSortKey;
  activeKey: GwTableSortKey;
  direction: 'asc' | 'desc';
  onSort: (key: GwTableSortKey) => void;
}) {
  const isActive = activeKey === sortKey;
  return (
    <button
      type="button"
      className={`gw-table__sort${isActive ? ' is-active' : ''}`}
      aria-sort={isActive ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      onClick={() => onSort(sortKey)}
    >
      {label}
      <span aria-hidden="true">{isActive ? (direction === 'asc' ? '↑' : '↓') : '↕'}</span>
    </button>
  );
}

/** One run pair's matching result and the operator's review of it. */
type PairGwState = {
  gwMatchesFinal: any[];
  gwOrphans: any[];
  gwReview: GwReviewState;
  reviewSignature: string | null;
  sessionRevision?: string;
  ota: number;
  dtwOn: boolean;
  useValveAnchor: boolean;
  strictPenalty: boolean;
};

export default function StepGwSimulator({ initialOta, onNext, onBack, config: rawConfig }: StepGwSimulatorProps) {
  const runPairs = useMemo(() => resolveRunPairs(rawConfig?.summaryData), [rawConfig?.summaryData]);
  const primaryPair = useMemo(() => primaryRunPair(rawConfig?.summaryData), [rawConfig?.summaryData]);
  const hasMultiplePairs = runPairs.length > 1;
  const [activePairKey, setActivePairKey] = useState<string | null>(null);
  const activePair = runPairs.find((pair) => pair.key === activePairKey) ?? runPairs[0] ?? null;

  // Each pair carries its own tie-in transform. Injecting it here means every
  // downstream read of `config.tieInTransform` resolves the transform for the
  // pair actually on screen — previously they all read the one transform the
  // tie-in step happened to compute, so a chain applied the wrong mapping.
  const config = useMemo(() => {
    if (!activePair) return rawConfig;
    const scopedTieIn = pairTieIn(rawConfig, activePair) || {};
    return {
      ...rawConfig,
      ...scopedTieIn,
      summaryData: {
        ...rawConfig?.summaryData,
        oldRun: activePair.oldRun,
        newRun: activePair.newRun,
      },
    };
  }, [rawConfig, activePair]);

  const initialSettings = {
    ota: initialOta,
    strictPenalty: Boolean(config?.strictPenalty),
    useValveAnchor: config?.useValveAnchor ?? true,
    dtwOn: config?.dtwOn ?? true,
  };
  const initialReviewSignature = buildReviewSignature(config, initialSettings);
  const [ota, setOta] = useState(initialOta);
  const sections = useMemo<MatchingSection[]>(() => config?.matchingSections ?? [], [config]);
  const [perSectionOtaEnabled, setPerSectionOtaEnabled] = useState(() =>
    sections.some((s: MatchingSection) => s.ota != null),
  );
  const [sectionOtaOverrides, setSectionOtaOverrides] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    for (const s of sections) {
      if (s.ota != null) init[s.id] = s.ota;
    }
    return init;
  });
  const [zoom, setZoom] = useState(100);
  const [selectedGWs, setSelectedGWs] = useState<number[]>([]);
  const [selectedMatch, setSelectedMatch] = useState<any | null>(null);
  const [show3DViewer, setShow3DViewer] = useState(false);
  const [tooltipState, setTooltipState] = useState<{ x: number, y: number, row: any } | null>(null);

  // The All-GWs table is unvirtualized, so committing tooltip state on every
  // raw mousemove re-rendered this whole component per mouse event. Keep the
  // latest payload in a ref and commit at most once per animation frame.
  const tooltipFrameRef = useRef<number | null>(null);
  const pendingTooltipRef = useRef<{ x: number, y: number, row: any } | null>(null);
  const queueTooltipUpdate = (next: { x: number, y: number, row: any } | null) => {
    pendingTooltipRef.current = next;
    if (tooltipFrameRef.current !== null) return;
    tooltipFrameRef.current = window.requestAnimationFrame(() => {
      tooltipFrameRef.current = null;
      setTooltipState(pendingTooltipRef.current);
    });
  };
  useEffect(() => () => {
    if (tooltipFrameRef.current !== null) window.cancelAnimationFrame(tooltipFrameRef.current);
  }, []);

  const [activeTab, setActiveTab] = useState<GwTableTab>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | TimelineStatus>('all');
  const [sortKey, setSortKey] = useState<GwTableSortKey>('old');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [chartScope, setChartScope] = useState<'matched' | 'all'>('matched');

  const [dtwOn, setDtwOn] = useState(initialSettings.dtwOn);
  const [useValveAnchor, setUseValveAnchor] = useState(initialSettings.useValveAnchor);
  const [strictPenalty, setStrictPenalty] = useState(initialSettings.strictPenalty);
  const [currentPage, setCurrentPage] = useState(1);
  const tableRowRefs = useRef<{[key: string]: HTMLTableRowElement | null}>({});

  const [searchQuery, setSearchQuery] = useState('');

  const [matches, setMatches] = useState<any[]>([]);
  const [gwMatchesFinal, setGwMatchesFinal] = useState<any[]>([]);
  const [gwOrphans, setGwOrphans] = useState<any[]>([]);
  const [timelineGeometry, setTimelineGeometry] = useState<TimelineGeometry>(() => buildTimelineModel([], null));
  const [isCalculating, setIsCalculating] = useState(false);
  const [isSavingReview, setIsSavingReview] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [gwReview, setGwReview] = useState<GwReviewState>(() => (
    config?.gwReviewSignature === initialReviewSignature ? normalizeGwReview(config?.gwReview) : {}
  ));
  const [sessionRevision, setSessionRevision] = useState<string | undefined>(config?.sessionRevision);
  const calculationRevision = useRef(0);
  const reviewSignature = useRef<string | null>(
    config?.gwReviewSignature === initialReviewSignature ? initialReviewSignature : null,
  );

  // Reviews for pairs that are not on screen. Holding one live set of these
  // fields meant switching pairs silently destroyed the previous pair's review
  // and Continue only ever saved whichever pair happened to be visible.
  const parkedPairs = useRef<Record<string, PairGwState>>({});
  const liveSnapshot = (): PairGwState => ({
    gwMatchesFinal, gwOrphans, gwReview,
    reviewSignature: reviewSignature.current,
    sessionRevision, ota, dtwOn, useValveAnchor, strictPenalty,
  });

  const switchPair = (nextKey: string) => {
    if (!activePair || nextKey === activePair.key) return;
    parkedPairs.current[activePair.key] = liveSnapshot();
    const stored = parkedPairs.current[nextKey] ?? (() => {
      const pair = runPairs.find((item) => item.key === nextKey) ?? null;
      const persisted = pairGwResult(rawConfig, pair);
      return persisted
        ? {
            gwMatchesFinal: persisted.gwMatchesFinal ?? [],
            gwOrphans: persisted.gwOrphans ?? [],
            gwReview: normalizeGwReview(persisted.gwReview),
            reviewSignature: persisted.gwReviewSignature ?? null,
            sessionRevision: rawConfig?.sessionRevision,
            ota: persisted.ota ?? initialOta,
            dtwOn: persisted.dtwOn ?? true,
            useValveAnchor: persisted.useValveAnchor ?? true,
            strictPenalty: Boolean(persisted.strictPenalty),
          }
        : null;
    })();
    setGwMatchesFinal(stored?.gwMatchesFinal ?? []);
    setGwOrphans(stored?.gwOrphans ?? []);
    setGwReview(stored?.gwReview ?? {});
    reviewSignature.current = stored?.reviewSignature ?? null;
    setOta(stored?.ota ?? initialOta);
    setDtwOn(stored?.dtwOn ?? true);
    setUseValveAnchor(stored?.useValveAnchor ?? true);
    setStrictPenalty(Boolean(stored?.strictPenalty));
    setSelectedMatch(null);
    setActivePairKey(nextKey);
  };

  useEffect(() => {
    const controller = new AbortController();
    const currentCalculation = ++calculationRevision.current;
    const currentReviewSignature = buildReviewSignature(config, {
      ota, strictPenalty, useValveAnchor, dtwOn,
    });
    
    const calculateDTW = async () => {
      setIsCalculating(true);
      setLoadError(null);
      setMatches([]);
      setGwMatchesFinal([]);
      setGwOrphans([]);
      setTimelineGeometry(buildTimelineModel([], null));
      if (reviewSignature.current !== null && reviewSignature.current !== currentReviewSignature) {
        setGwReview({});
      }
      try {
        const globalOffset = config?.globalOffset || 0;
        const tieInTransform = config?.tieInTransform;
        const tieInDecision = config?.tieInDecision;
        const tieInEvidenceToken = config?.tieInEvidenceToken;
        const tieInMethodVersion = config?.tieInMethodVersion;
        // Mirrors ACCEPTED_TIEIN_STATUSES on the server. An acknowledged
        // decision still carries a real piecewise transform — Partial Run has no
        // scalar fallback — so it must map the same way an auto-accepted one does.
        const hasCanonicalTieIn = tieInTransform?.direction === 'OLD_TO_NEW'
          && (tieInDecision?.status === 'AUTO_ACCEPTED' || tieInDecision?.status === 'REVIEW_ACKNOWLEDGED');
        const partialRunEnabled = Boolean(config?.enablePartialRun);
        if (partialRunEnabled && !hasCanonicalTieIn) {
          setLoadError('Partial Run is enabled, but no canonical TIE-IN has been applied. Go back to Tie-In Setup and use an accepted recommendation. Raw 0 m will not be used for matching.');
          return;
        }
        const featureTypeText = (feature: any) => [
          feature.type,
          feature.feature_type,
          feature.feature_identification,
          feature.originalType,
        ].filter((value) => value !== null && value !== undefined)
          .map((value) => String(value).toLowerCase())
          .join(' ');
        const finiteDistance = (feature: any) => {
          const candidates = [
            feature.dist,
            feature.log_distance_m,
            feature.logDistance,
            feature.distance,
            feature.chainage,
            feature.odometer,
          ];
          for (const candidate of candidates) {
            const raw = String(candidate ?? '').trim();
            if (!raw) continue;
            const parsed = Number(raw.replace(/,/g, ''));
            if (Number.isFinite(parsed)) return parsed;
          }
          return null;
        };
        const selectAlignmentAnchors = (features: any[]) => features
          .filter((feature) => /\b(?:weld|girth|flange|valve|tee|offtake|branch|bend|elbow|launcher|receiver)\b/.test(featureTypeText(feature)))
          .map((feature) => ({ ...feature, dist: finiteDistance(feature) }))
          .filter((feature) => feature.dist !== null);
        const rawOldRun = selectAlignmentAnchors(config?.summaryData?.oldRun?.rawFeatures || []);
        const rawNewRun = selectAlignmentAnchors(config?.summaryData?.newRun?.rawFeatures || []);
        const oldRunId = Number(config?.summaryData?.oldRun?.runId);
        const newRunId = Number(config?.summaryData?.newRun?.runId);
        const hasPersistedRuns = Number.isSafeInteger(oldRunId)
          && oldRunId > 0
          && Number.isSafeInteger(newRunId)
          && newRunId > 0;

        if (!hasPersistedRuns && (rawOldRun.length === 0 || rawNewRun.length === 0)) {
          setMatches([]);
          setLoadError('Anchor data is not available yet. Make sure both ILI files contain Weld, Valve, or Tee features.');
          return;
        }
        
        // Legacy sessions shift NEW. Canonical sessions send raw rows and let
        // the engine map OLD history onto the NEW master axis piecewise.
        const adjustedNewRun = !hasCanonicalTieIn && globalOffset !== 0
          ? rawNewRun.map((f: any) => ({ ...f, dist: f.dist + globalOffset }))
          : rawNewRun;

        const payload = {
          ota,
          strictPenalty,
          useValveAnchor,
          applyDtwCorrection: dtwOn,
          partialRunEnabled,
          ...(hasCanonicalTieIn ? {
            tieInTransform,
            tieInDecision,
            tieInEvidenceToken,
            tieInMethodVersion,
            excludedRanges: config?.tieInExcludedRanges || [],
          } : {}),
          ...(hasPersistedRuns
            ? {
                oldRunId,
                newRunId,
                tieInOffset: hasCanonicalTieIn ? 0 : globalOffset,
                ...(config?.sessionId ? { sessionId: config.sessionId } : {}),
              }
            : { oldRun: rawOldRun, newRun: adjustedNewRun }),
          globalOffset
        };
        
        const data = await apiFetch<any>('/api/align-dtw', {
          method: 'POST',
          signal: controller.signal,
          body: JSON.stringify(payload)
        });

        // A slower response from an older slider position must never replace
        // the result for the latest OTA value.
        if (controller.signal.aborted || currentCalculation !== calculationRevision.current) return;
        
        if (data.success && Array.isArray(data.gwMatches)) {
          reviewSignature.current = currentReviewSignature;
          if (typeof data.sessionRevision === 'string') setSessionRevision(data.sessionRevision);
          if (data.gwMatchesFinal) setGwMatchesFinal(data.gwMatchesFinal);
          if (data.gwOrphans) setGwOrphans(data.gwOrphans);
          
          // Extract old and new distances just for the visualizer scales
          const responseMatches = data.gwMatches as any[];
          const oldW = hasPersistedRuns || data.tieInTransformApplied
            ? responseMatches.map((match) => Number(match.oldDist)).filter(Number.isFinite)
            : rawOldRun.filter((f: any) => /weld|girth|seam/.test(featureTypeText(f))).map((f: any) => f.dist);
          const newW = hasPersistedRuns
            ? responseMatches.map((match) => Number(match.newDist)).filter(Number.isFinite)
            : adjustedNewRun.filter((f: any) => /weld|girth|seam/.test(featureTypeText(f))).map((f: any) => f.dist);
          const oldValves = hasPersistedRuns ? [] : rawOldRun.filter((f: any) => featureTypeText(f).includes('valve')).map((f: any) => f.dist);
          const newValves = hasPersistedRuns ? [] : adjustedNewRun.filter((f: any) => featureTypeText(f).includes('valve')).map((f: any) => f.dist);
          const oldTees = hasPersistedRuns ? [] : rawOldRun.filter((f: any) => featureTypeText(f).includes('tee')).map((f: any) => f.dist);
          const newTees = hasPersistedRuns ? [] : adjustedNewRun.filter((f: any) => featureTypeText(f).includes('tee')).map((f: any) => f.dist);
          
          const oldFeatureById = new Map(
            ((config?.summaryData?.oldRun?.rawFeatures || []) as any[]).map((f: any) => [f.id, f]),
          );
          const newFeatureById = new Map(
            ((config?.summaryData?.newRun?.rawFeatures || []) as any[]).map((f: any) => [f.id, f]),
          );
          const formattedMatches = data.gwMatches.map((m: any, idx: number) => {
              const isMatch = m && m.status === 'Match';
              const rawOffset = m.newDist !== null && m.oldDist !== null ? (m.newDist - m.oldDist) : null;

              let correctedNewVal = m.newDist;
              let correctedOffset = rawOffset;

              const oldFeature = m.oldId ? oldFeatureById.get(m.oldId) ?? null : null;
              const newFeature = m.newId ? newFeatureById.get(m.newId) ?? null : null;
              const oldDesc = oldFeature ? (oldFeature.feature_identification || oldFeature.originalType || 'Weld') : '(Missing)';
              const newDesc = newFeature ? (newFeature.feature_identification || newFeature.originalType || 'Weld') : '(Missing)';

              const finalVarPct = isMatch && m.deviation_ratio !== undefined && m.deviation_ratio !== null 
                  ? m.deviation_ratio * 100 
                  : 0;

              return {
                id: `match-${idx}`,
                oldIndex: m.oldIndex, newIndex: m.newIndex,
                oldId: m.oldId, newId: m.newId,
                oldDesc, newDesc,
                oldVal: m.oldDist, newVal: correctedNewVal,
                originalOldVal: m.oldSourceDist ?? oldFeature?.dist ?? m.oldDist ?? null,
                originalNewVal: m.newSourceDist ?? newFeature?.dist ?? (
                  m.newDist !== null
                    ? (hasCanonicalTieIn ? m.newDist : m.newDist - globalOffset)
                    : null
                ),
                varPct: finalVarPct,
                offset: correctedOffset,
                odometerOffset: sourceOdometerOffset({
                  originalOldVal: m.oldSourceDist ?? oldFeature?.dist ?? m.oldDist ?? null,
                  originalNewVal: m.newSourceDist ?? newFeature?.dist ?? m.newDist ?? null,
                  oldVal: m.oldDist,
                  newVal: m.newDist,
                }),
                status: m.status,
                deviationRatio: m.deviation_ratio,
                flagged: m.flagged,
                sOld: m.L_ref, sNew: m.L_new, rawVarPct: m.deviation_ratio ? m.deviation_ratio * 100 : 0, rawOffset,
              };
          });
          const fallbackDistances = [...oldW, ...newW, ...oldValves, ...newValves, ...oldTees, ...newTees]
            .map(Number)
            .filter(Number.isFinite);
          const fallbackEvidence: TimelineEvidence = {
            coordinateSystem: hasCanonicalTieIn ? 'NEW_MASTER' : 'COMMON_DISPLAY',
            domain: (() => {
              const extent = extentOf(fallbackDistances, { min: 0, max: 1 });
              return { startM: extent.min, endM: extent.max };
            })(),
            oldCoverage: oldW.length ? { startM: minOf(oldW), endM: maxOf(oldW) } : null,
            newCoverage: newW.length ? { startM: minOf(newW), endM: maxOf(newW) } : null,
            oldFeatures: [
              ...oldW.map((distance) => ({ type: 'weld', displayDistanceM: distance, sourceDistanceM: distance })),
              ...oldValves.map((distance) => ({ type: 'valve', displayDistanceM: distance, sourceDistanceM: distance })),
              ...oldTees.map((distance) => ({ type: 'tee', displayDistanceM: distance, sourceDistanceM: distance })),
            ],
            newFeatures: [
              ...newW.map((distance) => ({ type: 'weld', displayDistanceM: distance, sourceDistanceM: distance })),
              ...newValves.map((distance) => ({ type: 'valve', displayDistanceM: distance, sourceDistanceM: distance })),
              ...newTees.map((distance) => ({ type: 'tee', displayDistanceM: distance, sourceDistanceM: distance })),
            ],
          };
          const nextTimeline = buildTimelineModel(
            formattedMatches,
            (data.timeline as TimelineEvidence | undefined) ?? fallbackEvidence,
          );
          setTimelineGeometry(nextTimeline);
          setMatches(nextTimeline.matches);
        } else {
          throw new Error(data.error || 'The server did not return GW matching results.');
        }
      } catch (err: any) {
        if (err.name !== 'AbortError' && currentCalculation === calculationRevision.current) {
          console.error("Failed to run DTW:", err);
          setLoadError(err instanceof ApiError && err.status === 401
            ? 'Your login session has expired. Sign in again.'
            : `Failed to load GW matching results: ${err.message || 'check the backend connection.'}`);
        }
      } finally {
        if (currentCalculation === calculationRevision.current) setIsCalculating(false);
      }
    };
    
    // Debounce: cancel rapid slider drags, fire only after user stops moving for 300ms
    const timeout = setTimeout(calculateDTW, 300);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [ota, strictPenalty, useValveAnchor, dtwOn, config, retryNonce]);

  const matchedOnly = useMemo(
    () => matches.filter(m => m.status === 'Match').sort((a, b) => a.oldVal - b.oldVal),
    [matches],
  );


  // Build the chart from the exact rows shown in the table. The table and chart
  // therefore use the same x-position and offset value, including when a
  // long-running backend worker returns a legacy payload.
  const chartPoints = useMemo(() => {
    const source = chartScope === 'matched'
      ? matchedOnly
      // "All pairs" still means pairs: a weld with no counterpart has no offset
      // to plot, so widening the scope adds the flagged pairs, not blanks.
      : [...matches].sort((left, right) => Number(left.oldVal) - Number(right.oldVal));
    return source
      .map((match) => ({
        x: match.oldVal as number,
        y: match.odometerOffset as number,
        match,
      }))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  }, [chartScope, matchedOnly, matches]);

  const graphPoints = chartPoints.map(({ x, y }) => ({ x, y }));
  const trend = useMemo(() => offsetTrend(graphPoints), [graphPoints]);

  const MATCHER_DEFAULTS = { strictPenalty: false, useValveAnchor: true, dtwOn: true };
  const isAtMatcherDefaults = ota === initialOta
    && strictPenalty === MATCHER_DEFAULTS.strictPenalty
    && useValveAnchor === MATCHER_DEFAULTS.useValveAnchor
    && dtwOn === MATCHER_DEFAULTS.dtwOn;
  const resetMatcherDefaults = () => {
    setOta(initialOta);
    setStrictPenalty(MATCHER_DEFAULTS.strictPenalty);
    setUseValveAnchor(MATCHER_DEFAULTS.useValveAnchor);
    setDtwOn(MATCHER_DEFAULTS.dtwOn);
  };

  const downloadOffsetCsv = () => {
    const header = [`${laneLabels.old} log distance (m)`, 'Offset (m)'];
    const rows = chartPoints.map(({ x, y }) => `${x},${y}`);
    const csv = [header.join(','), ...rows].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `GW_offset_${laneLabels.old}_to_${laneLabels.new}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const defaultDisposition = (match: any): GwReviewDisposition => {
    if (match?.status === 'Skipped') return 'excluded';
    return match?.flagged ? 'review' : 'accepted';
  };
  const decisionFor = (match: any) => gwReview[gwReviewKey(match)] ?? {
    disposition: defaultDisposition(match),
    note: '',
    reviewedAt: '',
  };
  const resolveOtaForMatch = useMemo(() => {
    if (!perSectionOtaEnabled || sections.length === 0) return () => ota;
    return (match: any) => {
      const newDist = Number(match.newDist ?? match.newVal);
      if (!Number.isFinite(newDist)) return ota;
      for (const s of sections) {
        const sOta = sectionOtaOverrides[s.id];
        if (sOta == null) continue;
        const start = s.newStartM ?? s.startM ?? -Infinity;
        const end = s.newEndM ?? s.endM ?? Infinity;
        if (newDist >= start && newDist <= end) return sOta;
      }
      return ota;
    };
  }, [perSectionOtaEnabled, sections, sectionOtaOverrides, ota]);
  const timelineMatches = useMemo(() => matches.map((match) => {
    const deviationPct = Number.isFinite(Number(match.deviationRatio))
      ? Math.abs(Number(match.deviationRatio)) * 100
      : Number(match.rawVarPct);
    const effectiveOta = resolveOtaForMatch(match);
    return {
      ...match,
      flagged: Number.isFinite(deviationPct) ? deviationPct > effectiveOta : Boolean(match.flagged),
    };
  }), [matches, resolveOtaForMatch]);
  const timelineDispositions = useMemo(() => timelineMatches.reduce<Record<string, GwReviewDisposition>>((dispositions, match) => {
    dispositions[String(match.id)] = gwReview[gwReviewKey(match)]?.disposition ?? defaultDisposition(match);
    return dispositions;
  }, {}), [timelineMatches, gwReview]);
  const updateReview = (match: any, patch: Partial<{ disposition: GwReviewDisposition; note: string }>) => {
    const key = gwReviewKey(match);
    setGwReview((current) => {
      const existing = current[key] ?? { disposition: defaultDisposition(match), note: '', reviewedAt: '' };
      return { ...current, [key]: { ...existing, ...patch, reviewedAt: new Date().toISOString() } };
    });
  };
  const reviewedLocks = useMemo(
    () => selectReviewedGwLocks(gwMatchesFinal, gwReview),
    [gwMatchesFinal, gwReview],
  );
  /** Pairs still waiting for a matching result the operator has looked at. */
  const unreviewedPairs = runPairs.filter((pair) => {
    if (pair.key === activePair?.key) return gwMatchesFinal.length === 0;
    const parked = parkedPairs.current[pair.key];
    if (parked) return parked.gwMatchesFinal.length === 0;
    return (pairGwResult(rawConfig, pair)?.gwMatchesFinal?.length ?? 0) === 0;
  });

  const saveReviewAndContinue = async () => {
    if (isSavingReview) return;
    setIsSavingReview(true);
    try {
      // Every pair's locks travel together; sectioning and the final comparison
      // need the whole chain, not just the pair last displayed.
      const pairGwResults: Record<string, any> = {};
      for (const pair of runPairs) {
        const state = pair.key === activePair?.key
          ? { ...liveSnapshot(), gwMatchesFinal: reviewedLocks }
          : parkedPairs.current[pair.key];
        if (!state) continue;
        const scopedTieIn = pairTieIn(rawConfig, pair) || {};
        const pairConfig = {
          ...rawConfig,
          ...scopedTieIn,
          summaryData: { ...rawConfig?.summaryData, oldRun: pair.oldRun, newRun: pair.newRun },
        };
        const currentSignature = buildReviewSignature(pairConfig, {
          ota: state.ota,
          strictPenalty: state.strictPenalty,
          useValveAnchor: state.useValveAnchor,
          dtwOn: state.dtwOn,
        });
        pairGwResults[pair.key] = pairResultForPersistence(state, currentSignature);
      }
      const primary = primaryPair ? pairGwResults[primaryPair.key] : undefined;
      await onNext({
        ...buildGwReviewTransitionPayload({
          // The unscoped fields keep describing the primary pair so the engines
          // and older saved sessions still resolve one canonical lock set.
          ota: primary?.ota ?? ota,
          strictPenalty: primary?.strictPenalty ?? strictPenalty,
          useValveAnchor: primary?.useValveAnchor ?? useValveAnchor,
          dtwOn: primary?.dtwOn ?? dtwOn,
          gwMatchesFinal: primary?.gwMatchesFinal ?? reviewedLocks,
          gwOrphans: primary?.gwOrphans ?? gwOrphans,
          // Never promote the visible pair's review into the primary pair.
          // When the primary review is stale these remain undefined and are
          // omitted by JSON.stringify, avoiding the unscoped signature check.
          gwReview: primary?.gwReview,
          gwReviewSignature: primary?.gwReviewSignature ?? null,
          sessionRevision,
          sectionOtaOverrides: perSectionOtaEnabled ? sectionOtaOverrides : undefined,
        }),
        pairGwResults,
      });
    } finally {
      setIsSavingReview(false);
    }
  };

  // The viewer names each lane by its survey year. In a chain the NEW side of
  // an intermediate pair is not the master run, so "Master NEW" was wrong there
  // anyway; the year is both shorter and always true.
  const laneLabels = useMemo(
    () => timelineLaneLabels(activePair?.oldRun, activePair?.newRun),
    [activePair],
  );

  /**
   * One row per matcher outcome, carrying the result the table has to sort,
   * filter and colour by. Classified with the same function the viewer uses, so
   * a weld cannot be amber on the canvas and green in the table.
   */
  const tableRows = useMemo(() => timelineMatches.map((match) => {
    const deviationPct = Number.isFinite(Number(match.deviationRatio))
      ? Math.abs(Number(match.deviationRatio)) * 100
      : Number(match.rawVarPct);
    return {
      match,
      status: classifyTimelineMatch(match, timelineDispositions[String(match.id)]),
      confidence: readMatchConfidence(match),
      deviationPct: Number.isFinite(deviationPct) ? deviationPct : null,
    };
  }), [timelineMatches, timelineDispositions]);

  const statusCounts = useMemo(() => tableRows.reduce((counts, item) => {
    counts[item.status] += 1;
    return counts;
  }, { matched: 0, review: 0, missing: 0 } as Record<TimelineStatus, number>), [tableRows]);

  // A weld under review is not a clean match, so it belongs in the unmatched
  // set — matched plus unmatched then adds up to the run, which is the only way
  // the three tab counts can be read against each other.
  const tabCounts: Record<GwTableTab, number> = {
    all: tableRows.length,
    matched: statusCounts.matched,
    unmatched: statusCounts.review + statusCounts.missing,
  };

  const meanOffsetAll = useMemo(() => {
    const offsets = tableRows
      .filter((item) => item.status !== 'missing')
      .map((item) => Number(item.match.offset))
      .filter(Number.isFinite);
    return offsets.length === 0 ? null : offsets.reduce((sum, value) => sum + value, 0) / offsets.length;
  }, [tableRows]);

  // The engine only reports a match confidence on some strategies. A column
  // that is "—" on every row teaches the reader nothing, so it appears only
  // when there is something in it.
  const hasConfidence = tableRows.some((item) => item.confidence !== null);

  const visibleRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const filtered = tableRows.filter((item) => {
      if (activeTab === 'matched' && item.status !== 'matched') return false;
      if (activeTab === 'unmatched' && item.status === 'matched') return false;
      if (statusFilter !== 'all' && item.status !== statusFilter) return false;
      if (!query) return true;
      return [
        item.match.oldVal,
        item.match.originalNewVal ?? item.match.newVal,
        item.match.oldDesc,
        item.match.newDesc,
      ].some((value) => String(value ?? '').toLowerCase().includes(query));
    });

    const readSortValue = (item: typeof tableRows[number]) => {
      switch (sortKey) {
        case 'new': return Number(item.match.originalNewVal ?? item.match.newVal);
        case 'offset': return Number(item.match.offset);
        case 'deviation': return item.deviationPct === null ? Number.NaN : item.deviationPct;
        default: return Number(item.match.oldVal);
      }
    };
    const direction = sortDirection === 'asc' ? 1 : -1;
    return [...filtered].sort((left, right) => {
      const leftValue = readSortValue(left);
      const rightValue = readSortValue(right);
      // Rows with nothing on the sorted side sink to the bottom whichever way
      // the sort runs. Floating them to the top would bury the run behind the
      // welds that have no counterpart to sort by.
      if (!Number.isFinite(leftValue) && !Number.isFinite(rightValue)) return 0;
      if (!Number.isFinite(leftValue)) return 1;
      if (!Number.isFinite(rightValue)) return -1;
      return (leftValue - rightValue) * direction;
    });
  }, [tableRows, activeTab, statusFilter, searchQuery, sortKey, sortDirection]);

  const totalPages = Math.max(1, Math.ceil(visibleRows.length / rowsPerPage));
  const pageNumber = Math.min(currentPage, totalPages);
  const firstRowIndex = (pageNumber - 1) * rowsPerPage;
  const pageRows = visibleRows.slice(firstRowIndex, firstRowIndex + rowsPerPage);

  const toggleSort = (key: GwTableSortKey) => {
    if (sortKey === key) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDirection('asc');
    setCurrentPage(1);
  };

  const handleDownloadExcel = async () => {
    const XLSX = await import('xlsx');
    // The rows on screen, in the order they are on screen. Exporting the whole
    // unfiltered set from a filtered table hands the reader a workbook that
    // does not match what they were looking at when they pressed the button.
    const dataToExport = visibleRows.map((item, index) => ({
      'No.': index + 1,
      'Result': TIMELINE_STATUS_LABEL[item.status],
      [`${laneLabels.old} log distance (m)`]: item.match.oldVal ?? '',
      [`${laneLabels.old} feature`]: item.match.oldDesc ?? '',
      [`${laneLabels.new} log distance (m)`]: item.match.originalNewVal ?? item.match.newVal ?? '',
      [`${laneLabels.new} feature`]: item.match.newDesc ?? '',
      'Offset (m)': item.match.offset ?? '',
      'Deviation (%)': item.deviationPct === null ? '' : Number(item.deviationPct.toFixed(3)),
      'Match confidence (%)': item.confidence === null ? '' : Number(item.confidence.toFixed(1)),
    }));

    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Girth weld matches');
    worksheet['!cols'] = [
      { wch: 6 }, { wch: 11 }, { wch: 24 }, { wch: 24 },
      { wch: 24 }, { wch: 24 }, { wch: 12 }, { wch: 14 }, { wch: 20 },
    ];
    XLSX.writeFile(workbook, `GW_matches_${laneLabels.old}_to_${laneLabels.new}.xlsx`);
  };

  const chartPalette = useMemo(() => {
    const styles = getComputedStyle(document.documentElement);
    return {
      accent: styles.getPropertyValue('--color-gw-focus').trim(),
      grid: styles.getPropertyValue('--color-gw-rule').trim(),
      muted: styles.getPropertyValue('--color-gw-muted').trim(),
    };
  }, []);

  const chartData = {
    datasets: [{
      label: 'Offset (New - Old) m',
      data: graphPoints,
      borderColor: chartPalette.accent,
      backgroundColor: chartPalette.accent,
      borderWidth: 1.5,
      pointBackgroundColor: chartPalette.accent,
      pointRadius: 0,
      pointHoverRadius: 4,
      pointHitRadius: 10,
      tension: 0,
      parsing: false as const,
      normalized: true,
    }]
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: {
        type: 'linear' as const,
        grid: { color: chartPalette.grid },
        ticks: { color: chartPalette.muted },
        title: { display: true, text: 'Pipeline Length (m) →', color: chartPalette.muted, align: 'end' as const }
      },
      y: {
        grid: { color: chartPalette.grid },
        ticks: { color: chartPalette.muted },
        title: { display: true, text: 'Offset (New - Old) m ↑', color: chartPalette.muted, align: 'end' as const }
      }
    }
  };

  return (
    <div className="gw-matching-workspace bg-transparent text-gray-800 font-sans flex flex-col gap-6 animate-fade-in">
      {hasMultiplePairs && (
        <div className="ds-toolbar" style={{ borderRadius: 'var(--ds-r-lg)', border: '1px solid var(--ds-line)' }}>
          <span className="ds-toolbar__label">Run pair</span>
          {runPairs.map((pair) => {
            const isActive = pair.key === activePair?.key;
            const pending = unreviewedPairs.some((item) => item.key === pair.key);
            return (
              <Button
                key={pair.key}
                size="sm"
                variant={isActive ? 'primary' : 'secondary'}
                onClick={() => switchPair(pair.key)}
                aria-pressed={isActive}
                title={pending ? 'This pair has no matching result yet' : 'Matching result saved'}
                startIcon={
                  <span aria-hidden="true" style={{ color: pending ? 'var(--ds-warning)' : 'var(--ds-success)' }}>●</span>
                }
              >
                {pair.label}
              </Button>
            );
          })}
          <span className="ds-toolbar__spacer" />
          <span className="ds-toolbar__hint">
            {runPairs.length - unreviewedPairs.length} / {runPairs.length} pairs matched
          </span>
        </div>
      )}
      {loadError && (
        <div role="alert" className="ds-callout ds-callout--warning">
          <div className="ds-callout__body">{loadError}</div>
          <Button size="sm" variant="secondary" onClick={() => setRetryNonce((value) => value + 1)}>
            Retry
          </Button>
        </div>
      )}
      
      {/* Primary alignment workspace */}
      <div className="grid grid-cols-1 gap-5 items-start">
        
        {/* Full-width Timeline Viewer */}
        <div className="flex flex-col gap-5">
          <GwTimelineViewer
            matches={timelineMatches}
            dispositionsById={timelineDispositions}
            timeline={timelineGeometry}
            zoom={zoom}
            oldRunLabel={laneLabels.old}
            newRunLabel={laneLabels.new}
            selectedMatch={selectedMatch}
            selectedDecision={selectedMatch ? decisionFor(selectedMatch) : null}
            isLoading={isCalculating}
            canReviewSelected={Boolean(selectedMatch?.status === 'Match' && selectedMatch?.oldId !== null && selectedMatch?.oldId !== undefined && selectedMatch?.newId !== null && selectedMatch?.newId !== undefined)}
            onZoomChange={setZoom}
            onSelectMatch={setSelectedMatch}
            onClearSelection={() => setSelectedMatch(null)}
            onDisposition={(disposition) => selectedMatch && updateReview(selectedMatch, { disposition })}
            onNote={(note) => selectedMatch && updateReview(selectedMatch, { note })}
          />
          
        </div>

        {/* Full-width match table */}
        <div className="gw-table-panel ds-panel">
          <div className="gw-table__tabs" role="tablist" aria-label="Girth weld result set">
            {GW_TABLE_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                className={activeTab === tab.id ? 'is-active' : ''}
                onClick={() => { setActiveTab(tab.id); setCurrentPage(1); }}
              >
                {tab.label}
                <span>{tabCounts[tab.id].toLocaleString()}</span>
              </button>
            ))}
          </div>

          <dl className="gw-table__stats">
            <div className="gw-table__stat">
              <dt>Total features</dt>
              <dd>{tableRows.length.toLocaleString()}</dd>
            </div>
            <div className="gw-table__stat is-matched">
              <dt>{TIMELINE_STATUS_LABEL.matched}</dt>
              <dd>
                {statusCounts.matched.toLocaleString()}
                <small>{percentOfRun(statusCounts.matched, tableRows.length)}</small>
              </dd>
            </div>
            <div className="gw-table__stat is-review">
              <dt>{TIMELINE_STATUS_LABEL.review}</dt>
              <dd>
                {statusCounts.review.toLocaleString()}
                <small>{percentOfRun(statusCounts.review, tableRows.length)}</small>
              </dd>
            </div>
            <div className="gw-table__stat is-missing">
              <dt>{TIMELINE_STATUS_LABEL.missing}</dt>
              <dd>
                {statusCounts.missing.toLocaleString()}
                <small>{percentOfRun(statusCounts.missing, tableRows.length)}</small>
              </dd>
            </div>
            <div className="gw-table__stat is-offset">
              <dt>Mean offset</dt>
              <dd>{meanOffsetAll === null ? '—' : `${meanOffsetAll.toFixed(2)} m`}</dd>
            </div>
          </dl>

          <div className="gw-table__toolbar">
            <label className="gw-table__search">
              <FiSearch aria-hidden="true" />
              <input
                type="search"
                value={searchQuery}
                placeholder="Search a distance or description"
                aria-label="Search girth weld rows"
                onChange={(event) => { setSearchQuery(event.target.value); setCurrentPage(1); }}
              />
            </label>

            <label className="gw-table__filter">
              <span>Result</span>
              <select
                className="ds-select ds-select--sm"
                value={statusFilter}
                onChange={(event) => {
                  setStatusFilter(event.target.value as 'all' | TimelineStatus);
                  setCurrentPage(1);
                }}
              >
                <option value="all">All results</option>
                <option value="matched">{TIMELINE_STATUS_LABEL.matched}</option>
                <option value="review">{TIMELINE_STATUS_LABEL.review}</option>
                <option value="missing">{TIMELINE_STATUS_LABEL.missing}</option>
              </select>
            </label>

            {(statusFilter !== 'all' || searchQuery.trim() !== '') && (
              <Button
                size="xs"
                variant="ghost"
                onClick={() => { setStatusFilter('all'); setSearchQuery(''); setCurrentPage(1); }}
              >
                Clear filters
              </Button>
            )}

            <span className="ds-toolbar__spacer" />

            <Button size="sm" variant="secondary" startIcon={<FiDownload aria-hidden="true" />} onClick={handleDownloadExcel}>
              Export
            </Button>
          </div>

          <div className="gw-table__scroll">
            <table className="gw-table">
              <thead>
                <tr>
                  <th scope="col" className="gw-table__status-col">Result</th>
                  <th scope="col" className="is-numeric">
                    <SortHeader label={`${laneLabels.old} (m)`} sortKey="old" activeKey={sortKey} direction={sortDirection} onSort={toggleSort} />
                  </th>
                  <th scope="col">{laneLabels.old} feature</th>
                  <th scope="col" className="is-numeric">
                    <SortHeader label={`${laneLabels.new} (m)`} sortKey="new" activeKey={sortKey} direction={sortDirection} onSort={toggleSort} />
                  </th>
                  <th scope="col">{laneLabels.new} feature</th>
                  <th scope="col" className="is-numeric">
                    <SortHeader label="Offset (m)" sortKey="offset" activeKey={sortKey} direction={sortDirection} onSort={toggleSort} />
                  </th>
                  <th scope="col" className="is-numeric">
                    <SortHeader label="Deviation" sortKey="deviation" activeKey={sortKey} direction={sortDirection} onSort={toggleSort} />
                  </th>
                  {hasConfidence && <th scope="col">Confidence</th>}
                  <th scope="col" className="gw-table__action-col">Action</th>
                </tr>
              </thead>
              <tbody>
                {!isCalculating && visibleRows.length === 0 && (
                  <tr>
                    <td colSpan={hasConfidence ? 9 : 8} className="gw-table__empty">
                      {loadError
                        || (tableRows.length === 0
                          ? 'No matching results to display yet.'
                          : 'No girth weld matches this filter.')}
                    </td>
                  </tr>
                )}
                {pageRows.map(({ match: row, status, confidence, deviationPct }) => {
                  const band = confidence === null ? null : confidenceBand(confidence);
                  const isSelected = selectedMatch?.id === row.id;
                  const isPinned = (row.oldVal !== null && selectedGWs.includes(row.oldVal as number))
                    || (row.newVal !== null && selectedGWs.includes(row.newVal as number));
                  return (
                    <tr
                      key={String(row.id)}
                      ref={(element: HTMLTableRowElement | null) => {
                        if (element) tableRowRefs.current[String(row.id)] = element;
                        else delete tableRowRefs.current[String(row.id)];
                      }}
                      className={`is-${status}${isSelected ? ' is-selected' : ''}${isPinned ? ' is-pinned' : ''}`}
                      onMouseMove={(event) => queueTooltipUpdate({ x: event.clientX, y: event.clientY, row })}
                      onMouseLeave={() => queueTooltipUpdate(null)}
                      onClick={() => {
                        setSelectedMatch(row);
                        if (row.oldVal === null || row.oldVal === undefined) return;
                        setSelectedGWs((previous) => {
                          const distance = row.oldVal as number;
                          if (previous.includes(distance)) return previous.filter((value) => value !== distance);
                          const next = [...previous, distance].slice(-2);
                          if (next.length === 2) setShow3DViewer(true);
                          return next;
                        });
                      }}
                    >
                      <td className="gw-table__status-col">
                        <span className={`gw-status-chip is-${status}`}>{TIMELINE_STATUS_LABEL[status]}</span>
                      </td>
                      <td className="is-numeric">{metres(row.oldVal)}</td>
                      <td className="is-text" title={row.oldDesc}>{row.oldDesc || '—'}</td>
                      <td className="is-numeric">{metres(row.originalNewVal ?? row.newVal)}</td>
                      <td className="is-text" title={row.newDesc}>{row.newDesc || '—'}</td>
                      <td className="is-numeric is-strong">{metres(row.offset)}</td>
                      <td className="is-numeric">{deviationPct === null ? '—' : `${deviationPct.toFixed(2)}%`}</td>
                      {hasConfidence && (
                        <td>
                          {band === null ? '—' : (
                            <span className="gw-confidence" title={`${confidence?.toFixed(1)}%`}>
                              <span className="gw-confidence__bars" aria-hidden="true">
                                {[0, 1, 2, 3].map((index) => (
                                  <i key={index} className={index < band.filled ? 'is-filled' : ''} />
                                ))}
                              </span>
                              {band.label}
                            </span>
                          )}
                        </td>
                      )}
                      <td className="gw-table__action-col">
                        <button
                          type="button"
                          className="ds-btn ds-btn--soft ds-btn--xs"
                          onClick={(event) => { event.stopPropagation(); setSelectedMatch(row); }}
                        >
                          Inspect
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="gw-table__footer">
            <label className="gw-table__page-size">
              Rows per page
              <select
                className="ds-select ds-select--sm"
                value={rowsPerPage}
                onChange={(event) => { setRowsPerPage(Number(event.target.value)); setCurrentPage(1); }}
              >
                {[25, 50, 100, 250].map((size) => <option key={size} value={size}>{size}</option>)}
              </select>
            </label>
            <span className="gw-table__range">
              {visibleRows.length === 0
                ? 'No rows'
                : `Showing ${(firstRowIndex + 1).toLocaleString()}–${Math.min(firstRowIndex + rowsPerPage, visibleRows.length).toLocaleString()} of ${visibleRows.length.toLocaleString()}`}
            </span>
            <div className="gw-table__pager">
              <button type="button" aria-label="First page" disabled={pageNumber <= 1} onClick={() => setCurrentPage(1)}>«</button>
              <button type="button" aria-label="Previous page" disabled={pageNumber <= 1} onClick={() => setCurrentPage(pageNumber - 1)}><FiChevronLeft aria-hidden="true" /></button>
              <span>{pageNumber} / {totalPages}</span>
              <button type="button" aria-label="Next page" disabled={pageNumber >= totalPages} onClick={() => setCurrentPage(pageNumber + 1)}><FiChevronRight aria-hidden="true" /></button>
              <button type="button" aria-label="Last page" disabled={pageNumber >= totalPages} onClick={() => setCurrentPage(totalPages)}>»</button>
            </div>
            <span className="gw-table__mean">
              Mean offset (all) <strong>{meanOffsetAll === null ? '—' : `${meanOffsetAll.toFixed(2)} m`}</strong>
            </span>
          </div>
        </div>

      </div>

      {/* Matcher controls and the offset trend they produce */}
      <div className="gw-control-grid">
        <Panel className="gw-settings-panel">
          <PanelHeader
            eyebrow="Matcher"
            title="Matcher controls"
            subtitle="Alignment behaviour and matching rules for this run pair."
          />
          <PanelBody className="ds-stack">
            <SliderField
              label={`Slippage tolerance${perSectionOtaEnabled ? ' (global default)' : ''}`}
              value={ota}
              display={`${ota.toFixed(1)}%`}
              min={0.1}
              max={10}
              step={0.1}
              hint="Maximum spool-length slippage before a pair is held back for review."
              onChange={setOta}
            >
              {/* The track alone gives no sense of where 1.5 % sits between the
                  ends, which is the one thing an operator is judging when they
                  drag it. */}
              <div className="gw-slider-scale" aria-hidden="true">
                {[0.1, 2, 4, 6, 8, 10].map((mark) => <span key={mark}>{mark === 0.1 ? '0.1' : mark}%</span>)}
              </div>
            </SliderField>

            {sections.length > 0 && (
              <div className="gw-toggle-row">
                <span className="gw-toggle-row__icon" aria-hidden="true"><FiLayers /></span>
                <div className="gw-toggle-row__copy">
                  <strong>Per-section OTA</strong>
                  <small>Override the tolerance for individual pipeline sections.</small>
                </div>
                <Switch
                  checked={perSectionOtaEnabled}
                  onChange={setPerSectionOtaEnabled}
                  label="Enable per-section OTA overrides"
                />
              </div>
            )}

            {perSectionOtaEnabled && sections.length > 0 && (
              <div className="gw-section-ota">
                {sections.map((s) => {
                  const sOta = sectionOtaOverrides[s.id] ?? ota;
                  return (
                    <div key={s.id} className="gw-section-ota__item">
                      <SliderField
                        label={s.name}
                        value={sOta}
                        display={`${sOta.toFixed(1)}%`}
                        min={0.1}
                        max={10}
                        step={0.1}
                        onChange={(value) => setSectionOtaOverrides((prev) => ({ ...prev, [s.id]: value }))}
                      >
                        {sectionOtaOverrides[s.id] != null && (
                          <Button
                            size="xs"
                            variant="ghost"
                            title="Reset to global"
                            onClick={() => setSectionOtaOverrides((prev) => { const next = { ...prev }; delete next[s.id]; return next; })}
                          >
                            Reset to global
                          </Button>
                        )}
                      </SliderField>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="gw-toggle-row">
              <span className="gw-toggle-row__icon" aria-hidden="true"><FiCrosshair /></span>
              <div className="gw-toggle-row__copy">
                <strong>Strict distance &amp; spool matching</strong>
                <small>Penalises distance drift to prevent forced matches across tie-ins.</small>
              </div>
              <Switch checked={strictPenalty} onChange={setStrictPenalty} label="Strict distance and spool matching" />
            </div>

            <div className="gw-toggle-row">
              <span className="gw-toggle-row__icon" aria-hidden="true"><FiAnchor /></span>
              <div className="gw-toggle-row__copy">
                <strong>Valve-to-valve anchoring</strong>
                <small>Locks the alignment explicitly between matched valves.</small>
              </div>
              <Switch checked={useValveAnchor} onChange={setUseValveAnchor} label="Valve-to-valve anchoring" />
            </div>

            <div className="gw-toggle-row">
              <span className="gw-toggle-row__icon" aria-hidden="true"><FiActivity /></span>
              <div className="gw-toggle-row__copy">
                <strong>Apply DTW correction</strong>
                <small>Corrects the raw odometer against the reference run.</small>
              </div>
              <Switch checked={dtwOn} onChange={setDtwOn} label="Apply DTW correction" />
            </div>
          </PanelBody>
          <PanelFooter>
            <span className="ds-toolbar__hint">
              {isCalculating ? 'Re-matching with the current settings…' : 'Every change re-runs the matcher.'}
            </span>
            <span className="ds-toolbar__spacer" />
            <Button
              size="sm"
              variant="secondary"
              disabled={isAtMatcherDefaults}
              startIcon={<FiRotateCcw aria-hidden="true" />}
              onClick={resetMatcherDefaults}
            >
              Reset to defaults
            </Button>
          </PanelFooter>
        </Panel>

        <Panel className="gw-trend-panel">
          <PanelHeader
            eyebrow="Evidence"
            title="GW offset trends"
            subtitle={`Difference in log distance between ${laneLabels.old} and ${laneLabels.new} along the line.`}
            actions={(
              <Segmented<'matched' | 'all'>
                ariaLabel="Offset chart scope"
                value={chartScope}
                onChange={setChartScope}
                options={[
                  { value: 'matched', label: 'Matched only' },
                  { value: 'all', label: 'All pairs' },
                ]}
              />
            )}
          />
          <PanelBody className="ds-stack">
            <div className="gw-trend-stats">
              <div className="gw-trend-stat">
                <dt>Mean offset</dt>
                <dd>{trend === null ? '—' : `${trend.mean.toFixed(2)} m`}</dd>
                <small>
                  {trend === null
                    ? 'No paired welds in this scope'
                    : `${trend.drift >= 0 ? '↑' : '↓'} ${Math.abs(trend.drift).toFixed(2)} m end to end`}
                </small>
              </div>
              <div className="gw-trend-stat">
                <dt>Max offset</dt>
                <dd>{trend === null ? '—' : `${trend.maxAbs.toFixed(2)} m`}</dd>
                <small>{trend === null ? '—' : `at ${trend.maxAt.toFixed(0)} m`}</small>
              </div>
              <div className="gw-trend-stat">
                <dt>Slope</dt>
                <dd>{trend?.slopeMmPerM === null || trend === null ? '—' : `${trend.slopeMmPerM.toFixed(2)} mm/m`}</dd>
                <small>
                  {trend?.slopeMmPerM === null || trend === null
                    ? 'Needs two distinct distances'
                    : trend.slopeMmPerM >= 0 ? 'Drifting apart downstream' : 'Closing downstream'}
                </small>
              </div>
            </div>

            <div className="gw-trend-chart">
              <Line data={chartData} options={{
                ...chartOptions,
                maintainAspectRatio: false,
                onClick: (_event: any, elements: any[]) => {
                  if (elements.length === 0) return;
                  const match = chartPoints[elements[0].index]?.match;
                  if (!match || match.oldVal === null) return;
                  setSelectedGWs((prev) => {
                    const dist = match.oldVal;
                    if (prev.includes(dist)) return prev.filter((d: number) => d !== dist);
                    const next = [...prev, dist].slice(-2);
                    if (next.length === 2) setShow3DViewer(true);
                    return next;
                  });
                  const rowElement = tableRowRefs.current[String(match.id)];
                  if (rowElement) {
                    rowElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    rowElement.classList.add('is-pinned');
                  }
                },
              } as any} />
            </div>
          </PanelBody>
          <PanelFooter>
            <span className="ds-toolbar__hint">
              {chartPoints.length.toLocaleString()} pairs
              {trend === null ? '' : ` · ${trend.spanFrom.toFixed(0)}–${trend.spanTo.toFixed(0)} m`} · metres
            </span>
            <span className="ds-toolbar__spacer" />
            <Button
              size="sm"
              variant="secondary"
              disabled={chartPoints.length === 0}
              startIcon={<FiDownload aria-hidden="true" />}
              onClick={downloadOffsetCsv}
            >
              Export CSV
            </Button>
          </PanelFooter>
        </Panel>
      </div>

      <ActionBar
        back={
          <Button variant="ghost" startIcon={<FiChevronLeft aria-hidden="true" />} onClick={() => onBack({ sessionRevision })}>
            Adjust scenarios
          </Button>
        }
        next={
          <Button
            disabled={isCalculating || isSavingReview || Boolean(loadError) || matches.length === 0 || unreviewedPairs.length > 0}
            endIcon={<FiChevronRight aria-hidden="true" />}
            onClick={() => { void saveReviewAndContinue(); }}
          >
            {isSavingReview ? 'Saving review…' : 'Save review & next'}
          </Button>
        }
        /* Sectioning and the final comparison consume the whole chain, so
           advancing with a pair still unmatched would drop it from the results. */
        help={
          unreviewedPairs.length > 0 && !isCalculating
            ? `Still to match: ${unreviewedPairs.map((pair) => pair.label).join(', ')}.`
            : undefined
        }
      />
      {/* 3D Viewer Modal */}
      {show3DViewer && selectedGWs.length === 2 && (
        <Modal
          onClose={() => setShow3DViewer(false)}
          labelledBy="gw-3d-modal-title"
          overlayClassName="fixed inset-0 z-[999999] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in p-8"
          panelClassName="gw-3d-modal border border-gray-200 rounded-2xl w-full max-w-6xl h-[80vh] flex flex-col shadow-2xl overflow-hidden relative"
        >
            <div className="flex justify-between items-center p-4 border-b border-gray-200 bg-black/50">
              <div>
                <h3 id="gw-3d-modal-title" className="text-gray-900 font-bold flex items-center gap-2"><FiBox className="text-brand-500" /> Interactive Spool Analysis</h3>
                <p className="text-gray-500 text-xs">Viewing segment from {selectedGWs[0].toFixed(2)}m to {selectedGWs[1].toFixed(2)}m</p>
              </div>
              <button onClick={() => setShow3DViewer(false)} aria-label="Close interactive spool analysis" className="ds-btn ds-btn--secondary ds-btn--sm ds-btn--icon">
                <FiX size={20} />
              </button>
            </div>
            <div className="flex-1 bg-black relative">
              {(() => {
                const startDist = Math.min(selectedGWs[0], selectedGWs[1]);
                const endDist = Math.max(selectedGWs[0], selectedGWs[1]);
                
                // Get all metal loss/dents between these two GWs from the original oldRun payload
                const anomalies = (config?.payload?.oldRun || [])
                  .filter((f: any) => {
                    const isDefect = f.type && (f.type.toLowerCase().includes('metal loss') || f.type.toLowerCase().includes('dent') || f.type.toLowerCase().includes('corrosion') || f.type.toLowerCase().includes('anomaly'));
                    return isDefect && f.dist > startDist && f.dist < endDist;
                  })
                  .map((f: any) => ({
                    position: f.dist - startDist, // relative position from the first GW
                    depthPct: f.depth || 10,
                    clockAngle: f.orientation || 0
                  }));

                return (
                  <React.Suspense
                    fallback={(
                      <div className="flex h-full items-center justify-center text-sm text-gray-300" role="status">
                        Loading interactive 3D view…
                      </div>
                    )}
                  >
                    <Pipeline3DViewer length={endDist - startDist} od={12} anomalies={anomalies} />
                  </React.Suspense>
                );
              })()}
            </div>
        </Modal>
      )}

      {/* Math Explanation Tooltip */}
      {tooltipState && tooltipState.row.id !== 'match-0-0' && (
        <div
          className="fixed z-[100] bg-white border border-gray-200 shadow-2xl rounded-xl p-4 w-80 pointer-events-none"
          style={(() => {
            // w-80 = 320px; height estimated for the formula breakdown.
            const placement = clampTooltipPosition({
              pointerX: tooltipState.x,
              pointerY: tooltipState.y,
              tooltipWidth: 320,
              tooltipHeight: 300,
              viewportWidth: window.innerWidth,
              viewportHeight: window.innerHeight,
            });
            return { left: placement.left, top: placement.top };
          })()}
        >
          <h5 className={`font-bold mb-2 ${tooltipState.row.status === 'Match' ? 'text-blue-600' : 'text-rose-600'}`}>
            Algorithm Decision: {tooltipState.row.status}
          </h5>
          <div className="text-xs text-gray-600 space-y-2 font-mono bg-gray-50 p-3 rounded border border-gray-100 mb-3">
            <div className="flex justify-between"><span>sOld (Baseline):</span><span>{tooltipState.row.sOld?.toFixed(3)} m</span></div>
            <div className="flex justify-between"><span>sNew (Raw):</span><span>{tooltipState.row.sNew?.toFixed(3)} m</span></div>
            <div className="flex justify-between border-b border-gray-200 pb-2 mb-2 text-gray-500">
               <span>Abs. Odo Diff:</span>
               <span>{tooltipState.row.rawOffset?.toFixed(3) || tooltipState.row.offset?.toFixed(3) || '-'} m</span>
            </div>
            <div className="pt-2 flex justify-between text-blue-800 font-bold">
               <span>v = |(sOld/sNew)-1|×100</span>
               <span>{tooltipState.row.rawVarPct?.toFixed(2)}%</span>
            </div>
            {tooltipState.row.dtwOn && tooltipState.row.status === 'Match' && (
              <div className="flex justify-between text-green-700 font-bold mt-1">
                 <span>DTW (Corrected v):</span>
                 <span>{tooltipState.row.varPct?.toFixed(2)}%</span>
              </div>
            )}
          </div>
          <div className="text-xs font-medium text-gray-700 leading-relaxed">
            {tooltipState.row.status === 'Match' ? (
              <p>✅ <b>{tooltipState.row.rawVarPct?.toFixed(2)}% &lt;= {ota}% (OTA)</b><br/>Variance is within tolerance. Joints matched successfully.</p>
            ) : (
              <p>❌ <b>{tooltipState.row.rawVarPct?.toFixed(2)}% &gt; {ota}% (OTA)</b><br/>Variance exceeds tolerance. Detected local anomaly (e.g. repair spool), joint skipped.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
