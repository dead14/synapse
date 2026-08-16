import type { ComparisonRow } from '../../utils/alignment.ts';
import { isClusteredAlignmentRow } from '../../utils/alignmentDisplay.ts';
import type {
  FfsDesignFactorSource,
  FfsGrowthComponentEvidence,
  FfsGrowthEvidence,
  FfsGrowthObservation,
  FfsSectionDesignFactor,
} from './types.ts';
import { maxOf, minOf } from '../../utils/numericRange.ts';

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
  /**
   * The line's nominal wall thickness, used only where the run reported none.
   *
   * Depth, length, width and position are measurements — absent, they cannot be
   * supplied from anywhere else. Wall thickness is a property of the pipe, and a
   * vendor that ships %WT depths without a wall column is common enough that
   * refusing the whole assessment over it withheld every released feature on the
   * line. Where it is used the feature says so, in its warnings and provenance.
   */
  nominalWallThicknessMm?: number | null;
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
  /** Where the wall thickness the assessment used came from. */
  wallThicknessSource: FfsWallThicknessSource;
}

export type FfsWallThicknessSource = 'run-reported' | 'line-nominal';

/**
 * How much of the run an assessment covers.
 *
 * `all` assesses every metal-loss anomaly the NEW run reported, matched to the
 * previous run or not. `released` assesses only what an engineer ticked in
 * Corrosion Analysis.
 *
 * `released` used to be the only option, and it was also the gate on reaching
 * the assessment at all — so an anomaly nobody had got round to reviewing was
 * absent from the FFS report with nothing to say it existed. Coverage is now a
 * stated scope rather than an accident of how far a review got, and either way
 * every anomaly the run reported is accounted for: assessed, or listed with the
 * reason it was not.
 */
export type FfsIntakeScope = 'all' | 'released';

/**
 * The Corrosion Analysis outcome, and the scope it is being used at.
 *
 * Under `released`, FFS is not allowed to widen the selection: a feature that is
 * not in `selectedKeys` was deliberately held back and must not be assessed.
 * See docs/specs/ffs-alignment-gated-intake.md.
 */
export interface AlignmentSelection {
  selectedKeys: Set<string>;
  reasons?: Record<string, string>;
  /** Defaults to `released`, which is how every existing caller behaved. */
  scope?: FfsIntakeScope;
}

/**
 * True when this row is a metal-loss anomaly of the NEW run — something an FFS
 * assessment is about at all.
 *
 * The same rule the spool census uses, so "every anomaly on the line" and
 * "every anomaly FFS considered" cannot mean two different populations. Girth
 * welds, fittings, dents, cracks and the OLD-only side of the comparison are
 * not metal loss and are not candidates; an excluded row is a decision that the
 * row is not real.
 */
export function isMetalLossCandidate(row: ComparisonRow): boolean {
  if (row.__excluded === true) return false;
  const group = text(row['Result Group'], '').toUpperCase();
  if (NON_ANOMALY_GROUPS.has(group)) return false;
  if (!text(row['Source Key NEW'], '')) return false;

  const type = text(row['Feature Type NEW'], '');
  const label = `${type} ${text(row['Feature Identification NEW'], '')}`;
  if (!NON_METAL_LOSS_PATTERN.test(label)) return true;

  // The exclusion pattern reads the free-text identification as well as the
  // classification, because some vendors put the feature type there and nowhere
  // else. That also means an ordinary corrosion feature labelled "corrosion at
  // bend 12" matches "bend" and would be thrown out of its own assessment. An
  // explicit metal-loss classification in the type column therefore wins —
  // unless the type column is itself the thing being excluded, which is how a
  // dent stays a dent.
  return METAL_LOSS_TYPE_PATTERN.test(type) && !NON_METAL_LOSS_PATTERN.test(type);
}

/**
 * Whether one row is in scope for this assessment.
 *
 * Under `all`, membership is a property of the row itself; under `released` it
 * is the reviewer's decision. Both still require the row to be metal loss on the
 * NEW run — releasing a girth weld to FFS would not make it assessable.
 */
function isInScope(row: ComparisonRow, selection: AlignmentSelection): boolean {
  if (!isMetalLossCandidate(row)) return false;
  if ((selection.scope ?? 'released') === 'all') return true;
  return selection.selectedKeys.has(text(row['Source Key NEW'], ''));
}

