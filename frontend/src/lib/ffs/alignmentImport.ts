import type { ComparisonRow } from '../../utils/alignment.ts';
import { isClusteredAlignmentRow } from '../../utils/alignmentDisplay.ts';
import type {
  FfsDesignFactorSource,
  FfsGrowthComponentEvidence,
  FfsGrowthEvidence,
  FfsGrowthObservation,
  FfsSectionDesignFactor,
} from './types.ts';

export interface AlignmentEngineeringInputs {
  outerDiameterMm: number;
  smysMpa: number;
  /** Applied to any section without its own override. */
  designFactor: number;
  /** Per-section overrides, keyed by the section name the alignment emitted. */
  sectionDesignFactors?: FfsSectionDesignFactor[];
  /**
   * The ratio B31G para. 1.9 asks for — minimum hydrostatic test pressure over
   * MAOP or MOP. Null means derive it from the design factor as 1/F, which is
   * the historic practice and correct only at the design hoop stress.
   */
  safetyFactor?: number | null;
  operatingPressureMpa: number;
  fallbackDepthGrowthMmPerYear: number;
  fallbackLengthGrowthMmPerYear: number;
}

/**
 * Resolves the design factor for one feature.
 *
 * A line is not uniform: line pipe at 0.72 with a river crossing or riser at
 * 0.60 is the ordinary case. Matching is on the reviewed section name and is
 * case- and whitespace-insensitive, because the same crossing is written
 * "RC#86" in one run and "RC #86" in another often enough to matter.
 */
export function resolveDesignFactor(
  section: string,
  engineering: AlignmentEngineeringInputs,
): { designFactor: number; source: FfsDesignFactorSource } {
  const key = normalizedSectionKey(section);
  const override = key
    ? engineering.sectionDesignFactors?.find((rule) => normalizedSectionKey(rule.section) === key)
    : undefined;
  if (override && Number.isFinite(override.designFactor) && override.designFactor > 0) {
    return { designFactor: override.designFactor, source: 'section-override' };
  }
  return { designFactor: engineering.designFactor, source: 'line-default' };
}

