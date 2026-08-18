/**
 * The step-by-step working behind one feature's B31G result.
 *
 * This exists because the trace used to be written by hand in the detail modal,
 * as literal strings, while the engine underneath it moved on. By the time the
 * safety factor became an explicit B31G para. 1.9 ratio rather than the historic
 * 1/F, three of the printed steps no longer reproduced the numbers beside them:
 * the trace showed `SF = 1 / DF` for a safety factor that had not been derived
 * that way, `P_safe = P_F × DF` for a division by SF, and `ERF = S₀ / (S_F × DF)`
 * for a ratio taken against that safe pressure. On a line at F = 0.72 assessed at
 * the para. 1.9 minimum of 1.25 the printed working understated the safe pressure
 * by 10 % and overstated ERF by 11 %. Every number on the screen was right; the
 * explanation of how it was reached was not, which is the one failure mode a
 * fitness-for-service report cannot survive.
 *
 * So the working is data now, built from the same result the engine produced, and
 * every step carries `audit.recomputed` — the step evaluated independently from
 * its own stated inputs. `verifyCalcTrace` walks those and returns any step whose
 * printed working does not reproduce its printed result, which is asserted in the
 * test suite. A formula string and the maths behind it can no longer drift apart
 * without a test going red.
 *
 * `basis` is the sentence an engineer needs when a reviewer asks where a number
 * came from: which clause, which project decision, or which input column.
 */

import {
  B31G_DEPTH_LIMIT_RATIO,
  MODIFIED_FLOW_STRESS_UPLIFT_MPA,
  MODIFIED_B31G_Z_CUTOFF,
  ORIGINAL_B31G_Z_CUTOFF,
} from './b31g.ts';
import { growthAnalysisBasisLabel, pressureBasisLabel } from './assessmentProfile.ts';
import { resolvedDepthRate, resolvedLengthRate } from './growthResolution.ts';
import { formatLifeProjection } from './lifeProjection.ts';
import { texMark, texNumber, texText } from '../math/tex.ts';
import type { FfsConfig, FfsResult, FfsScreeningConfig } from './types.ts';

export type FfsCalcTone = 'default' | 'accent' | 'good' | 'warn' | 'bad';

export interface FfsCalcStep {
  id: string;
  index: number;
  /** What the step produces, in words. */
  name: string;
  /**
   * The general form, in symbols, as plain text.
   *
   * Still here alongside the TeX below because it is what the workbook and the
   * Word report carry: a spreadsheet cell has no typesetter, and an `.xlsx`
   * holding `\frac{P_F}{SF}` would be worse than one holding `P_F / SF`. The
   * screen reads the TeX, the exports read this.
   */
  formula: string;
  /** The same form with this feature's numbers in it, as plain text. */
  substitution: string;
  /** The general form as TeX, for the screen. */
  formulaTex: string;
  /** The substitution as TeX. Empty where the step substitutes nothing. */
  substitutionTex: string;
  /** The engine's value for this step. Null where the step has no number. */
  value: number | null;
  /** Pre-formatted result, for steps whose answer is not a bare number. */
  display?: string;
  unit?: string;
  /** Short branch or condition tag. */
  note?: string;
  /**
   * Where this number comes from and what stands behind it — clause, project
   * rule, or input column. This is what makes the step defensible rather than
   * merely reproducible.
   */
  basis: string;
  tone: FfsCalcTone;
  /**
   * True for the steps that carry the assessment: an engineer skimming for the
   * answer needs these, and can collapse the rest.
   */
  governing: boolean;
  audit: {
    /** The step evaluated from its own stated inputs, independently. */
    recomputed: number | null;
    /** False when the printed working does not reproduce the printed result. */
    matches: boolean;
  };
}

/** Relative tolerance for the self-check, loose enough for the stored rounding. */
const AUDIT_TOLERANCE = 1e-3;

/**
 * Year figures agree to the precision they are stored at.
 *
 * A remnant life is rounded to two decimals before it is stored, so on a short
 * life the relative check below rejects a step that is in fact exact — half a
 * hundredth of a year is 0.2 % of 2.5 years. Years get an absolute tolerance
 * matched to that rounding instead.
 */