export interface AcceptedAlignmentRow {
  row: Record<string, string>;
  provenance: AlignmentImportProvenance;
  warnings: string[];
}

/**
 * One in-scope anomaly the assessment could not calculate, and why.
 *
 * It carries enough to find the feature on the line, because this list is how
 * the report accounts for an anomaly that has no B31G result: an anomaly that is
 * neither assessed nor listed here has simply vanished from the assessment.
 */
export interface RejectedAlignmentRow {
  featureId: string;
  sourceKey: string;
  ldM: number | null;
  depthPct: number | null;
  reason: string;
}

/** One girth weld of the NEW run, on the master odometer the FFS rows use. */
export interface FfsGirthWeld {
  id: string;
  ldM: number;
}

/**
 * One metal-loss record of the NEW run as the alignment reported it, whether or
 * not the Corrosion Analysis review released it for assessment.
 *
 * The FFS calculation only ever sees released features, and that is correct —
 * but the spool register is an inventory of the line, and a joint carrying nine
 * unreleased pits and one released one is not a joint with one defect on it.
 */
export interface FfsSpoolCensusRow {
  sourceKey: string;
  featureId: string;
  ldM: number;
  depthPct: number | null;
  lengthMm: number | null;
  widthMm: number | null;
  isCluster: boolean;
  /** True when this record went into the FFS assessment. */
  assessed: boolean;
}

/**
 * Rows the import never treated as candidates, counted rather than listed.
 *
 * A comparison result is not a list of assessment candidates: most of it is the
 * OLD run, the skeleton, and — under the released scope — features the review
 * deliberately held back. Those are not rejections, and reporting them as such
 * buried the handful of candidates that genuinely could not be assessed under
 * thousands of rows nobody ever asked to assess.
 */
export interface AlignmentImportSkipped {
  /** Rows carrying no NEW-run feature — the OLD side of the comparison. */
  noNewFeature: number;
  /** NEW-run features the Corrosion Analysis review did not release. */
  notReleased: number;
  /** NEW-run features that are not metal loss: welds, fittings, dents, cracks. */
  notMetalLoss: number;
  /** NEW-run metal loss a reviewer excluded from the released outputs. */
  excluded: number;
}

export interface AlignmentImportResult {
  accepted: AcceptedAlignmentRow[];
  /** Released features that could not be assessed, and why. */
  rejected: RejectedAlignmentRow[];
  skipped: AlignmentImportSkipped;
  /**
   * Every girth weld of the NEW run. A spool is the pipe between two of these,
   * which is the unit a repair is actually made to — and it is the only
   * grouping that does not depend on the vendor having filled in a joint-number
   * column. All of them are carried, not only the ones near a released feature:
   * the register lists the whole line, joint by joint.
   */
  girthWelds: FfsGirthWeld[];
  /** Every metal-loss record on the NEW run, released or not. */
  census: FfsSpoolCensusRow[];
}

const WELD_LABEL_PATTERN = /weld|girth|\bgw\b|seam/i;

/**
 * Girth welds of the NEW run, ascending and de-duplicated.
 *
 * NEW side only, on purpose. An OLD-only weld row does exist physically, but it
 * carries no position on the run the assessment was built from, and inserting
 * one would split a joint at a boundary none of the assessed features were
 * measured against.
 */
export function extractGirthWeldLadder(comparison: readonly ComparisonRow[]): FfsGirthWeld[] {
  const seen = new Map<number, FfsGirthWeld>();
  for (const row of comparison) {
    const group = text(row['Result Group'], '').toUpperCase();
    const isWeld = group === 'GW'
      || WELD_LABEL_PATTERN.test(text(row['Feature Type NEW'], ''))
      || WELD_LABEL_PATTERN.test(text(row['Feature Identification NEW'], ''));
    if (!isWeld) continue;
    const ldM = finiteNumber(row['Log Dist NEW (m)']);
    if (ldM === null) continue;
    // Two rows can report the same weld (a locked pair and a leftover sweep);
    // millimetre rounding keeps them one boundary rather than a zero-length spool.
    const key = Math.round(ldM * 1000);
    if (seen.has(key)) continue;
    seen.set(key, {
      id: text(row['Identif. NEW'], text(row['Feature ID NEW'], `GW ${ldM.toFixed(2)}`)),
      ldM,
    });
  }
  return [...seen.values()].sort((left, right) => left.ldM - right.ldM);
}

