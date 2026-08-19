/**
 * The pipeline dossier: the line's design data, filed once and read everywhere.
 *
 * The alignment intake used to collect these values into wizard state that was
 * thrown away on the next visit, and FFS then asked for the same numbers again
 * under different names in different units. One shape now travels between them,
 * and it is canonical: millimetres and megapascals, the units the B31G kernel
 * works in. A screen may offer inches or psi, but what is stored and what is
 * read back never depends on which unit was selected when it was typed.
 *
 * Every field is nullable on purpose. "Not recorded" is an answer an assessment
 * has to be able to report, and a defaulted zero is not the same thing — it is
 * a number that will silently be assessed against.
 */

/** Pipe the same way a line and one of its stretches both describe it. */
export interface PipeSpecFields {
  outerDiameterMm: number | null;
  nominalWallThicknessMm: number | null;
  smysMpa: number | null;
  designFactor: number | null;
  materialGrade: string | null;
  seamType: string | null;
}

/**
 * One stretch of uniform pipe, bounded on odometer metres from the launcher.
 *
 * A line that steps from 20 in to 24 in at a reducer, or from X52 to X60 across
 * a replacement spool, has no single diameter or grade to assess against: B31G
 * carries D in the failure pressure and in the Folias term, and SMYS sets the
 * flow stress. `startM` or `endM` left null means the stretch is open-ended in
 * that direction, which is the ordinary way to describe the first and last
 * stretch of a line whose exact ends nobody surveyed.
 */
export interface PipelineSegment extends PipeSpecFields {
  id?: string;
  label: string;
  startM: number | null;
  endM: number | null;
}

export interface PipelineSpecification extends PipeSpecFields {
  environment: string | null;
  productMedium: string | null;
  lengthKm: number | null;
  locationClass: string | null;
  installationYear: number | null;
  /**
   * The year the line went into service.
   *
   * Deliberately distinct from installation: FFS reports consumed design life
   * and derives a service-age corrosion rate from this one, so a line laid in
   * 1993 and commissioned in 1995 is not two years of corrosion either way.
   */
  commissioningYear: number | null;
  designLifeYears: number | null;
  externalCoating: string | null;
  maopMpa: number | null;
  designPressureMpa: number | null;
  operatingPressureMpa: number | null;
  /** The P of ASME B31.4 para. 403.2.1, used for the design thickness. */
  internalDesignPressureMpa: number | null;
  weldJointFactor: number | null;
  yieldToTensileRatio: number | null;
  notes: string | null;
  updatedAt?: string | null;
  segments: PipelineSegment[];
}

export interface PipelineDossier {
  pipelineId: number;
  pipelineName: string;
  /** False until someone files a dossier; every pre-existing line starts here. */
  recorded: boolean;
  specification: PipelineSpecification | null;
}

export interface PipelineRegisterEntry {
  pipelineId: number;
  pipelineName: string;
  recorded: boolean;
  updatedAt: string | null;
  createdAt: string | null;
  runCount: number;
  segmentCount: number;
  lengthKm: number | null;
  outerDiameterMm: number | null;
  nominalWallThicknessMm: number | null;
  smysMpa: number | null;
  designFactor: number | null;
  materialGrade: string | null;
  segmentDiameters: number[];
}

export const EMPTY_PIPE_SPEC: PipeSpecFields = {
  outerDiameterMm: null,
  nominalWallThicknessMm: null,
  smysMpa: null,
  designFactor: null,
  materialGrade: null,
  seamType: null,
};

export const EMPTY_PIPELINE_SPECIFICATION: PipelineSpecification = {
  ...EMPTY_PIPE_SPEC,
  environment: null,
  productMedium: null,
  lengthKm: null,
  locationClass: null,
  installationYear: null,
  commissioningYear: null,
  designLifeYears: null,
  externalCoating: null,
  maopMpa: null,
  designPressureMpa: null,
  operatingPressureMpa: null,
  internalDesignPressureMpa: null,
  weldJointFactor: null,
  yieldToTensileRatio: null,
  notes: null,
  segments: [],
};

function finiteOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function textOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text === '' ? null : text;
}

function normalizeSegment(value: unknown, index: number): PipelineSegment {
  const source = (value ?? {}) as Record<string, unknown>;
  return {
    id: typeof source.id === 'string' ? source.id : undefined,
    label: textOrNull(source.label) ?? `Segment ${index + 1}`,
    startM: finiteOrNull(source.startM),
    endM: finiteOrNull(source.endM),
    outerDiameterMm: finiteOrNull(source.outerDiameterMm),
    nominalWallThicknessMm: finiteOrNull(source.nominalWallThicknessMm),
    smysMpa: finiteOrNull(source.smysMpa),
    designFactor: finiteOrNull(source.designFactor),
    materialGrade: textOrNull(source.materialGrade),
    seamType: textOrNull(source.seamType),
  };
}

/** The dossier as the API returns it, with every field forced to shape. */
export function normalizePipelineSpecification(value: unknown): PipelineSpecification {
  const source = (value ?? {}) as Record<string, unknown>;
  const segments = Array.isArray(source.segments) ? source.segments : [];
  return {
    environment: textOrNull(source.environment),
    productMedium: textOrNull(source.productMedium),
    lengthKm: finiteOrNull(source.lengthKm),
    locationClass: textOrNull(source.locationClass),
    installationYear: finiteOrNull(source.installationYear),
    commissioningYear: finiteOrNull(source.commissioningYear),
    designLifeYears: finiteOrNull(source.designLifeYears),
    outerDiameterMm: finiteOrNull(source.outerDiameterMm),
    nominalWallThicknessMm: finiteOrNull(source.nominalWallThicknessMm),
    smysMpa: finiteOrNull(source.smysMpa),
    designFactor: finiteOrNull(source.designFactor),
    materialGrade: textOrNull(source.materialGrade),
    seamType: textOrNull(source.seamType),
    externalCoating: textOrNull(source.externalCoating),
    maopMpa: finiteOrNull(source.maopMpa),
    designPressureMpa: finiteOrNull(source.designPressureMpa),
    operatingPressureMpa: finiteOrNull(source.operatingPressureMpa),
    internalDesignPressureMpa: finiteOrNull(source.internalDesignPressureMpa),
    weldJointFactor: finiteOrNull(source.weldJointFactor),
    yieldToTensileRatio: finiteOrNull(source.yieldToTensileRatio),
    notes: textOrNull(source.notes),
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : null,
    segments: segments.map(normalizeSegment),
  };
}

export function normalizePipelineDossier(value: unknown): PipelineDossier | null {
  const source = (value ?? {}) as Record<string, unknown>;
  const pipelineId = finiteOrNull(source.pipelineId);
  if (pipelineId === null) return null;
  const recorded = Boolean(source.recorded) && source.specification !== null;
  return {
    pipelineId,
    pipelineName: textOrNull(source.pipelineName) ?? '',
    recorded,
    specification: recorded ? normalizePipelineSpecification(source.specification) : null,
  };
}

/** True where the dossier says nothing at all about the pipe. */
export function isBlankSpecification(spec: PipelineSpecification): boolean {
  const { segments, notes, updatedAt, ...scalars } = spec;
  void notes;
  void updatedAt;
  return segments.length === 0 && Object.values(scalars).every((value) => value === null);
}

/**
 * How much of a stretch of line a segment covers.
 *
 * Both sides are half-open ranges in odometer metres. A segment with no bound
 * on one side extends to that end of the line, so an "everything upstream of
 * KP 12" stretch overlaps a section that starts at zero.
 */
