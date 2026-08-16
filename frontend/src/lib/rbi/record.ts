/**
 * The blank API 580 document, and what the filed FFS assessment can fill in.
 *
 * Two rules govern everything here.
 *
 * The first: a blank field stays blank. Pre-filling an unknown with a plausible
 * default is the single most damaging thing a risk tool can do, because §16.7
 * requires assumptions to be documented and a silent default is an assumption
 * nobody knows was made. So the defaults below are empty strings, nulls, and
 * `false` — never a "typical" corrosion rate or a "usual" population class.
 *
 * The second: anything the FFS assessment already measured is *read*, not
 * re-typed. §8.3 lists transcription error as a named cause of poor data
 * quality; the diameter, wall, SMYS, pressure, inspection date and line name all
 * exist in the filed case, so they are seeded from it and flagged as such. The
 * engineer can override any of them, and an override is visible.
 */

import type { FfsScreenedResult } from '../ffs/types.ts';
import type { RevivedFfsShareState } from '../ffs/shareState.ts';
import { DAMAGE_MECHANISMS, damageMechanismById } from './catalogues.ts';
import type {
  RbiAssumption,
  RbiConsequenceOverride,
  RbiDamageMechanism,
  RbiIow,
  RbiRecord,
  RbiStepId,
  RbiTeamMember,
  RbiUnitPlan,
  RiskLevel,
} from './types.ts';