/** Groups the engine emits for things that are not anomalies. */
const NON_ANOMALY_GROUPS = new Set(['GW', 'FITTING']);

const NON_METAL_LOSS_PATTERN =
  /weld|girth|\bgw\b|seam|valve|\btee\b|off[\s_-]?take|branch|flang|bend|elbow|anode|support|\bmarker\b|casing|sleeve|clamp|launcher|receiver|reducer|\bcap\b|dent|deform|ovality|buckle|wrinkle|crack|lamination/i;

/**
 * A classification that says "this is metal loss" in so many words.
 *
 * Used only to rescue a feature whose free-text label happens to contain a
 * fitting name. See isMetalLossCandidate.
 */
const METAL_LOSS_TYPE_PATTERN = /metal\s*loss|corros|pitting|wall\s*loss|erosion|\bml\b/i;

/**
 * Every metal-loss record the NEW run reported, whichever bucket it landed in.
 *
 * Deliberately wider than the assessment: a bypassed cluster and a feature the
 * review did not release are both still metal on the pipe, and a spool register
 * that counted only the assessed ones would tell an engineer a joint carries
 * one defect when the ILI found ten. Excluded rows are the one exception — an
 * exclusion is a decision that the row is not real.
 */
export function extractSpoolCensus(
  comparison: readonly ComparisonRow[],
  selection?: AlignmentSelection,
): FfsSpoolCensusRow[] {
  const census: FfsSpoolCensusRow[] = [];
  for (const row of comparison) {
    if (!isMetalLossCandidate(row)) continue;
    const sourceKey = text(row['Source Key NEW'], '');
    const ldM = finiteNumber(row['Log Dist NEW (m)']);
    if (ldM === null) continue;
    census.push({
      sourceKey,
      featureId: text(row['Identif. NEW'], text(row['Feature ID NEW'], sourceKey)),
      ldM,
      depthPct: finiteNumber(row['Depth NEW (%WT)']),
      lengthMm: finiteNumber(row['Length NEW (mm)']),
      widthMm: finiteNumber(row['Width NEW (mm)']),
      isCluster: isClusteredAlignmentRow(row),
      assessed: selection ? isInScope(row, selection) : false,
    });
  }
  return census.sort((left, right) => left.ldM - right.ldM);
}

