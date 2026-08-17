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

import type { FfsConfig } from './types.ts';

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
