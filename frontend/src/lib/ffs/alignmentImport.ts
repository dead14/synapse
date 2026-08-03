import type { ComparisonRow } from '../../utils/alignment.ts';

export interface AlignmentEngineeringInputs {
  outerDiameterMm: number;
  smysMpa: number;
  designFactor: number;
  operatingPressureMpa: number;
  fallbackDepthGrowthMmPerYear: number;
  fallbackLengthGrowthMmPerYear: number;
}

export interface AlignmentImportProvenance {
  alignmentSessionId: string;
  sourceFeatureKey: string;
  featureId: string;
  /** Engineer's note from the Corrosion Analysis review, when one was given. */
  selectionReason: string | null;
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
  if (pressure === null || pressure <= 0) reasons.push('Operating pressure must be greater than 0 MPa.');
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
    ['Operating pressure', inputs.operatingPressureMpa],
  ] as const;
  for (const [label, value] of positive) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`${label} must be greater than zero.`);
    }
  }
  if (inputs.designFactor > 1) throw new Error('Design factor must not exceed 1.');
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
    if (distance < 0 || depth < 0 || depth > 80 || length <= 0 || width <= 0 || wall <= 0) {
      rejected.push({ featureId, reason: 'Measured NEW-run values are outside the supported FFS domain.' });
      continue;
    }

    const warnings: string[] = [];
    const depthGrowthPct = finiteNumber(source['Depth Growth (%WT/yr)']);
    const lengthGrowth = finiteNumber(source['Length Growth (mm/yr)']);
    const depthGrowthMm = depthGrowthPct !== null && depthGrowthPct >= 0
      ? (depthGrowthPct / 100) * wall
      : engineering.fallbackDepthGrowthMmPerYear;
    const lengthGrowthMm = lengthGrowth !== null && lengthGrowth >= 0
      ? lengthGrowth
      : engineering.fallbackLengthGrowthMmPerYear;
    if (depthGrowthPct === null || depthGrowthPct < 0) {
      warnings.push('Depth growth unavailable; explicit fallback rate was used.');
    }
    if (lengthGrowth === null || lengthGrowth < 0) {
      warnings.push('Length growth unavailable; explicit fallback rate was used.');
    }

    accepted.push({
      row: {
        'Feature ID': featureId,
        'LD [m]': numericText(distance),
        Section: text(source['Section NEW'], text(source.Section)),
        Surface: text(source['Surface NEW']),
        'Max Depth [%]': numericText(depth),
        'Length [mm]': numericText(length),
        'Width [mm]': numericText(width),
        'Orient. (hrs:mins)': text(source["O'Clock NEW"]),
        'Nominal Wall Thickness [mm]': numericText(wall),
        'CR Depth [mm/y]': numericText(depthGrowthMm),
        'CR Length [mm/y]': numericText(lengthGrowthMm),
        'Design Factor': numericText(engineering.designFactor),
        'Outer Diameter Ds': numericText(engineering.outerDiameterMm),
        'SMYS [MPa]': numericText(engineering.smysMpa),
        'Operating Pressure P₀ [MPa]': numericText(engineering.operatingPressureMpa),
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
        selectionReason: selection.reasons?.[sourceFeatureKey]?.trim() || null,
      },
      warnings,
    });
  }

  return { accepted, rejected };
}