function agreesYears(engine: number | null, recomputed: number | null): boolean {
  if (engine === null || recomputed === null) return engine === recomputed;
  if (!Number.isFinite(engine) || !Number.isFinite(recomputed)) return engine === recomputed;
  return Math.abs(engine - recomputed) <= 0.011;
}

function agrees(engine: number | null, recomputed: number | null): boolean {
  if (engine === null || recomputed === null) return engine === recomputed;
  if (!Number.isFinite(engine) || !Number.isFinite(recomputed)) return engine === recomputed;
  const scale = Math.max(Math.abs(engine), Math.abs(recomputed), 1e-9);
  return Math.abs(engine - recomputed) / scale <= AUDIT_TOLERANCE;
}

function num(value: number, digits: number): string {
  return Number.isFinite(value) ? value.toFixed(digits) : '∞';
}

/** The same number, spelled for a math list rather than for a spreadsheet cell. */
function tex(value: number, digits: number): string {
  return texNumber(value, digits);
}

/**
 * The working behind the nominal result, in the order it is calculated.
 *
 * `screening` only supplies the review band used to colour the ERF step; no
 * screening assumption enters the numbers, which are the code result.
 */
export function buildCalcTrace(
  n: FfsResult,
  config: FfsConfig,
  screening: FfsScreeningConfig,
): FfsCalcStep[] {
  const isOriginal = config.method === 'original';
  const k = isOriginal ? 2 / 3 : 0.85;
  const kLabel = isOriginal ? '2/3' : '0.85';
  // The Original method drops the bulging term on its long branch, and that is
  // the only case where M is absent.
  const longOriginal = isOriginal && n.M === null;
  const uplift = MODIFIED_FLOW_STRESS_UPLIFT_MPA;
  const usesUplift = !isOriginal && config.modifiedSa === 'smys69';
  const depthLimitPct = B31G_DEPTH_LIMIT_RATIO * 100;
  const explicitSf = n.safetyFactorSource === 'explicit';
  // The area idealisation constant, typeset as the fraction the code states
  // rather than as the decimal 0.667 the Original method never writes.
  const kTex = isOriginal ? '\\tfrac{2}{3}' : '0.85';

  const steps: Omit<FfsCalcStep, 'index'>[] = [];

  // 1 — Safety factor. The divisor between failure and safe pressure, and the
  // step that used to claim 1/DF regardless of where the figure actually came
  // from. Both provenances are real, so the trace states which one applied.
  steps.push({
    id: 'safety-factor',
    name: 'Safety factor',
    formula: explicitSf ? 'SF = supplied hydrotest ÷ MAOP ratio' : 'SF = 1 / DF',
    substitution: explicitSf
      ? `${num(n.SF, 4)} entered on the assessment`
      : `1 / ${num(n.df, 3)}`,
    formulaTex: explicitSf
      ? `\\SFac = \\frac{P_{\\mathrm{hydrotest,\\,min}}}{\\MAOP}`
      : '\\SFac = \\frac{1}{\\DFac}',
    substitutionTex: explicitSf
      ? `\\SFac = ${tex(n.SF, 4)} ${texText('entered on the assessment')}`
      : `\\frac{1}{${tex(n.df, 3)}}`,
    value: n.SF,
    basis: explicitSf
      ? 'ASME B31G-2023 para. 1.9: the ratio of the minimum hydrostatic test pressure required for the construction type to the MAOP or MOP, usually not below 1.25. Entered directly, not inferred from the design factor.'
      : `No hydrotest ratio was supplied, so the historic practice behind the section 3 tables applies: a line designed to F = ${num(n.df, 2)} carries SF = 1/F. This is only correct while the line operates at its design hoop stress.`,
    tone: explicitSf ? 'default' : 'warn',
    governing: false,
    audit: {
      recomputed: explicitSf ? n.SF : 1 / n.df,
      matches: agrees(n.SF, explicitSf ? n.SF : 1 / n.df),
    },
  });

  // 2 — Depth in millimetres.
  steps.push({
    id: 'depth',
    name: 'Metal-loss depth',
    formula: 'd = (depth% / 100) × t',
    substitution: `(${num(n.maxDepthPct, 2)} / 100) × ${num(n.wall, 2)}`,
    formulaTex: 'd = \\frac{d_{\\%}}{100}\\,t',
    substitutionTex: `\\frac{${tex(n.maxDepthPct, 2)}}{100}\\times ${tex(n.wall, 2)}`,
    value: n.d,
    unit: 'mm',
    basis: 'ILI-reported maximum depth as a percentage of the nominal wall, converted to millimetres against the wall thickness on the same row.',
    tone: 'default',
    governing: false,
    audit: {
      recomputed: (n.maxDepthPct / 100) * n.wall,
      matches: agrees(n.d, (n.maxDepthPct / 100) * n.wall),
    },
  });

  // 3 — Depth ratio.
  steps.push({
    id: 'depth-ratio',
    name: 'Depth ratio',
    formula: 'd/t',
    substitution: `${num(n.d, 4)} / ${num(n.wall, 2)}`,
    formulaTex: '\\frac{d}{t}',
    substitutionTex: `\\frac{${tex(n.d, 4)}}{${tex(n.wall, 2)}}`,
    value: n.dt,
    basis: 'The fraction of wall lost. It drives the area term in the remaining-strength equation and is the quantity the 80 %WT line is drawn against.',
    tone: 'default',
    governing: false,
    audit: { recomputed: n.d / n.wall, matches: agrees(n.dt, n.d / n.wall) },
  });

  // 4 — Normalised length.
  steps.push({
    id: 'z',
    name: 'Normalised length',
    formula: 'z = L² / (D × t)',
    substitution: `${num(n.length, 0)}² / (${num(n.od, 1)} × ${num(n.wall, 2)})`,
    formulaTex: 'z = \\frac{L^{2}}{D\\,t}',
    substitutionTex: `\\frac{${tex(n.length, 0)}^{2}}{${tex(n.od, 1)}\\times ${tex(n.wall, 2)}}`,
    value: n.z,
    basis: 'The dimensionless axial extent that selects which branch of the method applies. D is the nominal outside diameter, matching the Barlow relation used for the pressures below.',
    tone: 'default',
    governing: false,
    audit: {
      recomputed: (n.length * n.length) / (n.od * n.wall),
      matches: agrees(n.z, (n.length * n.length) / (n.od * n.wall)),
    },
  });

  // 5 — Folias factor, per branch.
  if (longOriginal) {
    steps.push({
      id: 'folias',
      name: 'Bulging factor',
      formula: 'Not used on this branch',
      substitution: `z = ${num(n.z, 4)} exceeds ${ORIGINAL_B31G_Z_CUTOFF}`,
      formulaTex: texText('not used on this branch'),
      substitutionTex: `z = ${tex(n.z, 4)} > ${ORIGINAL_B31G_Z_CUTOFF}`,
      value: null,
      display: 'n/a',
      note: `z > ${ORIGINAL_B31G_Z_CUTOFF}`,
      basis: 'ASME B31G-2023 para. 2.2(a): past z = 20 the Original method takes the metal loss as a full-wall rectangle and drops the bulging term, leaving S_F = S_flow (1 − d/t).',
      tone: 'default',
      governing: false,
      audit: { recomputed: null, matches: true },
    });
  } else if (isOriginal) {
    const recomputed = Math.sqrt(1 + 0.8 * n.z);
    steps.push({
      id: 'folias',
      name: 'Bulging factor (Folias)',
      formula: 'M = √(1 + 0.8z)',
      substitution: `√(1 + 0.8 × ${num(n.z, 4)})`,
      formulaTex: 'M = \\sqrt{1 + 0.8\\,z}',
      substitutionTex: `\\sqrt{1 + 0.8 \\times ${tex(n.z, 4)}}`,
      value: n.M,
      note: `z ≤ ${ORIGINAL_B31G_Z_CUTOFF}`,
      basis: 'The Original B31G short-anomaly bulging factor. It raises the stress a flaw of this length sees relative to a through-wall crack of the same extent.',
      tone: 'accent',
      governing: false,
      audit: { recomputed, matches: agrees(n.M, recomputed) },
    });
  } else if (n.z <= MODIFIED_B31G_Z_CUTOFF) {
    const recomputed = Math.sqrt(Math.max(1, 1 + 0.6275 * n.z - 0.003375 * n.z * n.z));
    steps.push({
      id: 'folias',
      name: 'Bulging factor (Folias)',
      formula: 'M = √(1 + 0.6275z − 0.003375z²)',
      substitution: `√(1 + 0.6275 × ${num(n.z, 4)} − 0.003375 × ${num(n.z, 4)}²)`,
      formulaTex: 'M = \\sqrt{1 + 0.6275\\,z - 0.003375\\,z^{2}}',
      substitutionTex:
        `\\sqrt{1 + 0.6275 \\times ${tex(n.z, 4)} - 0.003375 \\times ${tex(n.z, 4)}^{2}}`,
      value: n.M,
      note: `z ≤ ${MODIFIED_B31G_Z_CUTOFF}`,
      basis: 'The Modified B31G polynomial bulging factor, fitted over a wider range of anomaly lengths than the Original square-root form.',
      tone: 'accent',
      governing: false,
      audit: { recomputed, matches: agrees(n.M, recomputed) },
    });
  } else {
    const recomputed = 0.032 * n.z + 3.3;
    steps.push({
      id: 'folias',
      name: 'Bulging factor (Folias)',
      formula: 'M = 0.032z + 3.3',
      substitution: `0.032 × ${num(n.z, 4)} + 3.3`,
      formulaTex: 'M = 0.032\\,z + 3.3',
      substitutionTex: `0.032 \\times ${tex(n.z, 4)} + 3.3`,
      value: n.M,
      note: `z > ${MODIFIED_B31G_Z_CUTOFF}`,
      basis: 'Past z = 50 the Modified polynomial turns over, so the method switches to the linear form to keep the factor increasing with length.',
      tone: 'accent',
      governing: false,
      audit: { recomputed, matches: agrees(n.M, recomputed) },
    });
  }

  // 6 — Flow stress. The printed constant is the real one: SMYS + 10 ksi is
  // 68.9476 MPa, and rounding it to 69 in the substitution left the working
  // producing a slightly different number than the result beside it.
  const flowRecomputed = usesUplift ? n.smys + uplift : 1.1 * n.smys;
  steps.push({
    id: 'flow-stress',
    name: 'Flow stress',
    formula: usesUplift ? 'S_flow = SMYS + 10 ksi' : 'S_flow = 1.1 × SMYS',
    substitution: usesUplift
      ? `${num(n.smys, 1)} + ${num(uplift, 4)}`
      : `1.1 × ${num(n.smys, 1)}`,
    formulaTex: usesUplift
      ? '\\Sflow = \\SMYS + 10\\,\\mathrm{ksi}'
      : '\\Sflow = 1.1 \\times \\SMYS',
    substitutionTex: usesUplift
      ? `${tex(n.smys, 1)} + ${tex(uplift, 4)}`
      : `1.1 \\times ${tex(n.smys, 1)}`,
    value: n.sflow,
    unit: 'MPa',
    basis: usesUplift
      ? 'The Modified B31G flow stress: specified minimum yield plus a 10 ksi uplift, which is 68.9476 MPa. The uplift is defined in ksi, so the MPa figure is the converted constant rather than a rounded 69.'
      : 'The Original B31G flow stress, 1.1 × SMYS — a nominal collapse stress between yield and ultimate, not a measured material property.',
    tone: 'default',
    governing: false,
    audit: { recomputed: flowRecomputed, matches: agrees(n.sflow, flowRecomputed) },
  });

  // 7 — Failure stress. This is the failure stress, not the flow stress; the
  // trace used to give both steps the same name.
  const areaRatio = k * n.dt;
  const sfRecomputed = longOriginal
    ? n.sflow * (1 - n.dt)
    : (n.sflow * (1 - areaRatio)) / (1 - areaRatio / (n.M ?? 1));
  steps.push({
    id: 'failure-stress',
    name: 'Failure stress',
    formula: longOriginal
      ? 'S_F = S_flow × (1 − d/t)'
      : `S_F = S_flow × (1 − ${kLabel}·d/t) / (1 − ${kLabel}·d/t / M)`,
    substitution: longOriginal
      ? `${num(n.sflow, 4)} × (1 − ${num(n.dt, 4)})`
      : `${num(n.sflow, 4)} × (1 − ${num(k, 4)} × ${num(n.dt, 4)}) / (1 − ${num(k, 4)} × ${num(n.dt, 4)} / ${num(n.M ?? 1, 4)})`,
    // The one equation on this screen that most needed typesetting: written on
    // a single line with slashes, the nested d/t inside the denominator's own
    // division reads as three different groupings depending on who is looking.
    formulaTex: longOriginal
      ? '\\Sfail = \\Sflow\\left(1 - \\frac{d}{t}\\right)'
      : `\\Sfail = \\Sflow\\,\\frac{1 - ${kTex}\\,\\frac{d}{t}}`
        + `{1 - \\frac{${kTex}\\,\\frac{d}{t}}{M}}`,
    substitutionTex: longOriginal
      ? `${tex(n.sflow, 4)}\\left(1 - ${tex(n.dt, 4)}\\right)`
      : `${tex(n.sflow, 4)}\\,\\frac{1 - ${tex(k, 4)} \\times ${tex(n.dt, 4)}}`
        + `{1 - \\frac{${tex(k, 4)} \\times ${tex(n.dt, 4)}}{${tex(n.M ?? 1, 4)}}}`,
    value: n.Sf,
    unit: 'MPa',
    basis: longOriginal
      ? 'Remaining strength with the metal loss taken as a full-depth rectangle over the whole length.'
      : isOriginal
        ? 'ASME B31G-2023 para. 2.2: the metal loss is idealised as a parabola, so the lost area is ⅔ of the depth × length box.'
        : 'Modified B31G idealises the metal loss as 0.85 of the depth × length box — closer to real corrosion than either the parabola or the rectangle.',
    tone: 'accent',
    governing: false,
    audit: { recomputed: sfRecomputed, matches: agrees(n.Sf, sfRecomputed) },
  });

  // 8 — Failure pressure.
  const pfRecomputed = (2 * n.Sf * n.wall) / n.od;
  steps.push({
    id: 'failure-pressure',
    name: 'Estimated failure pressure',
    formula: 'P_F = 2 × S_F × t / D',
    substitution: `2 × ${num(n.Sf, 4)} × ${num(n.wall, 2)} / ${num(n.od, 1)}`,
    formulaTex: '\\Pfail = \\frac{2\\,\\Sfail\\,t}{D}',
    substitutionTex: `\\frac{2 \\times ${tex(n.Sf, 4)} \\times ${tex(n.wall, 2)}}{${tex(n.od, 1)}}`,
    value: n.Pf,
    unit: 'MPa',
    basis: 'The failure stress turned back into a pressure through the Barlow relation on the outside diameter. This is an estimate of the pressure at which the corroded pipe would fail, carrying no margin.',
    tone: 'default',
    governing: true,
    audit: { recomputed: pfRecomputed, matches: agrees(n.Pf, pfRecomputed) },
  });

  // 9 — Operating hoop stress.
  const soRecomputed = (n.p0 * n.od) / (2 * n.wall);
  steps.push({
    id: 'hoop-stress',
    name: 'Hoop stress at required pressure',
    formula: 'S₀ = P₀ × D / (2t)',
    substitution: `${num(n.p0, 3)} × ${num(n.od, 1)} / (2 × ${num(n.wall, 2)})`,
    formulaTex: '\\Shoop = \\frac{\\Pop\\,D}{2\\,t}',
    substitutionTex: `\\frac{${tex(n.p0, 3)} \\times ${tex(n.od, 1)}}{2 \\times ${tex(n.wall, 2)}}`,
    value: n.So,
    unit: 'MPa',
    basis: `The stress the sound wall carries at the required pressure (${pressureBasisLabel(config)}). Shown for context: the acceptance criterion below is applied on pressures, not on this stress.`,
    tone: 'default',
    governing: false,
    audit: { recomputed: soRecomputed, matches: agrees(n.So, soRecomputed) },
  });

  // 10 — Safe pressure. The engine divides by the safety factor. The trace used
  // to print a multiplication by the design factor, which only coincides when
  // SF happens to be exactly 1/DF.
  const safeRecomputed = n.Pf / n.SF;
  steps.push({
    id: 'safe-pressure',
    name: 'Safe operating pressure',
    formula: 'P_S = P_F / SF',
    substitution: `${num(n.Pf, 4)} / ${num(n.SF, 4)}`,
    formulaTex: '\\Psafe = \\frac{\\Pfail}{\\SFac}',
    substitutionTex: `\\frac{${tex(n.Pf, 4)}}{${tex(n.SF, 4)}}`,
    value: n.safePressure,
    unit: 'MPa',
    basis: 'ASME B31G-2023 para. 2.2 Step 8: the estimated failure pressure reduced by the safety factor from step 1. This is the pressure the assessment stands behind for this feature.',
    tone: 'good',
    governing: true,
    audit: { recomputed: safeRecomputed, matches: agrees(n.safePressure, safeRecomputed) },
  });

  // 11 — ERF, as the engine defines it.
  const erfRecomputed = n.safePressure > 0 ? n.p0 / n.safePressure : Number.POSITIVE_INFINITY;
  steps.push({
    id: 'erf',
    name: 'Estimated repair factor',
    formula: 'ERF = P₀ / P_S',
    substitution: `${num(n.p0, 3)} / ${num(n.safePressure, 4)}`,
    formulaTex: '\\ERF = \\frac{\\Pop}{\\Psafe}',
    substitutionTex: `\\frac{${tex(n.p0, 3)}}{${tex(n.safePressure, 4)}}`,
    value: n.ERF,
    basis: 'How much of the safe pressure the required pressure consumes. ERF is an operator convention layered on the code, not a B31G term — the criterion in para. 2.2 Step 8 is that the safe pressure equals or exceeds the required pressure, and ERF ≥ 1 is the same statement inverted.',
    tone: n.ERF >= 1 ? 'bad' : n.ERF >= screening.reviewBandErf ? 'warn' : 'good',
    governing: true,
    audit: { recomputed: erfRecomputed, matches: agrees(n.ERF, erfRecomputed) },
  });

  // 12 — Acceptance.
  const depthPasses = n.maxDepthPct < depthLimitPct;
  const erfPasses = n.ERF < 1;
  steps.push({
    id: 'acceptance',
    name: 'Acceptance',
    formula: `ERF < 1 and depth < ${num(depthLimitPct, 0)} %WT`,
    substitution: `ERF ${num(n.ERF, 4)} ${erfPasses ? '✓' : '✗'} · depth ${num(n.maxDepthPct, 2)} %WT ${depthPasses ? '✓' : '✗'}`,
    formulaTex:
      `\\ERF < 1 \\quad\\text{and}\\quad d_{\\%} < ${num(depthLimitPct, 0)}\\,\\%\\mathrm{WT}`,
    substitutionTex:
      `\\ERF = ${tex(n.ERF, 4)}${texMark(erfPasses)}`
      + `\\quad\\text{and}\\quad d_{\\%} = ${tex(n.maxDepthPct, 2)}\\,\\%\\mathrm{WT}`
      + `${texMark(depthPasses)}`,
    value: null,
    display: n.acceptance === 'Acceptable' ? 'Acceptable' : 'Not acceptable',
    basis: `ERF exactly 1.0 is the safe-pressure limit itself, so it does not pass. The ${num(depthLimitPct, 0)} %WT gate is a project rejection line, not a B31G applicability limit — para. 1.2(f) permits evaluation at any depth provided the sizing accuracy and the effective corrosion rate are justified, and it is the section 3 tables that stop at 80 %.`,
    tone: n.acceptance === 'Acceptable' ? 'good' : 'bad',
    governing: true,
    audit: {
      recomputed: null,
      matches: (erfPasses && depthPasses) === (n.acceptance === 'Acceptable'),
    },
  });

  // 13-15 — the projection. These steps carry the most assumption in the whole
  // assessment and used to carry none of its protection: the trace stopped at
  // acceptance, so the growth rate and the remnant life were the two figures a
  // reviewer could not check against their own working. A rate the growth
  // ladder substituted is exactly the number that most needs its derivation
  // printed beside it.
  const life = n.remnantLife;
  const depthRate = resolvedDepthRate(n);
  const lengthRate = resolvedLengthRate(n);
  const basisLabel = growthAnalysisBasisLabel(n.growthEvidence?.depth.analysisBasis);

  steps.push({
    id: 'growth-rate',
    name: 'Depth growth rate used',
    formula: 'CR_d resolved by the growth ladder',
    substitution: n.growthEvidence?.depth.formula ?? basisLabel,
    formulaTex: '\\CRd',
    substitutionTex: texText(basisLabel),
    value: depthRate,
    unit: 'mm/y',
    basis: n.growthEvidence?.depth.note
      ?? 'No structured growth provenance was attached to this row.',
    tone: n.growthEvidence?.depth.analysisBasis === 'reported' ? 'good' : 'warn',
    governing: false,
    audit: {
      // The projection is the authority: this step exists to show that the rate
      // printed here is the one the remnant life beside it was run on.
      recomputed: life.depthRateMmPerYear,
      matches: agrees(depthRate, life.depthRateMmPerYear),
    },
  });

  const depthLimitMm = (life.depthLimitPct / 100) * n.wall;
  const depthLimitRecomputed = depthRate > 0 && n.d < depthLimitMm
    ? (depthLimitMm - n.d) / depthRate
    : null;
  const depthLimitInHorizon = depthLimitRecomputed !== null
    && depthLimitRecomputed <= life.analysisHorizonYears;
  steps.push({
    id: 'years-to-depth-limit',
    name: `Years to ${num(life.depthLimitPct, 0)} %WT`,
    formula: `(${num(life.depthLimitPct, 0)}% x t - d) / CR_d`,
    substitution: depthLimitRecomputed === null
      ? 'No positive depth rate, so the depth limit is never reached'
      : `(${num(depthLimitMm, 3)} - ${num(n.d, 3)}) / ${num(depthRate, 4)}`,
    formulaTex: `\\frac{${num(life.depthLimitPct, 0)}\\% \\times t - d}{\\CRd}`,
    substitutionTex: depthLimitRecomputed === null
      ? texText('no positive depth rate')
      : `\\frac{${tex(depthLimitMm, 3)} - ${tex(n.d, 3)}}{${tex(depthRate, 4)}}`,
    value: life.depthLimitYears,
    unit: life.depthLimitYears === null ? undefined : 'y',
    display: life.depthLimitYears === null
      ? `Not reached in ${life.analysisHorizonYears} y`
      : undefined,
    basis: 'The depth line is a project rejection threshold and the applicability boundary of the section 3 tables. Reported only where it falls inside the analysis horizon.',
    tone: 'default',
    governing: false,
    audit: {
      recomputed: depthLimitInHorizon ? depthLimitRecomputed : null,
      // Null on both sides is agreement: the limit lies outside the horizon.
      matches: agreesYears(life.depthLimitYears, depthLimitInHorizon ? depthLimitRecomputed : null),
    },
  });

  const earlierLimit = life.depthLimitYears === null && life.erfLimitYears === null
    ? null
    : Math.min(
      life.depthLimitYears ?? Number.POSITIVE_INFINITY,
      life.erfLimitYears ?? Number.POSITIVE_INFINITY,
    );
  steps.push({
    id: 'remnant-life',
    name: 'Remnant life',
    formula: 'min(years to depth limit, years to ERF 1)',
    substitution: `depth ${life.depthLimitYears ?? 'not reached'} · ERF ${life.erfLimitYears ?? 'not reached'}`,
    formulaTex: '\\min(t_{d}, t_{\\ERF})',
    substitutionTex: texText(
      lengthRate === null
        ? 'axial length held constant, so the ERF limit is non-conservative in the length direction'
        : `axial length grows at ${num(lengthRate, 4)} mm/y`,
    ),
    value: life.years,
    unit: life.years === null ? undefined : 'y',
    display: life.years === null
      ? formatLifeProjection(life.years, life.status, life.analysisHorizonYears)
      : undefined,
    basis: life.lengthHeldConstant
      ? 'Projected with the axial length held constant, because no length growth rate was established. A defect that lengthens loses capacity through the Folias term as well, and that path is not in this figure.'
      : 'Projected with both dimensions growing, so the Folias term tracks the lengthening as well as the deepening.',
    tone: life.lengthHeldConstant ? 'warn' : 'default',
    governing: true,
    audit: {
      recomputed: life.designLifeCapApplied ? life.years : earlierLimit,
      matches: life.designLifeCapApplied || agreesYears(life.years, earlierLimit),
    },
  });

  return steps.map((step, index) => ({ ...step, index: index + 1 }));
}

/**
 * The steps whose printed working does not reproduce their printed result.
 *
 * Empty is the only acceptable answer. The test suite asserts this across the
 * method and safety-factor combinations, so a formula string and the maths it
 * describes cannot drift apart unnoticed again.
 */
export function verifyCalcTrace(steps: FfsCalcStep[]): FfsCalcStep[] {
  return steps.filter((step) => !step.audit.matches);
}
