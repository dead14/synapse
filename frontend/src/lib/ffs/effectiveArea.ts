/**
 * The Level 2 Effective Area Method of ASME B31G-2023 para. 2.3.
 *
 * Level 1 knows one maximum depth and one axial extent, so a colony of pits has
 * to be assessed as a single flaw the length of the whole colony at the depth of
 * its deepest pit. That is conservative by a wide and unquantified margin — the
 * standard's own Example 2 shows a pair that passes individually and fails once
 * merged, purely because the sound metal between the pits is counted as gone.
 *
 * The Effective Area Method removes that assumption. Given a profile of the
 * metal loss along the axis, it evaluates every contiguous sub-length of the
 * profile as a candidate flaw and reports the lowest failure pressure any of
 * them produces:
 *
 *     S_F = S_flow · (1 − A/A₀) / (1 − (A/A₀)/M)      A₀ = L·t
 *
 * where A is the metal lost over the sub-length and L is that sub-length. The
 * governing combination is often not the whole profile and not the deepest pit,
 * but some stretch in between — which is exactly why it has to be searched
 * rather than reasoned about.
 *
 * The standard notes n!/2(n−2)! iterations for an n-point profile. That counts
 * unordered endpoint pairs, which is the same n(n−1)/2 this implementation
 * walks, with a running metal-loss sum so each candidate costs O(1).
 */

import { foliasFactor, flowStress, normalizedLength, type B31gGeometry, type B31gMethod, type FlowStressMode } from './b31g.ts';
import type { FfsScreenedResult } from './types.ts';
import { maxBy } from '../../utils/numericRange.ts';

/**
 * One measured station along the axis.
 *
 * `depthMm` is metal lost at that station, so a point at nominally full wall
 * carries depth 0. B31G expects the profile to begin and end at full wall.
 */
export interface EffectiveAreaProfilePoint {
  /** Distance along the pipe axis from the start of the profile, in mm. */
  positionMm: number;
  depthMm: number;
}

export interface EffectiveAreaCandidate {
  /** Profile point indices bounding this sub-length. */
  startIndex: number;
  endIndex: number;
  startMm: number;
  endMm: number;
  lengthMm: number;
  /** Metal lost over the sub-length, in mm². */
  metalLossAreaMm2: number;
  /** Original metal over the sub-length, A₀ = L·t, in mm². */
  originalAreaMm2: number;
  z: number;
  foliasFactor: number | null;
  failureStressMpa: number;
  failurePressureMpa: number;
  safePressureMpa: number;
  erf: number;
}

export interface EffectiveAreaResult {
  /** The sub-length producing the lowest failure pressure. */
  governing: EffectiveAreaCandidate | null;
  /** Every sub-length evaluated, worst first. */
  candidates: EffectiveAreaCandidate[];
  iterations: number;
  profileLengthMm: number;
  /** Deepest point in the profile, as a fraction of wall. */
  maxDepthRatio: number;
  valid: boolean;
  invalidReason: string | null;
}

/**
 * Trapezoidal metal-loss area between consecutive stations.
 *
 * The profile is a series of measurements, not a step function: joining them
 * with straight lines is what the river-bottom profile means, and treating each
 * station as a rectangle would systematically overstate the loss.
 */
function segmentAreas(profile: EffectiveAreaProfilePoint[]): number[] {
  const areas: number[] = [];
  for (let i = 1; i < profile.length; i++) {
    const width = profile[i].positionMm - profile[i - 1].positionMm;
    areas.push(((profile[i - 1].depthMm + profile[i].depthMm) / 2) * width);
  }
  return areas;
}

/**
 * Evaluates every contiguous sub-length of the profile and returns the worst.
 *
 * Never throws: an unusable profile comes back with `valid: false` and a reason,
 * the same contract the Level 1 kernel keeps, because the caller is often
 * assembling profiles from ILI records that may not be complete.
 */
