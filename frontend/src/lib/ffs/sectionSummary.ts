/**
 * Section-level roll-ups.
 *
 * An FFS report is read section by section long before it is read feature by
 * feature: an aerial span, a river crossing, and a riser corrode for different
 * reasons, are protected differently, and — once per-section design factors
 * exist — are assessed against different acceptance pressures. These are the
 * aggregates that make that comparison possible without scrolling a table of
 * several thousand rows.
 */

import { isInternal } from './statistics.ts';
import { lifeSortValue } from './lifeProjection.ts';
import type { FfsDesignFactorSource, FfsSafetyFactorSource, FfsScreenedResult } from './types.ts';

function sectionNameOf(item: FfsScreenedResult): string {
  const name = String(item.nominal.section ?? '').trim();
  return name && name !== '-' ? name : 'Unassigned';
}

function groupBySection(items: FfsScreenedResult[]): Map<string, FfsScreenedResult[]> {
  const grouped = new Map<string, FfsScreenedResult[]>();
  for (const item of items) {
    const name = sectionNameOf(item);
    const bucket = grouped.get(name);
    if (bucket) bucket.push(item);
    else grouped.set(name, [item]);
  }
  return grouped;
}

/** Maximum of a set, or null when the set is empty. */
function maxOrNull(values: number[]): number | null {
  return values.length ? Math.max(...values) : null;
}

export interface FfsSectionGrowthRow {
  section: string;
  featureCount: number;
  internalCount: number;
  externalCount: number;
  /** Highest depth CGR among internal features, in mm/year. */
  internalDepthRateMmPerYear: number | null;
  externalDepthRateMmPerYear: number | null;
  /** Highest axial length CGR, in mm/year. Null when none was established. */
  internalLengthRateMmPerYear: number | null;
  externalLengthRateMmPerYear: number | null;
  /** Features in this section whose length rate could not be established. */
  lengthRateUnavailableCount: number;
  /** Shortest remnant life in the section, and the feature that sets it. */
  shortestRemnantLifeYears: number | null;
  shortestRemnantLifeFeature: FfsScreenedResult | null;
  /** Deepest reported metal loss in the section, as % of wall. */
  maxDepthPct: number;
  /** Lowest calculated safe pressure in the section, in MPa. */
  minSafePressureMpa: number;
  /** Design factors in force. More than one means the section is not uniform. */
  designFactors: number[];
}

/**
 * Maximum growth per section, split internal and external.
 *
 * Reported as a maximum rather than a mean on purpose: the number is used to
 * decide whether a section's corrosion is being controlled, and averaging a
 * severe local rate against a long quiet stretch hides exactly the case the
 * reader is looking for.
 *
 * Length rates count only features where a rate was actually established. A
 * feature whose run pair gave no usable axial rate contributes to
 * `lengthRateUnavailableCount`, never to the maximum as a zero.
 */
export function buildSectionGrowthSummary(items: FfsScreenedResult[]): FfsSectionGrowthRow[] {
  const rows: FfsSectionGrowthRow[] = [];

  for (const [section, members] of groupBySection(items)) {
    const internal = members.filter(isInternal);
    const external = members.filter((item) => !isInternal(item));

    const depthRates = (group: FfsScreenedResult[]) =>
      group.map((item) => item.nominal.crDepth).filter((rate) => Number.isFinite(rate) && rate > 0);
    const lengthRates = (group: FfsScreenedResult[]) =>
      group
        .filter((item) => !item.nominal.remnantLife.lengthHeldConstant)
        .map((item) => item.nominal.remnantLife.lengthRateMmPerYear)
        .filter((rate) => Number.isFinite(rate) && rate > 0);

    const withLife = members
      .filter((item) => item.nominal.remnantLife.status === 'calculated')
      .sort((a, b) =>
        lifeSortValue(a.nominal.remnantLife.years) - lifeSortValue(b.nominal.remnantLife.years));

    rows.push({
      section,
      featureCount: members.length,
      internalCount: internal.length,
      externalCount: external.length,
      internalDepthRateMmPerYear: maxOrNull(depthRates(internal)),
      externalDepthRateMmPerYear: maxOrNull(depthRates(external)),
      internalLengthRateMmPerYear: maxOrNull(lengthRates(internal)),
      externalLengthRateMmPerYear: maxOrNull(lengthRates(external)),
      lengthRateUnavailableCount: members.filter(
        (item) => item.nominal.remnantLife.lengthHeldConstant,
      ).length,
      shortestRemnantLifeYears: withLife[0]?.nominal.remnantLife.years ?? null,
      shortestRemnantLifeFeature: withLife[0] ?? null,
      maxDepthPct: Math.max(...members.map((item) => item.nominal.maxDepthPct)),
      minSafePressureMpa: Math.min(...members.map((item) => item.nominal.safePressure)),
      designFactors: [...new Set(members.map((item) => item.nominal.df))].sort((a, b) => a - b),
    });
  }

  return rows.sort((a, b) => a.section.localeCompare(b.section));
}

export interface FfsSectionDesignFactorRow {
  section: string;
  designFactor: number;
  source: FfsDesignFactorSource;
  /** The divisor actually applied to the failure pressure in this section. */
  safetyFactor: number;
  safetyFactorSource: FfsSafetyFactorSource;
  featureCount: number;
  startLd: number;
  endLd: number;
}

/**
 * The design factor each section was actually assessed with, read back off the
 * results rather than off the form. A section that somehow carries two factors
 * is emitted as two rows, because silently showing one of them would hide a
 * misconfigured override.
 */
export function buildSectionDesignFactorSummary(
  items: FfsScreenedResult[],
): FfsSectionDesignFactorRow[] {
  const grouped = new Map<string, FfsScreenedResult[]>();
  for (const item of items) {
    const key = `${sectionNameOf(item)}|${item.nominal.df}|${item.nominal.safetyFactor}`;
    const bucket = grouped.get(key);
    if (bucket) bucket.push(item);
    else grouped.set(key, [item]);
  }

  return [...grouped.values()]
    .map((members) => {
      const distances = members
        .map((item) => Number(item.nominal.ld))
        .filter((value) => Number.isFinite(value));
      return {
        section: sectionNameOf(members[0]),
        designFactor: members[0].nominal.df,
        source: members[0].nominal.designFactorSource,
        safetyFactor: members[0].nominal.safetyFactor,
        safetyFactorSource: members[0].nominal.safetyFactorSource,
        featureCount: members.length,
        startLd: distances.length ? Math.min(...distances) : 0,
        endLd: distances.length ? Math.max(...distances) : 0,
      };
    })
    .sort((a, b) => a.startLd - b.startLd || a.section.localeCompare(b.section));
}
