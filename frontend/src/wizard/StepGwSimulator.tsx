import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Line } from 'react-chartjs-2';
import { FiX, FiBox, FiChevronRight, FiChevronLeft, FiDownload, FiSearch } from 'react-icons/fi';
import OdometerDashboard from './OdometerDashboard';
import GwTimelineViewer from './GwTimelineViewer';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Tooltip } from 'chart.js';
import { apiFetch, ApiError } from '../utils/api';
import { extentOf, maxOf, minOf } from '../utils/numericRange.ts';
import { gwReviewKey, normalizeGwReview, selectReviewedGwLocks, type GwReviewDisposition, type GwReviewState } from '../domain/alignmentReview';
import { buildTimelineModel, sourceOdometerOffset, type TimelineEvidence, type TimelineGeometry } from '../domain/gwTimeline';
import { buildGwReviewTransitionPayload } from './gwReviewTransition';
import { pairGwResult, pairTieIn, primaryRunPair, resolveRunPairs } from '../domain/runPairs';
import type { MatchingSection } from './matchingSections';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip);

const Pipeline3DViewer = React.lazy(() => import('../components/3d/Pipeline3DViewer'));

interface StepGwSimulatorProps {
  initialOta: number;
  onNext: (data?: any) => Promise<void> | void;
  onBack: (data?: any) => void;
  config?: any;
}

function runReviewIdentity(run: any) {
  const runId = Number(run?.runId);
  if (Number.isSafeInteger(runId) && runId > 0) return { runId };
  const checksum = run?.sourceChecksum || run?.checksum;
  if (checksum) return { checksum };
  return (run?.rawFeatures || []).map((feature: any) => [
    feature.id ?? feature.feature_id,
    feature.dist ?? feature.log_distance_m ?? feature.distance,
  ]);
}

