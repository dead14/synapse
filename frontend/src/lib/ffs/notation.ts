/**
 * One spelling per quantity, for the whole fitness-for-service module.
 *
 * The same three choices — which method, which flow stress, where the safety
 * factor came from — are echoed on the setup page, in the results header, in
 * the detail drawer, on the charts and in the narrative. Before this file each
 * of those wrote its own version: the Modified area term appeared as `0.85dL`
 * on one screen and `0.85 d·L` on another, and the Original one as `⅔dL`,
 * `2/3 d/t` and `⅔ of the depth × length box` depending on where you looked. A
 * reader cannot tell whether two different spellings are two different things,
 * so the answer is that there is only one spelling and it lives here.
 *
 * Plain-text twins are kept beside the TeX because the workbook and the Word
 * report have no typesetter and must not carry backslashes into a cell.
 */

import { texNumber, texPercentWall, texText } from '../math/tex.ts';
import type { FfsRemnantLife } from './remnantLife.ts';
import type { FfsConfig, FfsResult } from './types.ts';

/** The flow stress the selected method uses, typeset. */
export function flowStressTex(config: FfsConfig): string {
  if (config.method === 'original' || config.modifiedSa === 'smys11') {
    return '\\Sflow = 1.1 \\times \\SMYS';
  }
  return '\\Sflow = \\SMYS + 69\\,\\mathrm{MPa}';
}

/** The same choice in plain text, for exports. */
export function flowStressText(config: FfsConfig): string {
  if (config.method === 'original' || config.modifiedSa === 'smys11') return '1.1 × SMYS';
  return 'SMYS + 69 MPa';
}

/**
 * The idealised metal-loss area: a parabola for the Original method, a fixed
 * 0.85 of the depth × length box for the Modified one.
 */
export function areaTermTex(method: FfsConfig['method']): string {
  return method === 'original' ? '\\tfrac{2}{3}\\,d\\,L' : '0.85\\,d\\,L';
}

/** Remaining strength, on the branch where the bulging term applies. */
export function failureStressTex(method: FfsConfig['method']): string {
  const k = method === 'original' ? '\\tfrac{2}{3}' : '0.85';
  return `\\Sfail = \\Sflow\\,\\frac{1 - ${k}\\,\\frac{d}{t}}{1 - \\frac{${k}\\,\\frac{d}{t}}{M}}`;
}

/** The bulging factor, per method and branch. */
export const FOLIAS_TEX = {
  original: 'M = \\sqrt{1 + 0.8\\,z}',
  modifiedShort: 'M = \\sqrt{1 + 0.6275\\,z - 0.003375\\,z^{2}}',
  modifiedLong: 'M = 0.032\\,z + 3.3',
} as const;

/** The quantities every screen in the module shares. */
export const FFS_TEX = {
  normalisedLength: 'z = \\frac{L^{2}}{D\\,t}',
  depthRatio: '\\frac{d}{t}',
  failurePressure: '\\Pfail = \\frac{2\\,\\Sfail\\,t}{D}',
  safePressure: '\\Psafe = \\frac{\\Pfail}{\\SFac}',
  hoopStress: '\\Shoop = \\frac{\\Pop\\,D}{2\\,t}',
  erf: '\\ERF = \\frac{\\Pop}{\\Psafe}',
  /** The historic practice: a line at design factor F is assessed at SF = 1/F. */
  safetyFactorFromDesign: '\\SFac = \\frac{1}{F}',
  /** The para. 1.9 ratio, which is a supplied figure rather than a derived one. */
  safetyFactorFromHydrotest: '\\SFac = \\frac{P_{\\mathrm{hydrotest,\\,min}}}{\\MAOP}',
  /** Acceptance, as the code states it: capacity at or above demand. */
  acceptance: '\\Psafe \\ge \\Pop \\quad\\Longleftrightarrow\\quad \\ERF \\le 1',
} as const;
/** The general form of a figure, and the same form with real numbers in it. */
export interface FfsWorkingLine {
  formulaTex: string;
  /** Absent where the engine reported no number to substitute. */
  substitutionTex?: string;
}