export function overlapMetres(
  segment: Pick<PipelineSegment, 'startM' | 'endM'>,
  range: { startM: number; endM: number },
): number {
  const segmentStart = segment.startM ?? Number.NEGATIVE_INFINITY;
  const segmentEnd = segment.endM ?? Number.POSITIVE_INFINITY;
  const start = Math.max(segmentStart, range.startM);
  const end = Math.min(segmentEnd, range.endM);
  if (!(end > start)) {
    // A zero-length range — a section holding one feature — still belongs to
    // whichever segment contains that point, or the comparison below would
    // never pick one.
    const containsPoint = range.startM >= segmentStart && range.startM <= segmentEnd;
    return containsPoint ? 0 : -1;
  }
  return end - start;
}

/**
 * The registered stretch a named section sits in, or null where none does.
 *
 * Sections are bounded on girth welds an engineer clicked; segments are
 * bounded on the pipe book's odometer figures. The two are describing the same
 * line and will rarely agree to the metre, so the segment that covers the most
 * of the section wins rather than requiring containment. Ties go to the earlier
 * segment, which is the order the register was entered in.
 */
export function segmentForRange(
  segments: readonly PipelineSegment[],
  range: { startM: number; endM: number },
): PipelineSegment | null {
  let best: PipelineSegment | null = null;
  let bestOverlap = -1;
  for (const segment of segments) {
    const overlap = overlapMetres(segment, range);
    if (overlap > bestOverlap) {
      best = segment;
      bestOverlap = overlap;
    }
  }
  return bestOverlap < 0 ? null : best;
}

/**
 * The pipe a section will be assessed as, reading the register and falling back
 * to the line defaults for anything the stretch does not state.
 *
 * Returns only what differs from the line, because that is what an override is:
 * pushing the line default down into every section would have each of them
 * report a "section override" nobody entered.
 */
export function sectionPipeFromRegister(
  spec: PipelineSpecification,
  range: { startM: number; endM: number },
): { segment: PipelineSegment | null } & PipeSpecFields {
  const segment = segmentForRange(spec.segments, range);
  if (!segment) return { segment: null, ...EMPTY_PIPE_SPEC };
  return {
    segment,
    outerDiameterMm: segment.outerDiameterMm !== null && segment.outerDiameterMm !== spec.outerDiameterMm
      ? segment.outerDiameterMm
      : null,
    nominalWallThicknessMm:
      segment.nominalWallThicknessMm !== null
        && segment.nominalWallThicknessMm !== spec.nominalWallThicknessMm
        ? segment.nominalWallThicknessMm
        : null,
    smysMpa: segment.smysMpa !== null && segment.smysMpa !== spec.smysMpa
      ? segment.smysMpa
      : null,
    designFactor: segment.designFactor,
    materialGrade: segment.materialGrade,
    seamType: segment.seamType,
  };
}

/** Every distinct outside diameter the line is built from, smallest first. */
export function registeredDiameters(spec: PipelineSpecification): number[] {
  const diameters = new Set<number>();
  if (spec.outerDiameterMm !== null) diameters.add(spec.outerDiameterMm);
  for (const segment of spec.segments) {
    if (segment.outerDiameterMm !== null) diameters.add(segment.outerDiameterMm);
  }
  return [...diameters].sort((left, right) => left - right);
}

/**
 * Specified minimum yield strength by API 5L grade, in MPa.
 *
 * API Spec 5L Table 6 (PSL 1) — the grade designation *is* the yield strength
 * in ksi for the X grades, and these are the SI figures the standard prints.
 * Offered as a suggestion when the grade is picked and SMYS is still blank: the
 * pipe dossier usually names the grade and leaves the number to be looked up,
 * and looking it up by hand is how an X60 line ends up assessed at X52.
 */
export const API_5L_SMYS_MPA: Readonly<Record<string, number>> = {
  'API 5L Gr.B': 241.3,
  'API 5L X42': 289.6,
  'API 5L X46': 317.2,
  'API 5L X52': 358.5,
  'API 5L X56': 386.1,
  'API 5L X60': 413.7,
  'API 5L X65': 448.2,
  'API 5L X70': 482.6,
  'API 5L X80': 551.6,
};

export function smysForGrade(grade: string | null): number | null {
  if (!grade) return null;
  return API_5L_SMYS_MPA[grade.trim()] ?? null;
}