export function normalizedSectionKey(section: string): string {
  return String(section ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

export interface AlignmentImportProvenance {
  alignmentSessionId: string;
  sourceFeatureKey: string;
  featureId: string;
  growthEvidence: FfsGrowthEvidence;
  /** Engineer's note from the Corrosion Analysis review, when one was given. */
  selectionReason: string | null;
  /** The section this feature was assessed under, and the factor it received. */
  section: string;
  designFactor: number;
  designFactorSource: FfsDesignFactorSource;
  isClusteredMetalLoss: boolean;
}

/**
 * The Corrosion Analysis outcome. FFS is not allowed to widen this: a feature
 * that is not in `selectedKeys` was not released by an engineer and must not be
 * assessed. See docs/specs/ffs-alignment-gated-intake.md.
 */
export interface AlignmentSelection {
  selectedKeys: Set<string>;
  reasons?: Record<string, string>;
}

export interface AcceptedAlignmentRow {
  row: Record<string, string>;
  provenance: AlignmentImportProvenance;
  warnings: string[];
}

export interface RejectedAlignmentRow {
  featureId: string;
  reason: string;
}

export interface AlignmentImportResult {
  accepted: AcceptedAlignmentRow[];
  rejected: RejectedAlignmentRow[];
}

export interface AlignmentImportReadinessInput {
  lineName: string;
  iliDate: string;
  selectedRunId: string;
  alignmentRowCount: number;
  /** Features released by the Corrosion Analysis review for this session. */
  selectedFeatureCount: number;
  outerDiameterMm: string;
  smysMpa: string;
  designFactor: string;
  operatingPressureMpa: string;
  fallbackDepthGrowthMmPerYear: string;
  fallbackLengthGrowthMmPerYear: string;
}

function present(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  const normalized = String(value).trim();
  return normalized !== '' && normalized !== '-';
}

function finiteNumber(value: unknown): number | null {
  if (!present(value)) return null;
  const parsed = Number(String(value).trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value: unknown, fallback = '-'): string {
  return present(value) ? String(value).trim() : fallback;
}

function numericText(value: number): string {
  return Number(value.toFixed(6)).toString();
}

function roundedRate(value: number): number {
  return Number(value.toFixed(6));
}

function surveyYear(value: unknown): number | null {
  const parsed = finiteNumber(value);
  if (parsed === null || !Number.isInteger(parsed) || parsed < 1900 || parsed > 2100) return null;
  return parsed;
}

function unavailableComponent(
  observation: Extract<FfsGrowthObservation, 'unavailable' | 'apparent-decrease'>,
  rawRateMmPerYear: number | null,
  fallbackRateMmPerYear: number,
  formula: string | null,
  unavailableNote: string,
): FfsGrowthComponentEvidence {
  if (fallbackRateMmPerYear > 0) {
    return {
      observation,
      analysisBasis: 'explicit-fallback',
      rawRateMmPerYear,
      analysisRateMmPerYear: roundedRate(fallbackRateMmPerYear),
      formula,
      note: `${unavailableNote} Projection uses the engineer-entered fallback rate.`,
    };
  }
  return {
    observation,
    analysisBasis: 'none',
    rawRateMmPerYear,
    analysisRateMmPerYear: null,
    formula,
    note: unavailableNote,
  };
}

function deriveGrowthEvidence(
  source: ComparisonRow,
  depthPct: number,
  wallMm: number,
  engineering: AlignmentEngineeringInputs,
  warnings: string[],
): FfsGrowthEvidence {
  const oldSurveyYear = surveyYear(source['Run Year OLD']);
  const newSurveyYear = surveyYear(source['Run Year NEW']);
  const intervalYears = oldSurveyYear !== null && newSurveyYear !== null && newSurveyYear > oldSurveyYear
    ? newSurveyYear - oldSurveyYear
    : null;
  const reportedDepthPctPerYear = finiteNumber(source['Depth Growth (%WT/yr)']);
  const reportedLengthMmPerYear = finiteNumber(source['Length Growth (mm/yr)']);
  const matchStatus = text(source['Match/Unmatch'], '').toLowerCase();
  const markedMatched = matchStatus === 'matched' || matchStatus === 'match';
  const hasOldFeature = present(source['Source Key OLD']) ||
    present(source['Identif. OLD']) ||
    present(source['Depth OLD (%WT)']);
  const isNewOnly = !hasOldFeature && !markedMatched;

  let depth: FfsGrowthComponentEvidence;
  if (isNewOnly && intervalYears !== null) {
    const rate = roundedRate(((depthPct / 100) * wallMm) / intervalYears);
    depth = {
      observation: 'new-only-zero-baseline-estimate',
      analysisBasis: 'estimated',
      rawRateMmPerYear: null,
      analysisRateMmPerYear: rate,
      formula: `(${depthPct} / 100 x ${wallMm} mm - 0 mm) / (${newSurveyYear} - ${oldSurveyYear}) y`,
      note: 'Estimated from an assumed zero-depth baseline at the OLD survey; not a measured run-pair CGR.',
    };
    warnings.push('NEW-only depth growth uses a disclosed zero-depth baseline estimate; it is not a measured run-pair CGR.');
  } else if (isNewOnly) {
    depth = unavailableComponent(
      'unavailable',
      null,
      engineering.fallbackDepthGrowthMmPerYear,
      null,
      'NEW-only depth CGR cannot be estimated because a valid OLD-to-NEW survey interval is unavailable.',
    );
    warnings.push(
      engineering.fallbackDepthGrowthMmPerYear > 0
        ? 'Depth growth unavailable; explicit fallback rate was used.'
        : 'Depth growth unavailable; projection cannot be calculated.',
    );
  } else if (reportedDepthPctPerYear !== null && reportedDepthPctPerYear >= 0) {
    const rate = roundedRate((reportedDepthPctPerYear / 100) * wallMm);
    depth = {
      observation: 'matched-measured',
      analysisBasis: 'reported',
      rawRateMmPerYear: rate,
      analysisRateMmPerYear: rate,
      formula: `${reportedDepthPctPerYear} %WT/y x ${wallMm} mm / 100`,
      note: 'Run-pair depth growth reported by the alignment engine.',
    };
  } else if (reportedDepthPctPerYear !== null) {
    const rawRate = roundedRate((reportedDepthPctPerYear / 100) * wallMm);
    depth = unavailableComponent(
      'apparent-decrease',
      rawRate,
      engineering.fallbackDepthGrowthMmPerYear,
      `${reportedDepthPctPerYear} %WT/y x ${wallMm} mm / 100`,
      'The matched run pair reports an apparent depth decrease; review sizing uncertainty before assigning a projection rate.',
    );
    warnings.push(
      engineering.fallbackDepthGrowthMmPerYear > 0
        ? 'Matched data reports an apparent depth decrease; explicit fallback depth growth was used for projection.'
        : 'Matched data reports an apparent depth decrease; depth projection cannot be calculated.',
    );
  } else {
    depth = unavailableComponent(
      'unavailable',
      null,
      engineering.fallbackDepthGrowthMmPerYear,
      null,
      'The matched run-pair CGR is unavailable; a zero-depth baseline is not applicable to a matched feature.',
    );
    warnings.push(
      engineering.fallbackDepthGrowthMmPerYear > 0
        ? 'Depth growth unavailable; explicit fallback rate was used.'
        : 'Depth growth unavailable; projection cannot be calculated.',
    );
  }

  let length: FfsGrowthComponentEvidence;
  if (!isNewOnly && reportedLengthMmPerYear !== null && reportedLengthMmPerYear >= 0) {
    const rate = roundedRate(reportedLengthMmPerYear);
    length = {
      observation: 'matched-measured',
      analysisBasis: 'reported',
      rawRateMmPerYear: rate,
      analysisRateMmPerYear: rate,
      formula: null,
      note: 'Run-pair length growth reported by the alignment engine.',
    };
  } else {
    const observation = !isNewOnly && reportedLengthMmPerYear !== null ? 'apparent-decrease' : 'unavailable';
    const rawRate = isNewOnly || reportedLengthMmPerYear === null ? null : roundedRate(reportedLengthMmPerYear);
    const note = isNewOnly
      ? 'NEW-only length growth is unavailable; no zero-baseline length estimate is applied.'
      : reportedLengthMmPerYear !== null
      ? 'The matched run pair reports an apparent length decrease; review feature association and sizing uncertainty.'
      : 'Length growth is unavailable; no zero-baseline length estimate is applied.';
    length = unavailableComponent(
      observation,
      rawRate,
      engineering.fallbackLengthGrowthMmPerYear,
      null,
      note,
    );
    warnings.push(
      engineering.fallbackLengthGrowthMmPerYear > 0
        ? 'Length growth unavailable; explicit fallback rate was used.'
        : 'Length growth unavailable; length projection cannot be calculated.',
    );
  }

  return { oldSurveyYear, newSurveyYear, intervalYears, depth, length };
}

export interface AlignmentSectionOption {
  /** Section name exactly as the alignment emitted it. */
  section: string;
  /** Released features falling in this section. */
  featureCount: number;
  startLd: number;
  endLd: number;
}

/**
 * The sections an engineer can assign a design factor to.
 *
 * Derived from the released features themselves rather than from the session's
 * section definitions, so the list is exactly the stretches that will appear in
 * the assessment — a section holding nothing released is not something anyone
 * needs to enter a factor for.
 */
export function alignmentSectionOptions(
  comparison: ComparisonRow[],
  selection: AlignmentSelection,
): AlignmentSectionOption[] {
  const grouped = new Map<string, { section: string; featureCount: number; distances: number[] }>();

  for (const source of comparison) {
    const sourceFeatureKey = text(source['Source Key NEW'], '');
    if (!sourceFeatureKey || !selection.selectedKeys.has(sourceFeatureKey)) continue;
    const section = text(source['Section NEW'], text(source.Section));
    const key = normalizedSectionKey(section);
    const distance = finiteNumber(source['Log Dist NEW (m)']);
    let entry = grouped.get(key);
    if (!entry) {
      entry = { section, featureCount: 0, distances: [] };
      grouped.set(key, entry);
    }
    entry.featureCount += 1;
    if (distance !== null) entry.distances.push(distance);
  }

  return [...grouped.values()]
    .map(({ section, featureCount, distances }) => ({
      section,
      featureCount,
      startLd: distances.length ? Math.min(...distances) : 0,
      endLd: distances.length ? Math.max(...distances) : 0,
    }))
    .sort((a, b) => a.startLd - b.startLd || a.section.localeCompare(b.section));
}

function strictNumber(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getAlignmentImportReadiness(input: AlignmentImportReadinessInput): string[] {
  const reasons: string[] = [];
  if (!input.lineName.trim()) reasons.push('Enter the pipeline / line name.');
  if (!input.iliDate) reasons.push('Select the ILI inspection date.');
  if (!input.selectedRunId) reasons.push('Select a completed alignment session.');
  else if (input.alignmentRowCount === 0) reasons.push('Load the selected alignment result first.');
  else if (input.selectedFeatureCount === 0) {
    reasons.push('Release at least one feature in Corrosion Analysis for this session.');
  }

  const od = strictNumber(input.outerDiameterMm);
  if (od === null || od < 50) reasons.push('Outer diameter must be at least 50 mm.');
  const smys = strictNumber(input.smysMpa);
  if (smys === null || smys <= 0) reasons.push('SMYS must be greater than 0 MPa.');
  const factor = strictNumber(input.designFactor);
  if (factor === null || factor <= 0 || factor > 1) {
    reasons.push('Design factor must be a number greater than 0 and not more than 1 (example: 0.72).');
  }
  const pressure = strictNumber(input.operatingPressureMpa);
  if (pressure === null || pressure <= 0) reasons.push('Required assessment pressure must be greater than 0 MPa.');
  for (const [label, value] of [
    ['Fallback depth growth', input.fallbackDepthGrowthMmPerYear],
    ['Fallback length growth', input.fallbackLengthGrowthMmPerYear],
  ] as const) {
    const parsed = strictNumber(value);
    if (parsed === null || parsed < 0) reasons.push(`${label} must be zero or greater.`);
  }
  return reasons;
}

function assertEngineeringInputs(inputs: AlignmentEngineeringInputs): void {
  const positive = [
    ['Outer diameter', inputs.outerDiameterMm],
    ['SMYS', inputs.smysMpa],
    ['Design factor', inputs.designFactor],
    ['Required assessment pressure', inputs.operatingPressureMpa],
  ] as const;
  for (const [label, value] of positive) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`${label} must be greater than zero.`);
    }
  }
  if (inputs.designFactor > 1) throw new Error('Design factor must not exceed 1.');
  if (inputs.safetyFactor !== null && inputs.safetyFactor !== undefined) {
    if (!Number.isFinite(inputs.safetyFactor) || inputs.safetyFactor <= 0) {
      throw new Error('Safety factor must be greater than zero.');
    }
  }
  for (const rule of inputs.sectionDesignFactors ?? []) {
    if (!Number.isFinite(rule.designFactor) || rule.designFactor <= 0 || rule.designFactor > 1) {
      throw new Error(
        `Design factor for section "${rule.section}" must be greater than 0 and not more than 1.`,
      );
    }
  }
  for (const [label, value] of [
    ['Fallback depth growth', inputs.fallbackDepthGrowthMmPerYear],
    ['Fallback length growth', inputs.fallbackLengthGrowthMmPerYear],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${label} must be zero or greater.`);
    }
  }
}

export function mapAlignmentRowsToFfs(
  comparison: ComparisonRow[],
  engineering: AlignmentEngineeringInputs,
  alignmentSessionId: string,
  selection: AlignmentSelection,
): AlignmentImportResult {
  assertEngineeringInputs(engineering);
  if (!selection || !(selection.selectedKeys instanceof Set)) {
    throw new Error('A saved Corrosion Analysis selection is required before an FFS assessment.');
  }

  const accepted: AcceptedAlignmentRow[] = [];
  const rejected: RejectedAlignmentRow[] = [];

  for (const source of comparison) {
    const sourceFeatureKey = text(source['Source Key NEW'], '');
    const featureId = text(source['Identif. NEW'], text(source['Feature ID NEW'], sourceFeatureKey || 'Unknown'));
    if (!sourceFeatureKey) {
      rejected.push({ featureId, reason: 'Row does not contain a NEW-run feature.' });
      continue;
    }
    if (!selection.selectedKeys.has(sourceFeatureKey)) {
      rejected.push({ featureId, reason: 'Not selected in Corrosion Analysis.' });
      continue;
    }

    const required = [
      ['Log Dist NEW (m)', finiteNumber(source['Log Dist NEW (m)'])],
      ['Depth NEW (%WT)', finiteNumber(source['Depth NEW (%WT)'])],
      ['Length NEW (mm)', finiteNumber(source['Length NEW (mm)'])],
      ['Width NEW (mm)', finiteNumber(source['Width NEW (mm)'])],
      ['Wall WT NEW (mm)', finiteNumber(source['Wall WT NEW (mm)'])],
    ] as const;
    const missing = required.filter(([, value]) => value === null).map(([label]) => label);
    if (missing.length > 0) {
      rejected.push({ featureId, reason: `Missing or invalid measured field(s): ${missing.join(', ')}.` });
      continue;
    }

    const distance = required[0][1] as number;
    const depth = required[1][1] as number;
    const length = required[2][1] as number;
    const width = required[3][1] as number;
    const wall = required[4][1] as number;
    // Depth is bounded by the wall, not by the 80 %WT project rejection line.
    // Rejecting deep features here removed the ones most likely to govern the
    // assessment before it ever ran; they are carried through and disclosed
    // instead. See the same note in `validation.ts`.
    if (distance < 0 || depth < 0 || depth > 100 || length <= 0 || width <= 0 || wall <= 0) {
      rejected.push({ featureId, reason: 'Measured NEW-run values are outside the supported FFS domain.' });
      continue;
    }

    const warnings: string[] = [];
    // Carried rather than dropped, but never carried quietly: past 80 %WT the
    // section 3 tables no longer apply and para. 1.2(f) asks for the sizing
    // accuracy and the effective corrosion rate to be justified.
    if (depth > 80) {
      warnings.push(
        `Reported at ${depth.toFixed(1)} %WT, past the 80 %WT project rejection line: assessed and reported, but the sizing accuracy and the effective corrosion rate must be justified before the result is relied on.`,
      );
    }
    const growthEvidence = deriveGrowthEvidence(source, depth, wall, engineering, warnings);
    const depthGrowthMm = growthEvidence.depth.analysisRateMmPerYear ?? 0;
    // The column has to carry a finite number for the calculation contract, but
    // the evidence record is what downstream consumers read to decide whether
    // this zero is a measurement or the absence of one.
    const lengthGrowthMm = growthEvidence.length.analysisRateMmPerYear ?? 0;
    const section = text(source['Section NEW'], text(source.Section));
    const { designFactor, source: designFactorSource } = resolveDesignFactor(section, engineering);
    const explicitSafetyFactor = engineering.safetyFactor ?? null;
    // Same rule the alignment engine uses to keep merged groups out of matching,
    // so FFS labels exactly the rows the engine refused to pair.
    const isClusteredMetalLoss = isClusteredAlignmentRow(source);
    if (isClusteredMetalLoss) {
      warnings.push(
        'Reported as clustered metal loss: assessed as one merged defect and carrying no run-pair growth rate.',
      );
    }

    accepted.push({
      row: {
        'Feature ID': featureId,
        'LD [m]': numericText(distance),
        Section: section,
        Surface: text(source['Surface NEW']),
        'Max Depth [%]': numericText(depth),
        'Length [mm]': numericText(length),
        'Width [mm]': numericText(width),
        'Orient. (hrs:mins)': text(source["O'Clock NEW"]),
        'Nominal Wall Thickness [mm]': numericText(wall),
        'CR Depth [mm/y]': numericText(depthGrowthMm),
        'CR Length [mm/y]': numericText(lengthGrowthMm),
        'Design Factor': numericText(designFactor),
        'Design Factor Source': designFactorSource,
        // Left blank when derived, so the engine records which of the two the
        // figure is rather than presenting a derived value as a measured ratio.
        'Safety Factor': explicitSafetyFactor === null ? '' : numericText(explicitSafetyFactor),
        'Outer Diameter Ds': numericText(engineering.outerDiameterMm),
        'SMYS [MPa]': numericText(engineering.smysMpa),
        'Operating Pressure P₀ [MPa]': numericText(engineering.operatingPressureMpa),
        'Clustered Metal Loss': isClusteredMetalLoss ? 'Yes' : 'No',
        'Repair Status': 'Unrepaired',
        'Repair Method': '',
        'Repair Date': '',
        'Repair Reference': '',
        Recommendation: '',
        'Action Owner': '',
      },
      provenance: {
        alignmentSessionId,
        sourceFeatureKey,
        featureId,
        growthEvidence,
        selectionReason: selection.reasons?.[sourceFeatureKey]?.trim() || null,
        section,
        designFactor,
        designFactorSource,
        isClusteredMetalLoss,
      },
      warnings,
    });
  }

  return { accepted, rejected };
}