export function evaluateEffectiveArea(
  profile: EffectiveAreaProfilePoint[],
  geometry: B31gGeometry,
  method: B31gMethod,
  flowStressMode: FlowStressMode = 'smys69',
  /** Cap on retained candidates; the governing one is always kept. */
  keepCandidates = 25,
): EffectiveAreaResult {
  const empty: EffectiveAreaResult = {
    governing: null,
    candidates: [],
    iterations: 0,
    profileLengthMm: 0,
    maxDepthRatio: 0,
    valid: false,
    invalidReason: null,
  };

  if (profile.length < 3) {
    return { ...empty, invalidReason: 'A profile needs at least three stations, beginning and ending at full wall.' };
  }
  const { wallThickness, outerDiameter, smysMpa, safetyFactor, operatingPressureMpa } = geometry;
  if (!(wallThickness > 0) || !(outerDiameter > 0) || !(safetyFactor > 0)) {
    return { ...empty, invalidReason: 'Geometry is missing or not usable.' };
  }
  for (let i = 1; i < profile.length; i++) {
    if (!(profile[i].positionMm > profile[i - 1].positionMm)) {
      return { ...empty, invalidReason: 'Profile stations must increase monotonically along the axis.' };
    }
  }
  if (profile.some((point) => !Number.isFinite(point.depthMm) || point.depthMm < 0)) {
    return { ...empty, invalidReason: 'Profile depths must be finite and non-negative.' };
  }

  const flow = flowStress(smysMpa, method, flowStressMode);
  const areas = segmentAreas(profile);
  // Prefix sums, so the metal loss between any two stations is one subtraction
  // and the whole search stays O(n²) rather than O(n³).
  const cumulative = [0];
  for (const area of areas) cumulative.push(cumulative[cumulative.length - 1] + area);

  const candidates: EffectiveAreaCandidate[] = [];
  let governing: EffectiveAreaCandidate | null = null;
  let iterations = 0;

  for (let start = 0; start < profile.length - 1; start++) {
    for (let end = start + 1; end < profile.length; end++) {
      iterations += 1;
      const lengthMm = profile[end].positionMm - profile[start].positionMm;
      if (!(lengthMm > 0)) continue;

      const metalLossAreaMm2 = cumulative[end] - cumulative[start];
      const originalAreaMm2 = lengthMm * wallThickness;
      const areaRatio = metalLossAreaMm2 / originalAreaMm2;
      if (!(areaRatio > 0)) continue;

      const z = normalizedLength(lengthMm, outerDiameter, wallThickness);
      const folias = foliasFactor(z, method);
      // The Original method's long branch drops the bulging term entirely, which
      // in the effective-area form leaves S_F = S_flow(1 − A/A₀).
      const denominator = folias === null ? 1 : 1 - areaRatio / folias;
      const numerator = 1 - areaRatio;
      if (!(denominator > 0) || !(numerator > 0)) continue;

      const failureStressMpa = (flow * numerator) / denominator;
      const failurePressureMpa = (2 * failureStressMpa * wallThickness) / outerDiameter;
      const safePressureMpa = failurePressureMpa / safetyFactor;
      if (!Number.isFinite(failurePressureMpa) || failurePressureMpa <= 0) continue;

      const candidate: EffectiveAreaCandidate = {
        startIndex: start,
        endIndex: end,
        startMm: profile[start].positionMm,
        endMm: profile[end].positionMm,
        lengthMm,
        metalLossAreaMm2,
        originalAreaMm2,
        z,
        foliasFactor: folias,
        failureStressMpa,
        failurePressureMpa,
        safePressureMpa,
        erf: safePressureMpa > 0 ? operatingPressureMpa / safePressureMpa : Number.POSITIVE_INFINITY,
      };

      candidates.push(candidate);
      if (!governing || candidate.failurePressureMpa < governing.failurePressureMpa) {
        governing = candidate;
      }
    }
  }

  if (!governing) {
    return {
      ...empty,
      iterations,
      profileLengthMm: profile[profile.length - 1].positionMm - profile[0].positionMm,
      invalidReason: 'No sub-length of this profile retains any remaining strength.',
    };
  }

  candidates.sort((a, b) => a.failurePressureMpa - b.failurePressureMpa);

  return {
    governing,
    candidates: candidates.slice(0, keepCandidates),
    iterations,
    profileLengthMm: profile[profile.length - 1].positionMm - profile[0].positionMm,
    maxDepthRatio: maxBy(profile, (point) => point.depthMm) / wallThickness,
    valid: true,
    invalidReason: null,
  };
}

