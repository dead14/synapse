/**
 * Level 1 versus Level 2 for a colony of ILI boxes.
 *
 * When several metal-loss areas interact, ASME B31G para. 1.12(a) says they are
 * to be evaluated as a single combined flaw. At Level 1 that means the deepest
 * depth over the whole colony extent — the sound metal between the pits is
 * counted as gone, because Level 1 has no way to describe it. The standard's own
 * Appendix A Example 2 shows what that costs: two pits that each pass on their
 * own fail once merged.
 *
 * Level 2 is the way out, and a colony is the one case where an ILI tally can
 * feed it: several boxes with sound metal between them *are* a profile. This
 * module pairs the two so the engineer can see what the merge is costing before
 * deciding whether it justifies an excavation.
 *
 * A Level 2 result is only offered where it is honest to do so — see
 * `buildIliColonyProfile` for the cases that are refused.
 */

import { evaluateB31g, type B31gGeometry } from './b31g.ts';
import {
  buildIliColonyProfile,
  evaluateEffectiveArea,
  type EffectiveAreaResult,
} from './effectiveArea.ts';
import { buildLocationZones } from './screening.ts';
import type { FfsConfig, FfsScreenedResult, FfsScreeningConfig } from './types.ts';
import { maxBy } from '../../utils/numericRange.ts';

export interface FfsColonyAssessment {
  id: string;
  members: FfsScreenedResult[];
  startLd: number;
  endLd: number;
  /** Combined extent Level 1 has to assume, in mm. */
  mergedLengthMm: number;
  /** Deepest member, as % of wall. */
  maxDepthPct: number;
  /** Level 1 on the merged flaw: deepest depth over the whole extent. */
  level1SafePressureMpa: number;
  level1Erf: number;
  /** Level 2 over the assembled profile. */
  level2: EffectiveAreaResult;
  level2SafePressureMpa: number | null;
  level2Erf: number | null;
  /**
   * Safe pressure recovered by describing the profile instead of merging, in
   * MPa. Positive means Level 1 was the conservative one, which is the usual
   * case but not guaranteed: Level 1's shape factor assumes a rounded pit, and
   * a colony of square-shouldered boxes can genuinely be worse than that.
   */
  recoveredSafePressureMpa: number | null;
  /** True when the merge fails the criterion but the profile does not. */
  changesDisposition: boolean;
}

function numericLd(item: FfsScreenedResult): number {
  const value = Number(item.nominal.ld);
  return Number.isFinite(value) ? value : 0;
}

function geometryOf(item: FfsScreenedResult): B31gGeometry {
  return {
    wallThickness: item.nominal.wall,
    outerDiameter: item.nominal.od,
    smysMpa: item.nominal.smys,
    safetyFactor: item.nominal.safetyFactor,
    operatingPressureMpa: item.nominal.p0,
  };
}

/**
 * Evaluates every location zone that holds more than one feature.
 *
 * Zones are the existing spatial grouping. They are a coarser screen than the
 * 3t interaction rule, which is deliberate here: the question this answers is
 * "would describing the profile change the answer", and that is worth asking
 * wherever boxes sit close enough to have been merged by anyone's rule.
 */
export function buildColonyLevel2Assessments(
  items: FfsScreenedResult[],
  screening: FfsScreeningConfig,
  config: FfsConfig,
  limit = 20,
): FfsColonyAssessment[] {
  const assessments: FfsColonyAssessment[] = [];

  for (const zone of buildLocationZones(items)) {
    const built = buildIliColonyProfile(zone.members);
    if (!built) continue;

    const geometry = geometryOf(zone.members[0]);
    // Every member must share the line geometry, or the two levels would be
    // comparing different pipes rather than different methods.
    const uniform = zone.members.every((member) =>
      member.nominal.od === geometry.outerDiameter &&
      member.nominal.smys === geometry.smysMpa &&
      member.nominal.safetyFactor === geometry.safetyFactor &&
      member.nominal.p0 === geometry.operatingPressureMpa);
    if (!uniform) continue;

    const mergedLengthMm = built.profile[built.profile.length - 1].positionMm - built.profile[0].positionMm;
    const maxDepthPct = maxBy(zone.members, (member) => member.nominal.maxDepthPct);
    const merged = evaluateB31g(
      (maxDepthPct / 100) * geometry.wallThickness,
      mergedLengthMm,
      geometry,
      config.method,
      config.modifiedSa,
    );

    const level2 = evaluateEffectiveArea(built.profile, geometry, config.method, config.modifiedSa);
    const level2SafePressureMpa = level2.governing?.safePressureMpa ?? null;
    const level2Erf = level2.governing?.erf ?? null;

    assessments.push({
      id: zone.id,
      members: built.members,
      startLd: numericLd(zone.members[0]),
      endLd: numericLd(zone.members[zone.members.length - 1]),
      mergedLengthMm,
      maxDepthPct,
      level1SafePressureMpa: merged.safePressureMpa,
      level1Erf: merged.erf,
      level2,
      level2SafePressureMpa,
      level2Erf,
      recoveredSafePressureMpa: level2SafePressureMpa === null
        ? null
        : level2SafePressureMpa - merged.safePressureMpa,
      changesDisposition:
        level2Erf !== null && merged.erf >= screening.reviewBandErf && level2Erf < screening.reviewBandErf,
    });
  }

  // The colonies worth an engineer's attention are the ones where the merge is
  // expensive, so rank by how much the profile recovers.
  return assessments
    .sort((a, b) => (b.recoveredSafePressureMpa ?? -Infinity) - (a.recoveredSafePressureMpa ?? -Infinity))
    .slice(0, limit);
}