/** Every figure the remnant-life block reports. */
export type FfsRemnantLifeWorkingKey =
  | 'remnantLife'
  | 'dueDate'
  | 'governingLimit'
  | 'depthLimit'
  | 'erfLimit'
  | 'toleranceAdjusted'
  | 'crDepth'
  | 'crLength'
  | 'erfAtLimit'
  | 'depthAtLimit'
  | 'failureStressAtLimit';

export interface FfsRemnantLifeWorkingInputs {
  result: FfsResult;
  life: FfsRemnantLife;
  method: FfsConfig['method'];
  /** Inspection date, already formatted, since the working prints it verbatim. */
  iliDateIso: string;
  /** The governing limit in words, as the screen names it. */
  governingLabel: string;
  /** Sizing tolerance the conservative case was run at, as %WT. */
  depthTolerancePct: number;
  /** Half the axial tolerance — the figure the screening config carries. */
  lengthToleranceMm: number;
}

/** A year figure for a math list, with the unreached case spelled out. */
function yearsTex(value: number | null): string {
  return value === null ? texText('not reached') : texNumber(value, 2);
}

/**
 * The working behind every remnant-life figure on the detail drawer.
 *
 * It lives here rather than in the drawer for the reason the rest of this file
 * exists: an expression assembled inline in JSX is one nobody can typeset in a
 * test, and the remnant-life block is where the arithmetic is least obvious —
 * a life is the minimum of two limits found two different ways, and the state
 * at the due date is the same B31G evaluation run against projected geometry.
 * Every line below is substituted from figures the engine reported, so the
 * printed working reproduces the number beside it rather than asserting it.
 */