/**
 * A river-bottom profile assembled from ILI metal-loss boxes.
 *
 * This is the profile data Synapse actually holds. An ILI tally does not carry
 * a measured corrosion profile — it carries one maximum depth and one axial
 * extent per feature — so a single feature can never support a Level 2
 * evaluation. A *colony* can: several boxes with sound metal between them are a
 * profile, and it is precisely the colony case where Level 1 is most
 * conservative, because merging the boxes counts that sound metal as gone.
 *
 * Each box becomes a rectangle at its reported depth. That is the honest
 * reading of a box: the vendor states a maximum depth over an extent and says
 * nothing about the shape inside it, so anything smoother would be invented.
 */

/** Half-width of the vertical step at a box edge, in mm. */
const EDGE_EPSILON_MM = 1e-3;
/** Sound-metal run added at each end so the profile starts at full wall. */
const PROFILE_PAD_MM = 1;

export interface IliColonyProfile {
  profile: EffectiveAreaProfilePoint[];
  /** Axial origin in metres, so a candidate can be mapped back to a log distance. */
  originM: number;
  wallThicknessMm: number;
  /** Boxes that contributed, in axial order. */
  members: FfsScreenedResult[];
}

function axialCentreMm(item: FfsScreenedResult): number {
  const distance = Number(item.nominal.ld);
  return Number.isFinite(distance) ? distance * 1000 : Number.NaN;
}

/**
 * Builds the profile for a group of features sharing one wall thickness.
 *
 * Returns null where a profile would be a fiction: a single box carries no
 * information Level 1 does not already have, and boxes on different wall
 * thicknesses do not lie on one profile.
 */
export function buildIliColonyProfile(items: FfsScreenedResult[]): IliColonyProfile | null {
  if (items.length < 2) return null;

  const wallThicknessMm = items[0].nominal.wall;
  if (!(wallThicknessMm > 0)) return null;
  if (items.some((item) => Math.abs(item.nominal.wall - wallThicknessMm) > 1e-6)) return null;

  const boxes = items
    .map((item) => {
      const centre = axialCentreMm(item);
      const half = item.nominal.length / 2;
      return {
        item,
        startMm: centre - half,
        endMm: centre + half,
        depthMm: (item.nominal.maxDepthPct / 100) * wallThicknessMm,
      };
    })
    .filter((box) => Number.isFinite(box.startMm) && box.endMm > box.startMm && box.depthMm > 0)
    .sort((a, b) => a.startMm - b.startMm);

  if (boxes.length < 2) return null;

  // Overlapping boxes are resolved by taking the deeper one across the overlap,
  // which is what the deepest-path reading of a river-bottom profile means.
  const breakpoints = [...new Set(boxes.flatMap((box) => [box.startMm, box.endMm]))]
    .sort((a, b) => a - b);

  const originMm = breakpoints[0] - PROFILE_PAD_MM;
  const profile: EffectiveAreaProfilePoint[] = [{ positionMm: 0, depthMm: 0 }];

  for (let i = 0; i < breakpoints.length - 1; i++) {
    const from = breakpoints[i];
    const to = breakpoints[i + 1];
    if (to - from <= 4 * EDGE_EPSILON_MM) continue;
    const depthMm = boxes.reduce(
      (deepest, box) => (box.startMm <= from && box.endMm >= to ? Math.max(deepest, box.depthMm) : deepest),
      0,
    );
    // A vertical step needs two stations at almost the same place; the
    // trapezoid across that sliver is negligible, and the interior of each
    // interval then integrates as the rectangle the ILI box actually is.
    profile.push({ positionMm: from - originMm + EDGE_EPSILON_MM, depthMm });
    profile.push({ positionMm: to - originMm - EDGE_EPSILON_MM, depthMm });
  }

  const lastBreak = breakpoints[breakpoints.length - 1];
  profile.push({ positionMm: lastBreak - originMm + PROFILE_PAD_MM, depthMm: 0 });

  if (profile.length < 3) return null;

  return {
    profile,
    originM: originMm / 1000,
    wallThicknessMm,
    members: boxes.map((box) => box.item),
  };
}
