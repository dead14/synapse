/**
 * FFS results expressed in the Spool Detail View's feature model.
 *
 * The alignment side already has a 3D pipe and an unrolled shell that engineers
 * here know how to read, and both take `SpoolFeature`. Building a second pair
 * of viewers for FFS would mean two pictures of the same pipe that disagree
 * about how big a defect is, so the FFS rows are translated into that model
 * instead and the existing panes are reused unchanged.
 *
 * Nothing is invented in the translation. An FFS assessment holds one run, so
 * the PREVIOUS side is marked absent rather than reconstructed backwards from a
 * growth rate — a projection run in reverse is not an observation, and drawing
 * it as one would put a defect on the pipe that no inspection ever reported.
 */

import type { SpoolFeature, SpoolMatchStatus, SpoolSide } from '../../domain/spoolFeatures.ts';
import { clockLabelFromDegrees } from '../../domain/spoolFeatures.ts';
import type { FfsScreenedResult } from './types.ts';
import type { FfsSpool } from './spoolReview.ts';
import { resolvedDepthRate, resolvedLengthRate } from './growthResolution.ts';

const ABSENT_SIDE: SpoolSide = {
  present: false,
  id: null,
  maM: null,
  reportedM: null,
  depthPct: null,
  lengthMm: null,
  widthMm: null,
  clockDeg: null,
  clockLabel: '—',
  wtMm: null,
  erf: null,
  psafeBar: null,
  external: null,
  jointNo: null,
  distGwM: null,
  featureType: '',
  year: null,
  remainingWtMm: null,
};

function numericLd(item: FfsScreenedResult): number {
  const value = Number(item.nominal.ld);
  return Number.isFinite(value) ? value : 0;
}

function externalOf(surface: string | null | undefined): boolean | null {
  const raw = String(surface ?? '').toUpperCase();
  if (raw.includes('EXT')) return true;
  if (raw.includes('INT')) return false;
  return null;
}

/**
 * The status drives the outline colour in both panes. An FFS row carries the
 * run-pair growth evidence the alignment produced, so it can say whether the
 * feature grew without pretending to hold the previous run's dimensions.
 */
function statusOf(item: FfsScreenedResult): SpoolMatchStatus {
  // Read the source observation, never the rate. Testing `rate > 0` called a
  // feature "matched" whenever the growth ladder had supplied it a derived
  // rate — so a NEW-only anomaly the run pair never saw was outlined as a
  // matched box with no growth, which is two wrong claims in one colour.
  const observation = item.nominal.growthEvidence?.depth.observation;
  if (observation === 'new-only-zero-baseline-estimate') return 'new';
  if (observation === 'matched-measured' || observation === 'manual-reported') {
    return resolvedDepthRate(item.nominal) > 0 ? 'matched-growth' : 'matched-no-growth';
  }
  return 'matched-no-growth';
}

export function spoolFeatureFromFfs(item: FfsScreenedResult): SpoolFeature {
  const clockDeg = item.clockHour === null ? 0 : item.clockHour * 30;
  const maM = numericLd(item);
  const n = item.nominal;
  const current: SpoolSide = {
    present: true,
    id: n.featureId,
    maM,
    reportedM: maM,
    depthPct: n.maxDepthPct,
    lengthMm: n.length,
    // Width is optional in the assessment; 0 means the run reported none, and
    // the geometry panes already render a missing width as "—".
    widthMm: n.width > 0 ? n.width : null,
    clockDeg: item.clockHour === null ? null : clockDeg,
    clockLabel: item.clockHour === null ? '—' : clockLabelFromDegrees(clockDeg),
    wtMm: n.wall,
    // The FFS ERF, not a vendor column: this pane is showing the assessment.
    erf: Number.isFinite(n.ERF) ? n.ERF : null,
    psafeBar: Number.isFinite(n.safePressure) ? n.safePressure * 10 : null,
    external: externalOf(n.surface),
    jointNo: n.jointNumber,
    distGwM: n.usGwDistanceM,
    featureType: 'Metal Loss',
    year: null,
    remainingWtMm: n.wall * (1 - n.maxDepthPct / 100),
  };

  return {
    // The feature index is the identity the whole FFS workspace selects on, so
    // the key has to be the one the card, the table and the panes all agree on.
    key: `${item.key}:${item.index}`,
    rowIndex: item.index,
    id: n.featureId ?? `Row ${item.index + 1}`,
    kind: 'anomaly',
    featureClass: 'metal-loss',
    status: statusOf(item),
    maM,
    clockDeg,
    clockLabel: current.clockLabel,
    current,
    previous: ABSENT_SIDE,
    depthDeltaPct: null,
    lengthDeltaMm: null,
    widthDeltaMm: null,
    erfDelta: null,
    remainingWtDeltaMm: null,
    maShiftM: null,
    depthGrowthPctPerYear: n.wall > 0 ? (resolvedDepthRate(n) / n.wall) * 100 : null,
    lengthGrowthMmPerYear: resolvedLengthRate(n),
    intervalYears: null,
    section: n.section,
    bypassReason: null,
    physicsWarning: null,
    comment: n.recommendation,
  };
}

export interface FfsSpoolGeometry {
  features: SpoolFeature[];
  welds: Array<{ id: string; maM: number }>;
  startM: number;
  endM: number;
  /** Outer diameter the rows were assessed with, so the arcs are real. */
  odMm: number | null;
  /** True when the two welds bounding the drawing are the run's own. */
  weldBounded: boolean;
}

/**
 * Everything the two panes need for one spool.
 *
 * Unlike the alignment viewer, every FFS row carries the outer diameter the
 * assessment used, so the circumferential extent here is a measured arc rather
 * than a nominal band.
 */
export function ffsSpoolGeometry(spool: FfsSpool): FfsSpoolGeometry {
  const features = spool.members.map(spoolFeatureFromFfs);
  const odMm = spool.members.find((member) => member.nominal.od > 0)?.nominal.od ?? null;
  const weldBounded = spool.usGwLdM !== null && spool.dsGwLdM !== null
    && spool.dsGwLdM > spool.usGwLdM;

  if (weldBounded) {
    return {
      features,
      welds: [
        { id: spool.usGwId ?? 'US GW', maM: spool.usGwLdM as number },
        { id: spool.dsGwId ?? 'DS GW', maM: spool.dsGwLdM as number },
      ],
      startM: spool.usGwLdM as number,
      endM: spool.dsGwLdM as number,
      odMm,
      weldBounded,
    };
  }

  // No weld ladder: the drawing covers the features themselves, with a margin
  // so a defect on the edge is not sliced in half by the frame.
  const margin = Math.max(0.5, (spool.lastFeatureLdM - spool.firstFeatureLdM) * 0.1);
  return {
    features,
    welds: [],
    startM: spool.firstFeatureLdM - margin,
    endM: spool.lastFeatureLdM + margin,
    odMm,
    weldBounded,
  };
}