export function remnantLifeWorking(
  inputs: FfsRemnantLifeWorkingInputs,
): Record<FfsRemnantLifeWorkingKey, FfsWorkingLine> {
  const { result: n, life, method, iliDateIso, governingLabel } = inputs;
  const depthLimitRatio = (life.depthLimitPct / 100).toFixed(2);
  const kTex = method === 'original' ? '\\tfrac{2}{3}' : '0.85';

  // The candidates the reported life is the minimum of. The design-life cap is
  // only a term where it applied: printing it on every feature would put a
  // limit in the equation that did not constrain anything.
  const terms = [
    { symbol: 't_{\\text{depth}}', value: yearsTex(life.depthLimitYears) },
    { symbol: 't_{\\ERF}', value: yearsTex(life.erfLimitYears) },
    // Where the cap bound, the reported life *is* the design life remaining at
    // the inspection, so that is the figure the minimum is taken over. Printing
    // the line's total design life here left a sum that does not produce the
    // answer under it: a 25-year dossier on a line already past its design life
    // read `min(1.52, 2.00, 25.00) = 0.00`.
    ...(life.designLifeCapApplied
      ? [{ symbol: 't_{\\text{design}}', value: yearsTex(life.years) }]
      : []),
  ];
  const formTex = terms.map((term) => term.symbol).join(',\\; ');
  const valuesTex = terms.map((term) => term.value).join(',\\; ');

  // The safe pressure the ERF at the limit date was measured against, recovered
  // from the failure stress the engine reported there through the same two
  // relations as steps 8 and 10.
  const safeAtLimit =
    n.atFailure_Sf === null ? null : (2 * n.atFailure_Sf * n.wall) / n.od / n.SF;
  const depthRatioAtLimit = n.atFailure_depth === null ? null : n.atFailure_depth / 100;

  return {
    remnantLife: {
      formulaTex:
        `t_{\\text{remnant}} = \\min\\left(${formTex}\\right)`
        + (life.designLifeCapApplied
          ? '\\cond{design life remaining at the inspection}'
          : ''),
      substitutionTex: `\\min\\left(${valuesTex}\\right) = ${yearsTex(life.years)}\\unit{y}`,
    },
    dueDate: {
      formulaTex: 't_{\\text{due}} = t_{\\mathrm{ILI}} + t_{\\text{remnant}}',
      substitutionTex:
        `${texText(iliDateIso)} + ${yearsTex(life.years)}\\unit{y}`
        + ` = ${texText(life.dueDateIso ?? 'no date')}`,
    },
    governingLimit: {
      formulaTex: `\\text{governing} = \\arg\\min\\left(${formTex}\\right)`,
      substitutionTex: `\\arg\\min\\left(${valuesTex}\\right) = ${texText(governingLabel)}`,
    },
    depthLimit: {
      formulaTex:
        `t_{\\text{depth}} = \\frac{\\left(${depthLimitRatio} - \\frac{d}{t}\\right) t}{\\CRd}`,
      substitutionTex:
        `\\frac{\\left(${depthLimitRatio} - ${texNumber(n.dt, 4)}\\right)`
        + ` \\times ${texNumber(n.wall, 2)}}{${texNumber(life.depthRateMmPerYear, 4)}}`
        + ` = ${yearsTex(life.depthLimitYears)}\\unit{y}`,
    },
    erfLimit: {
      formulaTex:
        '\\ERF\\left(d(t),\\,L(t)\\right) = 1,\\quad d(t) = d + \\CRd\\,t,\\quad '
        + (life.lengthHeldConstant ? 'L(t) = L' : 'L(t) = L + \\CRl\\,t'),
      substitutionTex: `${yearsTex(life.erfLimitYears)}\\unit{y}\\cond{found by bisection}`,
    },
    toleranceAdjusted: {
      formulaTex: 't_{\\text{remnant}}\\big|_{d + \\Delta d,\\; L + \\Delta L}',
      substitutionTex:
        `t_{\\text{remnant}}\\big|_{d + ${texPercentWall(inputs.depthTolerancePct, 0)},\\;`
        + ` L + ${texNumber(2 * inputs.lengthToleranceMm, 0)}\\unit{mm}}`,
    },
    crDepth: {
      formulaTex: '\\CRd = \\frac{d_{\\text{new}} - d_{\\text{old}}}{\\Delta t}',
      substitutionTex: n.growthEvidence?.depth.formula
        ? `${texText(n.growthEvidence.depth.formula)}`
          + ` = ${texNumber(life.depthRateMmPerYear, 3)}\\unit{mm/y}`
        : `${texNumber(life.depthRateMmPerYear, 3)}\\unit{mm/y}\\cond{supplied on the row}`,
    },
    // A rate that was never established is spelled out, never printed as
    // 0.000 mm/y. The zero reads as a measurement that this defect is not
    // lengthening, which is the one thing nobody measured.
    crLength: {
      formulaTex: '\\CRl = \\frac{L_{\\text{new}} - L_{\\text{old}}}{\\Delta t}',
      substitutionTex: life.lengthHeldConstant
        ? texText('no usable axial rate, so length is held constant')
        : n.growthEvidence?.length.formula
          ? `${texText(n.growthEvidence.length.formula)}`
            + ` = ${texNumber(life.lengthRateMmPerYear, 3)}\\unit{mm/y}`
          : `${texNumber(life.lengthRateMmPerYear, 3)}\\unit{mm/y}`,
    },
    erfAtLimit: {
      formulaTex:
        '\\ERF\\big|_{t_{\\text{remnant}}}'
        + ' = \\frac{\\Pop}{\\Psafe\\big|_{t_{\\text{remnant}}}}',
      substitutionTex:
        safeAtLimit === null
          ? undefined
          : `\\frac{${texNumber(n.p0, 3)}}{${texNumber(safeAtLimit, 4)}}`
            + ` = ${texNumber(n.atFailure_ERF, 4)}`,
    },
    depthAtLimit: {
      formulaTex: 'd_{\\%} = \\frac{d + \\CRd\\,t_{\\text{remnant}}}{t}\\times 100',
      substitutionTex:
        `\\frac{${texNumber(n.d, 3)} + ${texNumber(life.depthRateMmPerYear, 4)}`
        + ` \\times ${yearsTex(life.years)}}{${texNumber(n.wall, 2)}}\\times 100`
        + ` = ${texNumber(n.atFailure_depth, 2)}\\,\\%`,
    },
    failureStressAtLimit: {
      formulaTex:
        `\\Sfail\\big|_{t_{\\text{remnant}}} = \\Sflow\\,`
        + `\\frac{1 - ${kTex}\\,\\frac{d(t)}{t}}{1 - \\frac{${kTex}\\,\\frac{d(t)}{t}}{M(t)}}`,
      substitutionTex:
        depthRatioAtLimit === null
          ? undefined
          : `\\frac{d(t)}{t} = ${texNumber(depthRatioAtLimit, 4)}`
            + ` \\Rightarrow ${texNumber(n.atFailure_Sf, 4)}\\unit{MPa}`,
    },
  };
}