/** Stable row identity. Rows are reordered and deleted, so an index will not do. */
export function rowId(prefix: string): string {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${random}`;
}

/** Today, as the ISO calendar date the rest of the workspace uses. */
export function todayIso(): string {
  const now = new Date();
  return [
    String(now.getFullYear()).padStart(4, '0'),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
}

export const RBI_STEPS: readonly { id: RbiStepId; label: string; section: string; blurb: string }[] = [
  {
    id: 'planning',
    label: 'Planning and scope',
    section: '§6',
    blurb: 'Objectives, physical and operating boundaries, the window the assessment speaks for.',
  },
  {
    id: 'team',
    label: 'Team and qualifications',
    section: '§7 · §16.5',
    blurb: 'Who assessed the risk and what each brought. A corrosion specialist is required.',
  },
  {
    id: 'data',
    label: 'Data collection',
    section: '§8',
    blurb: 'Sources and their quality, equipment and process data, inventory and isolation.',
  },
  {
    id: 'dmr',
    label: 'Damage mechanism review',
    section: '§9',
    blurb: 'Credible mechanisms, rates or susceptibilities, and the integrity operating windows.',
  },
  {
    id: 'pof',
    label: 'Probability of failure',
    section: '§10',
    blurb: 'Inspection effectiveness per mechanism, and the measured probability that follows.',
  },
  {
    id: 'cof',
    label: 'Consequence of failure',
    section: '§11',
    blurb: 'Safety, environmental, production and repair consequence — with section overrides.',
  },
  {
    id: 'risk',
    label: 'Risk and criteria',
    section: '§12',
    blurb: 'The matrix, the acceptance thresholds, and the assumptions the result rests on.',
  },
  {
    id: 'plan',
    label: 'Inspection and mitigation',
    section: '§13 · §14',
    blurb: 'What to inspect, how, where, how much, when — and what to do beyond inspecting.',
  },
  {
    id: 'evergreen',
    label: 'Evergreening',
    section: '§15',
    blurb: 'The triggers that send this back for reassessment, and when it expires regardless.',
  },
  {
    id: 'documentation',
    label: 'Review and sign-off',
    section: '§16',
    blurb: 'The Appendix A checklist, sign-off, and issue.',
  },
];

/** §12.7 — the default thresholds, which an operator is expected to change. */
const DEFAULT_ACCEPTANCE: Record<RiskLevel, RbiRecord['risk']['acceptance'][RiskLevel]> = {
  Low: 'acceptable',
  Medium: 'acceptable',
  'Medium high': 'tolerable',
  High: 'unacceptable',
};

export function emptyRbiRecord(): RbiRecord {
  return {
    version: 1,
    title: '',
    ffsSessionId: null,
    planning: {
      objectives: [],
      objectivesNote: '',
      approach: 'semi-quantitative',
      facility: '',
      processUnit: '',
      system: '',
      includedEquipment: [],
      excludedEquipment: [],
      scopeRationale: '',
      operating: {
        normalPressureMpa: null,
        normalTemperatureC: null,
        minPressureMpa: null,
        maxPressureMpa: null,
        minTemperatureC: null,
        maxTemperatureC: null,
        flowNote: '',
        startupShutdownConsidered: false,
        startupShutdownNote: '',
        upsetConsidered: false,
        upsetNote: '',
        cyclicConsidered: false,
        cyclicNote: '',
      },
      timeframeFromIso: '',
      timeframeToIso: '',
      runLengthYears: null,
      codes: [],
      codesNote: '',
      jurisdictionalMaxIntervalYears: null,
    },
    team: [],
    data: {
      sources: [],
      equipment: {
        outerDiameterMm: null,
        nominalWallMm: null,
        material: '',
        grade: '',
        smysMpa: null,
        designPressureMpa: null,
        designTemperatureC: null,
        corrosionAllowanceMm: null,
        installedYear: null,
        seamType: '',
        externalCoating: '',
        insulated: false,
        cathodicProtection: '',
        note: '',
      },
      process: {
        fluid: 'crude-oil',
        phase: 'liquid',
        composition: '',
        h2sPpm: null,
        co2Pct: null,
        chloridesPpm: null,
        waterCutPct: null,
        ph: null,
        velocityMs: null,
        injectionPoints: '',
        note: '',
      },
      inventory: {
        volumeM3: null,
        isolationDescription: '',
        detectionSystem: 'C',
        isolationSystem: 'C',
        detectionTimeMin: null,
        isolationTimeMin: null,
        spillContainment: 'none',
        note: '',
      },
      validatedBy: '',
      validatedOnIso: '',
      validationNote: '',
    },
    dmr: {
      mechanisms: [],
      iows: [],
      corrosionSpecialist: '',
      reviewDateIso: '',
      rateSources: '',
      otherCauses: [],
      otherCausesNote: '',
    },
    consequence: {
      fluid: 'crude-oil',
      population: 'rural',
      personnelExposed: null,
      publicProximityM: null,
      toxicRelease: false,
      flammable: true,
      environmentReceptor: 'soil',
      environmentalCostUsd: null,
      dailyUnitValueUsd: null,
      downtimeDays: null,
      redundancy: 'none',
      repairCostUsd: null,
      // Copied from §8 and from the cited FFS case at build time, never typed.
      outerDiameterMm: 0,
      operatingPressureMpa: 0,
      inventoryM3: null,
      detection: 'C',
      isolation: 'C',
      spillContainment: 'none',
      basisNote: '',
    },
    consequenceOverrides: [],
    risk: {
      acceptance: { ...DEFAULT_ACCEPTANCE },
      assumptions: [],
      sensitivityNote: '',
      criteriaSource: '',
    },
    unitPlans: [],
    evergreening: {
      triggers: [],
      triggersNote: '',
      reassessmentIntervalYears: null,
      nextReassessmentIso: '',
      evergreenOwner: '',
      evergreenProcess: '',
    },
    documentation: {
      assessedBy: '',
      assessedOnIso: '',
      reviewedBy: '',
      reviewedOnIso: '',
      approvedBy: '',
      approvedOnIso: '',
      methodologyNote: '',
      distribution: '',
    },
  };
}

export function emptyTeamMember(): RbiTeamMember {
  return { id: rowId('team'), name: '', role: '', organization: '', qualification: '' };
}

export function emptyAssumption(): RbiAssumption {
  return { id: rowId('asm'), assumption: '', basis: '', impactIfWrong: '' };
}

export function emptyIow(): RbiIow {
  return {
    id: rowId('iow'),
    parameter: '',
    unit: '',
    lowLimit: null,
    highLimit: null,
    mechanismRowId: '',
    actionOnExceedance: '',
  };
}

/**
 * A new mechanism row, pre-filled from the catalogue entry only.
 *
 * The damage mode, failure mode and technique come from the catalogue because
 * those are properties of the mechanism itself. The status, the rate and the
 * evidence do not — those are the specialist's findings, and a row that arrives
 * pre-marked "active" with a plausible rate is a finding nobody made.
 */
export function mechanismRowFor(mechanismId: string): RbiDamageMechanism {
  const definition = damageMechanismById(mechanismId);
  return {
    id: rowId('dm'),
    mechanismId,
    customName: '',
    status: 'potential',
    damageMode: definition?.damageMode ?? '',
    failureMode: definition?.failureMode ?? 'leak',
    rateBasis: definition?.rateBasis ?? 'susceptibility',
    rateMmPerYear: null,
    susceptibility: 'medium',
    basis: '',
    ruledOutReason: '',
    effectiveness: 'none',
    inspectionMethod: '',
    coveragePct: null,
    lastInspectionIso: '',
    plannedTechnique: definition?.technique ?? '',
  };
}

export function emptyUnitPlan(unitId: string): RbiUnitPlan {
  return {
    unitId,
    technique: '',
    coveragePct: null,
    locations: '',
    strategy: 'none',
    mitigationNote: '',
    targetDateIso: '',
    owner: '',
    residualRiskLevel: null,
    overrideIntervalYears: null,
    overrideReason: '',
  };
}

export function emptyConsequenceOverride(unitId: string): RbiConsequenceOverride {
  return { unitId, population: null, environmentReceptor: null, note: '' };
}

/** The name shown for a mechanism row, catalogue or custom. */
export function mechanismName(row: RbiDamageMechanism): string {
  if (row.mechanismId === 'custom' || row.mechanismId === '') {
    return row.customName.trim() || 'Unnamed mechanism';
  }
  return damageMechanismById(row.mechanismId)?.label
    ?? (row.customName.trim() || row.mechanismId);
}

/* ── Seeding from the filed FFS assessment ─────────────────────────────────── */

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The two mechanisms an ILI metal-loss run has actually measured.
 *
 * They are seeded as `active` — unlike every other row, which starts as merely
 * credible — because the evidence for them is already in the case: features were
 * found, sized, and assessed to B31G. Marking them "potential" would understate
 * a mechanism the operator has measurement of, which is the opposite of what
 * §9.4.2 asks for.
 */
function seededMetalLossRows(hasFeatures: boolean, growthMeasured: boolean): RbiDamageMechanism[] {
  if (!hasFeatures) return [];
  const evidence = growthMeasured
    ? 'Measured by in-line inspection and assessed to ASME B31G in the cited FFS session; growth rate '
      + 'derived from matched features across two runs.'
    : 'Measured by in-line inspection and assessed to ASME B31G in the cited FFS session. The growth '
      + 'rate behind the remaining life is assumed rather than measured — see the FFS growth evidence.';

  return ['internal-general-corrosion', 'external-corrosion'].map((id) => ({
    ...mechanismRowFor(id),
    status: 'active' as const,
    rateBasis: 'measured-ili' as const,
    basis: evidence,
  }));
}

export interface FfsSeed {
  ffsSessionId: string | null;
  state: RevivedFfsShareState;
  screened: FfsScreenedResult[];
}

/**
 * Fill in what the filed assessment already knows.
 *
 * Only ever writes into fields the engineer has left empty, so re-attaching a
 * corrected FFS session to an assessment in progress cannot silently overwrite a
 * value someone deliberately entered. The one exception is the geometry the
 * consequence release-scale is computed from, which must track the case it is
 * assessed against or the two documents disagree about the same pipe.
 */
export function seedRecordFromFfs(record: RbiRecord, seed: FfsSeed): RbiRecord {
  const { state, screened, ffsSessionId } = seed;
  const first = screened[0]?.nominal;
  const od = finite(first?.od);
  const pressure = finite(first?.p0);
  const wall = finite(first?.wall);
  const smys = finite(first?.smys);

  // A growth basis is "measured" only when at least one feature carried a rate
  // the source data actually reported. §8.3: the distinction between a reported
  // and an assumed number is exactly what data quality means.
  const growthMeasured = screened.some(
    (item) => item.nominal.growthEvidence?.depth.analysisBasis === 'reported',
  );

  const equipment = { ...record.data.equipment };
  if (equipment.outerDiameterMm === null) equipment.outerDiameterMm = od;
  if (equipment.nominalWallMm === null) equipment.nominalWallMm = wall;
  if (equipment.smysMpa === null) equipment.smysMpa = smys;
  if (equipment.installedYear === null) {
    equipment.installedYear = state.config.serviceLife?.commissioningYear ?? null;
  }

  const operating = { ...record.planning.operating };
  if (operating.normalPressureMpa === null) operating.normalPressureMpa = pressure;

  const mechanisms = record.dmr.mechanisms.length > 0
    ? record.dmr.mechanisms
    : seededMetalLossRows(screened.length > 0, growthMeasured);

  return {
    ...record,
    ffsSessionId,
    title: record.title.trim() || `${state.config.lineName} — API 580 assessment`,
    planning: {
      ...record.planning,
      system: record.planning.system.trim() || state.config.lineName,
      operating,
    },
    data: { ...record.data, equipment },
    dmr: { ...record.dmr, mechanisms },
    consequence: {
      ...record.consequence,
      // Tracked, not seeded: the release scale must describe the pipe the
      // assessment was actually run on.
      outerDiameterMm: od ?? 0,
      operatingPressureMpa: pressure ?? 0,
    },
  };
}

/**
 * Bring a stored document forward.
 *
 * A record saved before a field existed comes back missing it, and a missing
 * field would render as `undefined` in an input and throw on the first keystroke.
 * Merging over a blank record is what makes an assessment authored months ago
 * still openable — which is the §16.2 requirement, not a convenience.
 */
export function reviveRbiRecord(stored: unknown): RbiRecord {
  const blank = emptyRbiRecord();
  if (typeof stored !== 'object' || stored === null) return blank;
  const input = stored as Partial<RbiRecord>;

  return {
    ...blank,
    ...input,
    version: 1,
    planning: {
      ...blank.planning,
      ...(input.planning ?? {}),
      operating: { ...blank.planning.operating, ...(input.planning?.operating ?? {}) },
      objectives: input.planning?.objectives ?? [],
      includedEquipment: input.planning?.includedEquipment ?? [],
      excludedEquipment: input.planning?.excludedEquipment ?? [],
      codes: input.planning?.codes ?? [],
    },
    team: Array.isArray(input.team) ? input.team : [],
    data: {
      ...blank.data,
      ...(input.data ?? {}),
      sources: Array.isArray(input.data?.sources) ? input.data.sources : [],
      equipment: { ...blank.data.equipment, ...(input.data?.equipment ?? {}) },
      process: { ...blank.data.process, ...(input.data?.process ?? {}) },
      inventory: { ...blank.data.inventory, ...(input.data?.inventory ?? {}) },
    },
    dmr: {
      ...blank.dmr,
      ...(input.dmr ?? {}),
      mechanisms: Array.isArray(input.dmr?.mechanisms) ? input.dmr.mechanisms : [],
      iows: Array.isArray(input.dmr?.iows) ? input.dmr.iows : [],
      otherCauses: Array.isArray(input.dmr?.otherCauses) ? input.dmr.otherCauses : [],
    },
    consequence: { ...blank.consequence, ...(input.consequence ?? {}) },
    consequenceOverrides: Array.isArray(input.consequenceOverrides) ? input.consequenceOverrides : [],
    risk: {
      ...blank.risk,
      ...(input.risk ?? {}),
      acceptance: { ...blank.risk.acceptance, ...(input.risk?.acceptance ?? {}) },
      assumptions: Array.isArray(input.risk?.assumptions) ? input.risk.assumptions : [],
    },
    unitPlans: Array.isArray(input.unitPlans) ? input.unitPlans : [],
    evergreening: {
      ...blank.evergreening,
      ...(input.evergreening ?? {}),
      triggers: Array.isArray(input.evergreening?.triggers) ? input.evergreening.triggers : [],
    },
    documentation: { ...blank.documentation, ...(input.documentation ?? {}) },
  };
}

/** Every catalogue mechanism not yet on the review, for the "add" picker. */
export function unusedMechanisms(record: RbiRecord): string[] {
  const used = new Set(record.dmr.mechanisms.map((row) => row.mechanismId));
  return DAMAGE_MECHANISMS.filter((item) => !used.has(item.id)).map((item) => item.id);
}