export interface AlignmentImportReadinessInput {
  lineName: string;
  iliDate: string;
  selectedRunId: string;
  alignmentRowCount: number;
  /** How much of the run the assessment covers. Defaults to `released`. */
  scope?: FfsIntakeScope;
  /** Features in scope: the whole NEW-run anomaly population, or the release. */
  selectedFeatureCount: number;
  outerDiameterMm: string;
  smysMpa: string;
  designFactor: string;
  operatingPressureMpa: string;
  fallbackDepthGrowthMmPerYear: string;
  fallbackLengthGrowthMmPerYear: string;
  /** Optional; blank means "the run must report a wall for every feature". */
  nominalWallThicknessMm?: string;
  /**
   * Released features the loaded result can actually assess. Zero blocks the
   * run, because the alternative is a thrown error after the engineer has
   * filled in the whole form.
   */
  assessableFeatureCount?: number;
  /** Stated verbatim when nothing is assessable, so the block says why. */
  intakeBlockReason?: string;
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

/** Blank when the run did not report the value, so absent never reads as zero. */
function optionalNumericText(value: unknown): string {
  const parsed = finiteNumber(value);
  return parsed === null ? '' : numericText(parsed);
}

/** The NEW-run measurements an assessment is built from. */
interface MeasuredGeometry {
  distance: number;
  depth: number;
  length: number;
  /**
   * Circumferential extent, or 0 where the run did not report one.
   *
   * B31G is a longitudinal method: depth and axial length govern the remaining
   * strength, and width appears nowhere in the failure-pressure calculation. It
   * was nevertheless demanded of every feature, so an entire run from a vendor
   * that ships no width column was refused in full — the assessment produced
   * nothing while the data it needed was all there. It is now optional, and the
   * two places that genuinely use it (the circumferential interaction screen and
   * the spool area estimate) already treat a non-positive width as unknown.
   */
  width: number;
  wall: number;
  wallSource: FfsWallThicknessSource;
}

/**
 * The measurements, or the sentence naming what stopped the row.
 *
 * A `{ ok, geometry | reason }` result object would read better, but this
 * project compiles with `strictNullChecks` off, and a boolean discriminant does
 * not narrow a union under that setting — every `reading.reason` became a type
 * error. `typeof` narrows in every mode.
 */
type MeasuredReading = MeasuredGeometry | string;

/**
 * Reads the five measured values from one row, or says exactly what stopped it.
 *
 * The only reader of this rule. The setup screen shows what an assessment would
 * accept before it is run, and the import decides what it does accept; when the
 * two answered from separate copies of the rule the screen said a session was
 * ready and the run then refused every feature in it.
 */
function readMeasuredGeometry(
  source: ComparisonRow,
  nominalWallThicknessMm: number | null,
): MeasuredReading {
  const distance = finiteNumber(source['Log Dist NEW (m)']);
  const depth = finiteNumber(source['Depth NEW (%WT)']);
  const length = finiteNumber(source['Length NEW (mm)']);
  const width = finiteNumber(source['Width NEW (mm)']);
  const reportedWall = finiteNumber(source['Wall WT NEW (mm)']);
  const fallbackWall = nominalWallThicknessMm !== null
    && Number.isFinite(nominalWallThicknessMm)
    && nominalWallThicknessMm > 0
    ? nominalWallThicknessMm
    : null;
  const wall = reportedWall ?? fallbackWall;

  // Only what B31G actually consumes is required. Width is not one of those —
  // see MeasuredGeometry.width.
  const missing: string[] = [];
  if (distance === null) missing.push('Log Dist NEW (m)');
  if (depth === null) missing.push('Depth NEW (%WT)');
  if (length === null) missing.push('Length NEW (mm)');
  if (wall === null) missing.push('Wall WT NEW (mm)');
  if (missing.length > 0) {
    return `Missing or invalid measured field(s): ${missing.join(', ')}.`;
  }

  // Depth is bounded by the wall, not by the 80 %WT project rejection line.
  // Rejecting deep features here removed the ones most likely to govern the
  // assessment before it ever ran; they are carried through and disclosed
  // instead. See the same note in `validation.ts`.
  if (
    (distance as number) < 0
    || (depth as number) < 0 || (depth as number) > 100
    || (length as number) <= 0 || (wall as number) <= 0
  ) {
    return 'Measured NEW-run values are outside the supported FFS domain.';
  }

  return {
    distance: distance as number,
    depth: depth as number,
    length: length as number,
    // A reported width that is zero or negative is not a measurement; it is
    // carried as "not reported" rather than as a zero-width defect.
    width: width !== null && (width as number) > 0 ? (width as number) : 0,
    wall: wall as number,
    wallSource: reportedWall === null ? 'line-nominal' : 'run-reported',
  };
}

/** One reason a group of released features cannot be assessed, with its size. */
export interface ReleasedIntakeBlocker {
  reason: string;
  count: number;
  /** A few feature IDs, so the engineer can open one and see it for themselves. */
  examples: string[];
}

/**
 * What an assessment would do with this release, without running it.
 *
 * Answers the only question the setup screen was never able to: of the features
 * an engineer released, how many can actually be assessed — and if none can,
 * which field is missing from how many of them.
 */
export interface ReleasedIntakeSummary {
  /** The scope these numbers describe. */
  scope: FfsIntakeScope;
  /** Candidate features in scope that were found in the loaded comparison result. */
  released: number;
  /**
   * Released keys with no row in this result at all. Non-zero means the review
   * and the result disagree about the run — a re-import, not a data problem.
   */
  missingFromResult: number;
  /**
   * Released features a reviewer later excluded. Held apart from the two above:
   * an exclusion is a decision someone made, not a mismatch and not bad data.
   */
  excludedByIntervention: number;
  assessable: number;
  blockers: ReleasedIntakeBlocker[];
  /** Assessable features that will use the line nominal wall, not a measured one. */
  usingNominalWall: number;
}

/**
 * @param comparison Rows after interventions and *before* excluded rows are
 * filtered out, so an exclusion can be told apart from a missing feature.
 */
export function summariseReleasedIntake(
  comparison: readonly ComparisonRow[],
  selection: AlignmentSelection,
  nominalWallThicknessMm: number | null = null,
): ReleasedIntakeSummary {
  const selectedKeys = selection?.selectedKeys instanceof Set ? selection.selectedKeys : new Set<string>();
  const scope: FfsIntakeScope = selection?.scope ?? 'released';
  const seen = new Set<string>();
  const excluded = new Set<string>();
  const blockers = new Map<string, ReleasedIntakeBlocker>();
  let assessable = 0;
  let usingNominalWall = 0;

  for (const source of comparison) {
    const sourceFeatureKey = text(source['Source Key NEW'], '');
    if (!sourceFeatureKey) continue;
    // An excluded row is filtered out by isMetalLossCandidate, so it is checked
    // first: this summary is the one place that has to tell "a reviewer excluded
    // it" apart from "this feature is not in the result at all".
    if (source.__excluded === true) {
      if (scope === 'all' || selectedKeys.has(sourceFeatureKey)) excluded.add(sourceFeatureKey);
      continue;
    }
    if (!isInScope(source, { ...selection, selectedKeys, scope })) continue;
    seen.add(sourceFeatureKey);
    const reading = readMeasuredGeometry(source, nominalWallThicknessMm);
    if (typeof reading !== 'string') {
      assessable += 1;
      if (reading.wallSource === 'line-nominal') usingNominalWall += 1;
      continue;
    }
    let blocker = blockers.get(reading);
    if (!blocker) {
      blocker = { reason: reading, count: 0, examples: [] };
      blockers.set(reading, blocker);
    }
    blocker.count += 1;
    if (blocker.examples.length < 3) {
      blocker.examples.push(text(source['Identif. NEW'], text(source['Feature ID NEW'], sourceFeatureKey)));
    }
  }

  return {
    scope,
    released: seen.size,
    // Only a release can go missing: under `all` the population is read from the
    // result itself, so there is nothing to be absent from it.
    missingFromResult: scope === 'all'
      ? 0
      : Math.max(0, selectedKeys.size - seen.size - excluded.size),
    excludedByIntervention: excluded.size,
    assessable,
    blockers: [...blockers.values()].sort((left, right) => right.count - left.count),
    usingNominalWall,
  };
}

/** One sentence stating why an assessment produced nothing, for the operator. */
export function describeEmptyIntake(summary: ReleasedIntakeSummary): string {
  if (summary.scope === 'all' && summary.released === 0) {
    return summary.excludedByIntervention > 0
      ? `Every metal-loss anomaly in this result (${summary.excludedByIntervention.toLocaleString()}) was excluded `
        + 'by a reviewer. Restore an exclusion, or align a run that reports metal loss.'
      : 'This alignment result reports no metal-loss anomaly on the NEW run, so there is nothing to assess.';
  }
  if (summary.released === 0 && summary.excludedByIntervention > 0 && summary.missingFromResult === 0) {
    return `All ${summary.excludedByIntervention.toLocaleString()} released feature(s) were excluded from the `
      + 'released outputs by a reviewer. Restore the exclusion, or release features that are still included.';
  }
  if (summary.released === 0 && summary.missingFromResult > 0) {
    return `None of the ${summary.missingFromResult.toLocaleString()} released feature(s) exist in the loaded `
      + 'alignment result. The review was saved against a different run — reload the session, then review it '
      + 'again in Corrosion Analysis.';
  }
  if (summary.released === 0) {
    return 'No released feature reached the assessment. Release the features in Corrosion Analysis first.';
  }
  const noun = summary.scope === 'all' ? 'anomaly' : 'released anomaly';
  const [worst] = summary.blockers;
  if (!worst) return `No ${noun} carries the geometry an FFS assessment needs.`;
  const others = summary.blockers.length - 1;
  return `${summary.released.toLocaleString()} ${summary.scope === 'all' ? 'anomal' : 'released feature'}`
    + `${summary.scope === 'all' ? 'ies' : '(s)'}, none assessable. `
    + `${worst.count.toLocaleString()} of them: ${worst.reason}`
    + (others > 0 ? ` (${others} other reason${others === 1 ? '' : 's'} affect the rest.)` : '');
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
  isClusteredMetalLoss: boolean,
): FfsGrowthEvidence {
  const oldSurveyYear = surveyYear(source['Run Year OLD']);
  const newSurveyYear = surveyYear(source['Run Year NEW']);
  // The engine reports the interval it actually divided by, resolved from the
  // inspection dates where the runs carry them. Re-deriving it from the two
  // survey years rounds a 3.25-year interval to 4 and inflates the zero-baseline
  // estimate accordingly; the year difference is only the fallback the engine
  // itself falls back to.
  const reportedInterval = finiteNumber(source['Growth Interval (y)']);
  const intervalYears = reportedInterval !== null && reportedInterval > 0
    ? reportedInterval
    : (oldSurveyYear !== null && newSurveyYear !== null && newSurveyYear > oldSurveyYear
      ? newSurveyYear - oldSurveyYear
      : null);
  const reportedDepthPctPerYear = finiteNumber(source['Depth Growth (%WT/yr)']);
  const reportedLengthMmPerYear = finiteNumber(source['Length Growth (mm/yr)']);
  const matchStatus = text(source['Match/Unmatch'], '').toLowerCase();
  const markedMatched = matchStatus === 'matched' || matchStatus === 'match';
  const hasOldFeature = present(source['Source Key OLD']) ||
    present(source['Identif. OLD']) ||
    present(source['Depth OLD (%WT)']);
  // A bypassed row is not a NEW-only defect. Clusters land in the bypass bucket
  // with no OLD side and no "matched" status, which made them look NEW-only and
  // earned them a zero-baseline growth estimate — while the disclosure printed
  // beside them said they carry no run-pair growth rate at all. The vendor
  // regroups the pits differently on every run, so there is no baseline to
  // estimate from and no rate is derived.
  const isNewOnly = !hasOldFeature && !markedMatched && !isClusteredMetalLoss;

  let depth: FfsGrowthComponentEvidence;
  if (isClusteredMetalLoss && !markedMatched) {
    depth = unavailableComponent(
      'unavailable',
      null,
      engineering.fallbackDepthGrowthMmPerYear,
      null,
      'Clustered metal loss is excluded from run-pair matching, so no measured or '
      + 'zero-baseline depth rate exists for it.',
    );
    warnings.push(
      engineering.fallbackDepthGrowthMmPerYear > 0
        ? 'Clustered metal loss carries no run-pair growth rate; the explicit fallback rate was used.'
        : 'Clustered metal loss carries no run-pair growth rate; depth projection cannot be calculated.',
    );
  } else if (isNewOnly && intervalYears !== null) {
    const rate = roundedRate(((depthPct / 100) * wallMm) / intervalYears);
    depth = {
      observation: 'new-only-zero-baseline-estimate',
      analysisBasis: 'estimated',
      rawRateMmPerYear: null,
      analysisRateMmPerYear: rate,
      formula: `(${depthPct} / 100 x ${wallMm} mm - 0 mm) / ${Number(intervalYears.toFixed(3))} y`,
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
    if (!isInScope(source, selection)) continue;
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
      startLd: minOf(distances),
      endLd: maxOf(distances),
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
    reasons.push((input.scope ?? 'released') === 'all'
      ? 'This alignment result reports no metal-loss anomaly on the NEW run.'
      : 'Release at least one feature in Corrosion Analysis for this session, or assess the whole run.');
  } else if (input.assessableFeatureCount === 0) {
    reasons.push(input.intakeBlockReason
      || 'No released feature carries the geometry an FFS assessment needs.');
  }

  if (input.nominalWallThicknessMm !== undefined && input.nominalWallThicknessMm.trim() !== '') {
    const wall = strictNumber(input.nominalWallThicknessMm);
    if (wall === null || wall <= 0) {
      reasons.push('Nominal wall thickness must be greater than 0 mm, or left empty.');
    }
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
  if (inputs.nominalWallThicknessMm !== null && inputs.nominalWallThicknessMm !== undefined) {
    if (!Number.isFinite(inputs.nominalWallThicknessMm) || inputs.nominalWallThicknessMm <= 0) {
      throw new Error('Nominal wall thickness must be greater than zero, or left empty.');
    }
  }
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
  const skipped: AlignmentImportSkipped = {
    noNewFeature: 0, notReleased: 0, notMetalLoss: 0, excluded: 0,
  };
  const scope: FfsIntakeScope = selection.scope ?? 'released';
  const nominalWall = engineering.nominalWallThicknessMm ?? null;

  for (const source of comparison) {
    const sourceFeatureKey = text(source['Source Key NEW'], '');
    const featureId = text(source['Identif. NEW'], text(source['Feature ID NEW'], sourceFeatureKey || 'Unknown'));
    // None of these is a rejection: the OLD side of the comparison was never a
    // candidate, a weld is not metal loss, an exclusion and a held-back feature
    // are decisions already made. Counted so the results page can state them,
    // never listed as failures the engineer has to read past.
    if (!sourceFeatureKey) {
      skipped.noNewFeature += 1;
      continue;
    }
    if (source.__excluded === true) {
      skipped.excluded += 1;
      continue;
    }
    if (!isMetalLossCandidate(source)) {
      skipped.notMetalLoss += 1;
      continue;
    }
    if (scope === 'released' && !selection.selectedKeys.has(sourceFeatureKey)) {
      skipped.notReleased += 1;
      continue;
    }

    const reading = readMeasuredGeometry(source, nominalWall);
    if (typeof reading === 'string') {
      rejected.push({
        featureId,
        sourceKey: sourceFeatureKey,
        ldM: finiteNumber(source['Log Dist NEW (m)']),
        depthPct: finiteNumber(source['Depth NEW (%WT)']),
        reason: reading,
      });
      continue;
    }
    const { distance, depth, length, width, wall, wallSource } = reading;

    const warnings: string[] = [];
    if (wallSource === 'line-nominal') {
      warnings.push(
        `The run reported no wall thickness for this feature; the line nominal wall of ${numericText(wall)} mm `
        + 'was used, and both the depth in millimetres and the failure pressure follow from it.',
      );
    }
    if (width === 0) {
      warnings.push(
        'The run reported no circumferential width for this feature. B31G does not use width, so the '
        + 'remaining-strength result is unaffected — but the circumferential interaction screen cannot '
        + 'judge this feature against its neighbours.',
      );
    }
    // Carried rather than dropped, but never carried quietly: past 80 %WT the
    // section 3 tables no longer apply and para. 1.2(f) asks for the sizing
    // accuracy and the effective corrosion rate to be justified.
    if (depth > 80) {
      warnings.push(
        `Reported at ${depth.toFixed(1)} %WT, past the 80 %WT project rejection line: assessed and reported, but the sizing accuracy and the effective corrosion rate must be justified before the result is relied on.`,
      );
    }
    // Same rule the alignment engine uses to keep merged groups out of matching,
    // so FFS labels exactly the rows the engine refused to pair.
    const isClusteredMetalLoss = isClusteredAlignmentRow(source);
    const growthEvidence = deriveGrowthEvidence(
      source, depth, wall, engineering, warnings, isClusteredMetalLoss,
    );
    const depthGrowthMm = growthEvidence.depth.analysisRateMmPerYear ?? 0;
    // The column has to carry a finite number for the calculation contract, but
    // the evidence record is what downstream consumers read to decide whether
    // this zero is a measurement or the absence of one.
    const lengthGrowthMm = growthEvidence.length.analysisRateMmPerYear ?? 0;
    const section = text(source['Section NEW'], text(source.Section));
    const { designFactor, source: designFactorSource } = resolveDesignFactor(section, engineering);
    const explicitSafetyFactor = engineering.safetyFactor ?? null;
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
        // Skeleton position, carried so the assessment can be reviewed spool by
        // spool. Blank when the run did not report it.
        'Joint No.': text(source['Joint No. NEW'], ''),
        'Dist U/S GW [m]': optionalNumericText(source['Dist GW NEW (m)']),
        'Joint Length [m]': optionalNumericText(source['Joint Len NEW (m)']),
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
        wallThicknessSource: wallSource,
      },
      warnings,
    });
  }

  return {
    accepted,
    rejected,
    skipped,
    girthWelds: extractGirthWeldLadder(comparison),
    census: extractSpoolCensus(comparison, selection),
  };
}