function buildReviewSignature(config: any, settings: {
  ota: number;
  strictPenalty: boolean;
  useValveAnchor: boolean;
  dtwOn: boolean;
}) {
  return JSON.stringify({
    ...settings,
    oldRun: runReviewIdentity(config?.summaryData?.oldRun),
    newRun: runReviewIdentity(config?.summaryData?.newRun),
    tieInEvidenceToken: config?.tieInEvidenceToken || null,
    globalOffset: Number(config?.globalOffset) || 0,
  });
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

  const [activeTab, setActiveTab] = useState<'offset' | 'unmatched' | 'matched' | 'table' | 'odometer' | 'all'>('all');

  const handleDownloadExcel = async () => {
    const XLSX = await import('xlsx');
    const dataToExport = matches.map((m: any, index: number) => ({
      'No.': index + 1,
      'Status': m.status,
      'Baseline Odometer (m)': m.oldVal !== null ? m.oldVal.toFixed(3) : '-',
      'Raw Odometer (m)': m.newVal !== null ? m.newVal.toFixed(3) : '-',
      'Deviation (%)': m.varPct.toFixed(2) + '%',
      'Offset (m)': m.offset !== null ? m.offset.toFixed(3) : '-',
      'Flagged (>5%)': m.flagged ? 'Yes' : 'No'
    }));

    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Girth Weld Matches");

    // Adjust column widths
    worksheet['!cols'] = [
      {wch: 5},
      {wch: 12},
      {wch: 22},
      {wch: 22},
      {wch: 15},
      {wch: 15},
      {wch: 15}
    ];

    XLSX.writeFile(workbook, 'GW_Match_Report.xlsx');
  };

  const [dtwOn, setDtwOn] = useState(initialSettings.dtwOn);
  const [useValveAnchor, setUseValveAnchor] = useState(initialSettings.useValveAnchor);
  const [strictPenalty, setStrictPenalty] = useState(initialSettings.strictPenalty);
  const [currentPage, setCurrentPage] = useState(1);
  const tableRowRefs = useRef<{[key: string]: HTMLTableRowElement | null}>({});
  const itemsPerPage = 10;
  
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
          setLoadError('Partial Run aktif, tetapi TIE IN canonical belum diterapkan. Kembali ke Tie-In Setup dan gunakan rekomendasi yang accepted. Raw 0 m tidak akan dipakai untuk matching.');
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
          setLoadError('Data anchor belum tersedia. Pastikan kedua file ILI berisi fitur Weld, Valve, atau Tee.');
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
          throw new Error(data.error || 'Server tidak mengembalikan hasil GW matching.');
        }
      } catch (err: any) {
        if (err.name !== 'AbortError' && currentCalculation === calculationRevision.current) {
          console.error("Failed to run DTW:", err);
          setLoadError(err instanceof ApiError && err.status === 401
            ? 'Sesi login sudah kedaluwarsa. Silakan masuk kembali.'
            : `Gagal memuat hasil GW matching: ${err.message || 'periksa koneksi backend.'}`);
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

  const unmatchedRanges = useMemo(() => {
    const ranges: any[] = [];
    let currentRange: any = null;

    matches.forEach(m => {
      if (m.status === 'Skipped') {
        if (!currentRange) {
           currentRange = {
             id: m.id,
             oldFrom: m.oldVal, oldTo: m.oldVal,
             newFrom: m.newVal, newTo: m.newVal
           };
        } else {
           if (m.oldVal !== null) {
              if (currentRange.oldFrom === null) currentRange.oldFrom = m.oldVal;
              currentRange.oldTo = m.oldVal;
           }
           if (m.newVal !== null) {
              if (currentRange.newFrom === null) currentRange.newFrom = m.newVal;
              currentRange.newTo = m.newVal;
           }
        }
      } else {
        if (currentRange) {
           ranges.push(currentRange);
           currentRange = null;
        }
      }
    });
    if (currentRange) ranges.push(currentRange);
    return ranges;
  }, [matches]);

  const matchedOnly = useMemo(
    () => matches.filter(m => m.status === 'Match').sort((a, b) => a.oldVal - b.oldVal),
    [matches],
  );
  const filteredMatched = matchedOnly.filter(m => 
    searchQuery === '' || 
    (m.oldVal !== null && m.oldVal.toString().includes(searchQuery)) ||
    (m.newVal !== null && m.newVal.toString().includes(searchQuery))
  );
  
  const paginatedMatched = filteredMatched.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  const totalPages = Math.ceil(filteredMatched.length / itemsPerPage);


  // Build the chart from the exact rows shown in the matched table.  The
  // table and chart therefore use the same x-position and offset value,
  // including when a long-running backend worker returns a legacy payload.
  const chartPoints = useMemo(() => {
    return matchedOnly
      .map((match) => ({
        x: match.oldVal as number,
        y: match.odometerOffset as number,
        match,
      }))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  }, [matchedOnly]);

  const graphPoints = chartPoints.map(({ x, y }) => ({ x, y }));

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
        pairGwResults[pair.key] = {
          gwMatchesFinal: state.gwMatchesFinal,
          gwOrphans: state.gwOrphans,
          gwReview: state.gwReview,
          gwReviewSignature: state.reviewSignature,
          ota: state.ota,
          dtwOn: state.dtwOn,
          useValveAnchor: state.useValveAnchor,
          strictPenalty: state.strictPenalty,
        };
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
          gwReview: primary?.gwReview ?? gwReview,
          gwReviewSignature: primary?.gwReviewSignature ?? reviewSignature.current,
          sessionRevision,
          sectionOtaOverrides: perSectionOtaEnabled ? sectionOtaOverrides : undefined,
        }),
        pairGwResults,
      });
    } finally {
      setIsSavingReview(false);
    }
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
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3">
          <span className="text-xs font-bold uppercase tracking-wide text-brand-700">Run Pair</span>
          <div className="flex flex-wrap gap-1">
            {runPairs.map((pair) => {
              const isActive = pair.key === activePair?.key;
              const pending = unreviewedPairs.some((item) => item.key === pair.key);
              return (
                <button
                  key={pair.key}
                  onClick={() => switchPair(pair.key)}
                  aria-pressed={isActive}
                  title={pending ? 'Pasangan ini belum punya hasil matching' : 'Hasil matching tersimpan'}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                    isActive
                      ? 'bg-brand-600 text-white shadow-sm'
                      : 'bg-white text-brand-700 border border-brand-200 hover:bg-brand-100'
                  }`}
                >
                  <span aria-hidden="true" className={pending ? 'text-amber-500' : 'text-emerald-500'}>●</span>
                  {pair.label}
                </button>
              );
            })}
          </div>
          <span className="ml-auto text-xs text-brand-600">
            {runPairs.length - unreviewedPairs.length} / {runPairs.length} pasangan sudah dicocokkan
          </span>
        </div>
      )}
      {loadError && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 shadow-sm">
          <span>{loadError}</span>
          <button
            type="button"
            onClick={() => setRetryNonce((value) => value + 1)}
            className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100"
          >
            Coba lagi
          </button>
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
            /* In a chain, the NEW side of an intermediate pair is not the master
               run — labelling it "Master NEW" made a 2012→2024 comparison read as
               though 2024 were the master when 2026 was. */
            oldRunLabel={activePair?.oldRun?.year ? `${activePair.oldRun.year} (OLD)` : 'Historical OLD'}
            newRunLabel={activePair?.newRun?.year
              ? `${activePair.newRun.year}${activePair.key === primaryPair?.key ? ' (Master NEW)' : ' (NEW)'}`
              : 'Master NEW'}
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
        <div className="flex flex-col gap-5">
          
          {/* Data Tables Container */}
          <div className="gw-match-table bg-white rounded-xl shadow-theme-sm border border-gray-200 flex flex-col overflow-hidden" style={{ height: 'min(70vh, 720px)', minHeight: '520px' }}>
            
            {/* Tabs Header */}
            <div className="flex border-b border-gray-200 bg-gray-50">
              {[
                { id: 'all', label: 'All GWs' },
                { id: 'matched', label: 'Matched' },
                { id: 'unmatched', label: 'Unmatched' }
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => { setActiveTab(tab.id as any); setCurrentPage(1); }}
                  className={`flex-1 py-3 text-xs font-bold transition-colors border-b-2 tracking-wide uppercase ${
                    activeTab === tab.id || (activeTab === 'offset' && tab.id === 'all') || (activeTab === 'odometer' && tab.id === 'all')
                      ? 'border-blue-600 text-blue-600 bg-white shadow-[0_2px_0_0_white]' 
                      : 'border-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-100'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex-1 flex flex-col overflow-hidden relative">
              {/* Unmatched Table */}
              {(activeTab === 'unmatched') && (
                <div className="absolute inset-0 flex flex-col bg-white">
                  <div className="p-2 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                    <span className="text-xs font-bold text-gray-600 pl-2">Anomalies Detected</span>
                    <button className="text-gray-500 hover:text-gray-800 p-1.5 hover:bg-gray-200 rounded transition-colors"><FiDownload size={14} /></button>
                  </div>
                  <div className="flex-1 overflow-auto custom-scrollbar">
                    <table className="w-full min-w-[760px] text-left text-xs leading-tight">
                      <thead className="text-gray-500 bg-gray-50 sticky top-0 border-b border-gray-200 z-10 shadow-sm">
                        <tr>
                          <th className="px-3 py-2 font-bold">Old From</th>
                          <th className="px-3 py-2 font-bold">New From</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {unmatchedRanges.map((r, idx) => (
                          <tr key={idx} className="hover:bg-rose-50/50 transition-colors group">
                            <td className="px-3 py-2 font-mono text-gray-700">{r.oldFrom !== null ? r.oldFrom : ''}</td>
                            <td className="px-3 py-2 font-mono text-gray-700">{r.newFrom !== null ? r.newFrom : ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Matched Table */}
              {(activeTab === 'matched') && (
                <div className="absolute inset-0 flex flex-col bg-white">
                  <div className="p-2 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                    <div className="relative flex-1 max-w-[180px]">
                      <FiSearch className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" size={12} />
                      <input 
                        type="text" placeholder="Search GW..." 
                        value={searchQuery} onChange={(e) => {setSearchQuery(e.target.value); setCurrentPage(1);}}
                        className="w-full pl-7 pr-2 py-1 text-xs border border-gray-200 rounded bg-white focus:outline-none focus:border-blue-500" 
                      />
                    </div>
                    <button className="text-gray-500 hover:text-gray-800 p-1.5 hover:bg-gray-200 rounded transition-colors"><FiDownload size={14} /></button>
                  </div>
                  <div className="flex-1 overflow-auto custom-scrollbar">
                    <table className="w-full min-w-[920px] text-left text-xs leading-tight">
                      <thead className="text-gray-500 bg-gray-50 sticky top-0 border-b border-gray-200 z-10 shadow-sm">
                        <tr>
                          <th className="px-2 py-2 w-14 text-center font-bold">Review</th>
                          <th className="px-3 py-2 font-bold">Old Run (m)</th>
                          <th className="px-3 py-2 font-bold">Old Desc</th>
                          <th className="px-3 py-2 font-bold">New Run (m)</th>
                          <th className="px-3 py-2 font-bold">New Desc</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {paginatedMatched.map((row) => (
                            <tr
                              key={row.id}
                              onClick={() => setSelectedMatch(row)}
                              className={`cursor-pointer transition-colors ${
                                selectedMatch?.id === row.id
                                  ? 'bg-blue-100 border-l-2 border-blue-500'
                                  : 'border-l-2 border-transparent hover:bg-blue-50/50'
                              }`}
                            >
                              <td className="px-2 py-2 text-center">
                                <button type="button" onClick={(event) => { event.stopPropagation(); setSelectedMatch(row); }} className="rounded border border-blue-200 bg-blue-50 px-1.5 py-1 text-[10px] font-bold text-blue-700 hover:bg-blue-100">Open</button>
                              </td>
                              <td className="px-3 py-2 font-mono text-gray-700">{row.oldVal !== null ? row.oldVal : '-'}</td>
                              <td className="px-3 py-2 text-gray-500 truncate max-w-[260px]" title={row.oldDesc}>{row.oldDesc}</td>
                              <td className="px-3 py-2 font-mono text-gray-700">{row.originalNewVal !== undefined && row.originalNewVal !== null ? row.originalNewVal : '-'}</td>
                              <td className="px-3 py-2 text-gray-500 truncate max-w-[260px]" title={row.newDesc}>{row.newDesc}</td>
                            </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {/* Pagination Mini */}
                  <div className="px-3 py-2 bg-gray-50 border-t border-gray-200 flex justify-between items-center text-[10px]">
                    <div className="flex gap-1">
                      <button onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))} className="p-1 text-gray-500 hover:bg-gray-200 rounded"><FiChevronLeft/></button>
                      <span className="p-1 font-bold text-gray-700">{currentPage} / {totalPages}</span>
                      <button onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))} className="p-1 text-gray-500 hover:bg-gray-200 rounded"><FiChevronRight/></button>
                    </div>
                  </div>
                </div>
              )}

              {/* All Table (Default) */}
              {(activeTab === 'all' || activeTab === 'offset' || activeTab === 'odometer') && (
                <div className="absolute inset-0 flex flex-col bg-white">
                   <div className="p-2 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                    <span className="text-xs font-bold text-gray-600 pl-2">All Pipeline Features</span>
                    <button onClick={handleDownloadExcel} className="text-blue-600 bg-blue-50 hover:bg-blue-100 flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-bold rounded transition-colors uppercase"><FiDownload /> Export</button>
                  </div>
                  <div className="flex-1 overflow-auto custom-scrollbar">
                    <table className="w-full min-w-[980px] text-left text-xs leading-tight">
                      <thead className="text-gray-500 bg-gray-50 sticky top-0 border-b border-gray-200 z-10 shadow-sm">
                        <tr>
                          <th className="px-3 py-2 font-bold w-6"></th>
                          <th className="px-3 py-2 font-bold">Old Run (m)</th>
                          <th className="px-3 py-2 font-bold">Old Desc</th>
                          <th className="px-3 py-2 font-bold">New Run (m)</th>
                          <th className="px-3 py-2 font-bold">New Desc</th>
                          <th className="px-3 py-2 font-bold text-right">Offset</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {!isCalculating && matches.length === 0 && (
                          <tr>
                            <td colSpan={6} className="px-3 py-10 text-center text-gray-500">
                              {loadError || 'Belum ada hasil matching untuk ditampilkan.'}
                            </td>
                          </tr>
                        )}
                        {matches.map((row) => (
                          <tr key={row.id} 
                            ref={(el: HTMLTableRowElement | null) => { if (el) tableRowRefs.current[row.id] = el; }}
                            className={`transition-colors cursor-pointer group ${
                              selectedMatch?.id === row.id
                                ? 'bg-blue-100 hover:bg-blue-100'
                                :
                              (row.oldVal !== null && selectedGWs.includes(row.oldVal)) || (row.newVal !== null && selectedGWs.includes(row.newVal))
                                ? 'bg-yellow-100 hover:bg-yellow-200' 
                                : row.status === 'Skipped'
                                  ? 'bg-rose-50 hover:bg-rose-100'
                                  : row.status === 'Flagged'
                                    ? 'bg-amber-50 hover:bg-amber-100'
                                    : 'hover:bg-blue-50/50'
                            }`}
                            onMouseMove={(e) => setTooltipState({ x: e.clientX, y: e.clientY, row: row })}
                            onMouseLeave={() => setTooltipState(null)}
                            onClick={() => {
                              setSelectedMatch(row);
                              if (row.oldVal === null) return;
                              setSelectedGWs(prev => {
                                const dist = row.oldVal;
                                if (prev.includes(dist)) return prev.filter(d => d !== dist);
                                const next = [...prev, dist].slice(-2);
                                if (next.length === 2) setShow3DViewer(true);
                                return next;
                              });
                            }}>
                            <td className="px-3 py-2.5">
                              <div className={`w-1.5 h-1.5 rounded-full ${row.status === 'Match' ? 'bg-blue-500' : 'bg-rose-500'}`}></div>
                            </td>
                            <td className="px-3 py-2.5 font-mono text-gray-700">{row.oldVal !== null ? row.oldVal : '-'}</td>
                            <td className="px-3 py-2.5 text-gray-500 truncate max-w-[320px]" title={row.oldDesc}>{row.oldDesc}</td>
                            <td className="px-3 py-2.5 font-mono text-gray-700">{row.originalNewVal !== undefined && row.originalNewVal !== null ? row.originalNewVal : '-'}</td>
                            <td className="px-3 py-2.5 text-gray-500 truncate max-w-[320px]" title={row.newDesc}>{row.newDesc}</td>
                            <td className="px-3 py-2.5 font-mono font-bold text-right text-gray-800">{row.offset !== null ? row.offset : '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
            
            {/* Table Footer Stats */}
            <div className="bg-gray-50 border-t border-gray-200 px-4 py-3 flex justify-between items-center text-xs">
               <div className="flex flex-col">
                 <span className="font-bold text-gray-800">{matches.filter(m => m.status === 'Match').length}</span>
                 <span className="text-gray-500 text-[10px] uppercase tracking-wider">Total Matches</span>
               </div>
               <div className="h-6 w-px bg-gray-300"></div>
               <div className="flex flex-col text-right">
                 <span className="font-bold text-blue-600">{(graphPoints.reduce((sum, p) => sum + p.y, 0) / (graphPoints.length || 1)).toFixed(2)}m</span>
                 <span className="text-gray-500 text-[10px] uppercase tracking-wider">Mean Offset</span>
               </div>
            </div>
          </div>
          
        </div>

      </div>

      {/* Middle Row: OTA Settings & GW Offset Trends */}
      <div className="gw-control-grid grid grid-cols-1 xl:grid-cols-5 gap-5 items-stretch">
        
        {/* LEFT: OTA Settings */}
        <div className="xl:col-span-2 flex">
          <div className="gw-settings-panel bg-white rounded-2xl p-6 shadow-xl shadow-blue-900/5 border border-gray-200 flex flex-col justify-between w-full">
             <div>
               <h3 className="font-bold text-gray-800 text-lg mb-1">OTA Settings</h3>
               <p className="text-xs text-gray-500 mb-6 leading-relaxed">Adjust slippage tolerance and toggle DTW correction to force alignment.</p>
               
               <div className="mt-6 space-y-4">
                 <label className="flex items-center justify-between text-sm font-bold text-gray-700">
                   <span>Slippage Tolerance {perSectionOtaEnabled ? '(Global Default)' : ''}</span>
                   <span className="font-mono bg-white px-2 py-1 rounded shadow-sm border border-gray-200 text-blue-600">{ota}%</span>
                 </label>
                 <input type="range" min="0.1" max="10" step="0.1" value={ota} onChange={e => setOta(parseFloat(e.target.value))} className="w-full accent-blue-600 h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer" />
               </div>

               {sections.length > 0 && (
                 <div className="mt-4 flex items-center justify-between bg-amber-50/50 px-4 py-3 rounded-xl border border-amber-200">
                   <div>
                     <span className="font-bold text-sm text-amber-900">Per-Section OTA</span>
                     <p className="text-[10px] text-amber-700/80 font-medium mt-0.5">Override OTA threshold for individual pipeline sections</p>
                   </div>
                   <button onClick={() => setPerSectionOtaEnabled(!perSectionOtaEnabled)} className={`w-12 h-6 rounded-full transition-colors relative shadow-inner ${perSectionOtaEnabled ? 'bg-amber-500' : 'bg-gray-300'}`}>
                     <div className={`w-4 h-4 bg-white rounded-full absolute left-1 top-1 transition-transform shadow-md ${perSectionOtaEnabled ? 'translate-x-6' : 'translate-x-0'}`} />
                   </button>
                 </div>
               )}

               {perSectionOtaEnabled && sections.length > 0 && (
                 <div className="mt-3 space-y-3 max-h-48 overflow-y-auto pr-1">
                   {sections.map((s) => {
                     const sOta = sectionOtaOverrides[s.id] ?? ota;
                     return (
                       <div key={s.id} className="bg-amber-50/30 border border-amber-100 rounded-lg px-4 py-3">
                         <div className="flex items-center justify-between mb-2">
                           <span className="text-xs font-bold text-gray-700 truncate max-w-[60%]">{s.name}</span>
                           <div className="flex items-center gap-2">
                             <span className="font-mono text-xs bg-white px-1.5 py-0.5 rounded border border-amber-200 text-amber-700">{sOta}%</span>
                             {sectionOtaOverrides[s.id] != null && (
                               <button
                                 onClick={() => setSectionOtaOverrides((prev) => { const next = { ...prev }; delete next[s.id]; return next; })}
                                 className="text-[10px] text-gray-400 hover:text-red-500"
                                 title="Reset to global"
                               >reset</button>
                             )}
                           </div>
                         </div>
                         <input
                           type="range" min="0.1" max="10" step="0.1" value={sOta}
                           onChange={(e) => setSectionOtaOverrides((prev) => ({ ...prev, [s.id]: parseFloat(e.target.value) }))}
                           className="w-full accent-amber-500 h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                         />
                       </div>
                     );
                   })}
                 </div>
               )}
             </div>

             <div className="flex items-center justify-between bg-blue-50/50 px-5 py-4 rounded-xl border border-blue-100 w-full mb-3">
                <div>
                  <span className="font-bold text-sm text-blue-900">Strict Distance & Spool Matching</span>
                  <p className="text-[10px] text-blue-600/80 font-medium mt-0.5">Penalizes distance drift to prevent forced matches across Tie-ins</p>
                </div>
                <button onClick={() => setStrictPenalty(!strictPenalty)} className={`w-12 h-6 rounded-full transition-colors relative shadow-inner ${strictPenalty ? 'bg-blue-600' : 'bg-gray-300'}`}>
                  <div className={`w-4 h-4 bg-white rounded-full absolute left-1 top-1 transition-transform shadow-md ${strictPenalty ? 'translate-x-6' : 'translate-x-0'}`} />
                </button>
              </div>

              <div className="flex items-center justify-between bg-blue-50/50 px-5 py-4 rounded-xl border border-blue-100 w-full mb-3">
                <div>
                  <span className="font-bold text-sm text-blue-900">Valve-to-Valve Anchoring</span>
                  <p className="text-[10px] text-blue-600/80 font-medium mt-0.5">Locks alignment explicitly between matched valves</p>
                </div>
                <button onClick={() => setUseValveAnchor(!useValveAnchor)} className={`w-12 h-6 rounded-full transition-colors relative shadow-inner ${useValveAnchor ? 'bg-blue-600' : 'bg-gray-300'}`}>
                  <div className={`w-4 h-4 bg-white rounded-full absolute left-1 top-1 transition-transform shadow-md ${useValveAnchor ? 'translate-x-6' : 'translate-x-0'}`} />
                </button>
              </div>

             <div className="flex items-center justify-between bg-blue-50/50 px-5 py-4 rounded-xl border border-blue-100 w-full">
               <div>
                 <span className="font-bold text-sm text-blue-900">Apply DTW Correction</span>
                 <p className="text-[10px] text-blue-600/80 font-medium mt-0.5">Corrects raw odometer using reference run</p>
               </div>
               <button onClick={() => setDtwOn(!dtwOn)} className={`w-12 h-6 rounded-full transition-colors relative shadow-inner ${dtwOn ? 'bg-blue-600' : 'bg-gray-300'}`}>
                 <div className={`w-4 h-4 bg-white rounded-full absolute left-1 top-1 transition-transform shadow-md ${dtwOn ? 'translate-x-6' : 'translate-x-0'}`} />
               </button>
             </div>
          </div>
        </div>

        {/* RIGHT: GW Offset Chart */}
        <div className="xl:col-span-3 flex">
      <div className="gw-trend-panel bg-white rounded-2xl p-6 shadow-xl shadow-blue-900/5 border border-gray-200 flex flex-col w-full">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h3 className="font-bold text-gray-800 text-lg">GW Offset Trends</h3>
            <p className="text-xs text-gray-500">Difference in distance (m) over pipeline</p>
          </div>
          <div className="bg-blue-50 px-2 py-1 rounded text-blue-700 text-xs font-bold font-mono">Matched Only</div>
        </div>
        <div className="w-full relative h-[300px]">
          <Line data={chartData} options={{
            ...chartOptions,
            maintainAspectRatio: false,
            onClick: (e: any, elements: any[]) => {
              if (elements.length > 0) {
                const idx = elements[0].index;
                const match = chartPoints[idx]?.match;
                if (match && match.oldVal !== null) {
                  setSelectedGWs(prev => {
                    const dist = match.oldVal;
                    if (prev.includes(dist)) return prev.filter(d => d !== dist);
                    const next = [...prev, dist].slice(-2);
                    if (next.length === 2) setShow3DViewer(true);
                    return next;
                  });
                  const rowEl = tableRowRefs.current[match.id];
                  if (rowEl) {
                    rowEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    rowEl.classList.add('animate-pulse', 'bg-yellow-200');
                    setTimeout(() => rowEl.classList.remove('animate-pulse', 'bg-yellow-200'), 2000);
                  }
                }
              }
            }
          } as any} />
        </div>
      </div>
      </div>
      </div>

      {/* Full-Width Odometer Slippage Section */}
      <div className="gw-review-panel bg-white rounded-2xl p-6 shadow-xl shadow-blue-900/5 border border-gray-200">
        <div className="flex items-center justify-between mb-4 border-b border-gray-100 pb-4">
          <div>
            <h3 className="text-lg font-bold text-gray-800">Joint Review Queue</h3>
            <p className="text-xs font-medium text-gray-500 mt-1">Review high-deviation matched joints before accepting alignment.</p>
          </div>
        </div>
        <OdometerDashboard matches={matchedOnly} ota={ota} setOta={setOta} dtwOn={dtwOn} setDtwOn={setDtwOn} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
        <button
          onClick={() => onBack({ sessionRevision })}
          className="px-6 py-3 rounded-xl font-medium text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors flex items-center gap-2"
        >
          <FiChevronLeft /> Adjust Scenarios
        </button>
        {/* Sectioning and the final comparison consume the whole chain, so
            advancing with a pair still unmatched would drop it from the results. */}
        {unreviewedPairs.length > 0 && !isCalculating && (
          <p role="status" className="flex-1 text-right text-sm text-amber-700">
            Masih perlu dicocokkan: {unreviewedPairs.map((pair) => pair.label).join(', ')}.
          </p>
        )}
        <button
          type="button"
          disabled={isCalculating || isSavingReview || Boolean(loadError) || matches.length === 0 || unreviewedPairs.length > 0}
          onClick={() => { void saveReviewAndContinue(); }}
          className="bg-white hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50 text-black px-8 py-3 rounded-xl font-medium transition-colors flex items-center gap-2 shadow-lg shadow-white/10"
        >
          {isSavingReview ? 'Saving review…' : 'Save review & Next'} <FiChevronRight />
        </button>
      </div>
      {/* 3D Viewer Modal */}
      {show3DViewer && selectedGWs.length === 2 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in p-8">
          <div className="gw-3d-modal border border-gray-200 rounded-2xl w-full max-w-6xl h-[80vh] flex flex-col shadow-2xl overflow-hidden relative">
            <div className="flex justify-between items-center p-4 border-b border-gray-200 bg-black/50">
              <div>
                <h3 className="text-gray-900 font-bold flex items-center gap-2"><FiBox className="text-brand-500" /> Interactive Spool Analysis</h3>
                <p className="text-gray-500 text-xs">Viewing segment from {selectedGWs[0].toFixed(2)}m to {selectedGWs[1].toFixed(2)}m</p>
              </div>
              <button onClick={() => setShow3DViewer(false)} className="text-gray-500 hover:text-gray-900 bg-gray-100 hover:bg-gray-700 p-2 rounded-full transition-colors">
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
          </div>
        </div>
      )}

      {/* Math Explanation Tooltip */}
      {tooltipState && tooltipState.row.id !== 'match-0-0' && (
        <div className="fixed z-[100] bg-white border border-gray-200 shadow-2xl rounded-xl p-4 w-80 pointer-events-none" style={{ left: tooltipState.x + 15, top: tooltipState.y + 15 }}>
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
