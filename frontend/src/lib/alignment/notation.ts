/**
 * What the two matchers actually compute, in symbols.
 *
 * Alignment is the module where the gap between the words on screen and the
 * arithmetic underneath was widest. The tolerance-gated matcher's penalty was
 * captioned `weight × (difference ÷ tolerance)` under every channel in the
 * table — a sentence that leaves it open whether the difference is signed,
 * whether the ratio is squared, and whether the total is a sum or the worst
 * channel. The Bayesian matcher was worse off: a column headed `log LR`, a row
 * called `Prior log-odds`, a total called `log Bayes factor` and a confidence
 * that is the *lower* of two posteriors — four quantities in one table, related
 * by two equations that appeared nowhere.
 *
 * Both engines' evidence is reviewed by engineers who have to defend a growth
 * rate that depends on the pairing being right, and "trust the drawer" is not
 * an answer available to them. So the relations are stated.
 *
 * These strings describe the shape of each rule. The engines own the numbers,
 * and the drawer prints the engine's own values beside every symbol here.
 */

export const ALIGNMENT_TEX = {
  /**
   * One channel's contribution to the tolerance-gated cost.
   *
   * Written with the absolute difference over the tolerance, because that
   * normalisation is the reason channels in metres, millimetres and degrees can
   * be added together at all.
   */
  costChannel: 'c_{k} = w_{k}\\,\\frac{\\left|\\Delta_{k}\\right|}{\\tau_{k}}',

  /** The objective the solver minimises across the whole admissible set. */
  costTotal: 'C = \\sum_{k} w_{k}\\,\\frac{\\left|\\Delta_{k}\\right|}{\\tau_{k}}',

  /** The gate: a pair is not admitted at all unless every channel falls inside it. */
  costGate: '\\left|\\Delta_{k}\\right| \\le \\tau_{k} \\quad \\text{for every } k',

  /**
   * The section's displacement, fitted from the densest agreement among all
   * proposed old-to-new shifts.
   */
  drift: 'x_{\\text{new}} \\approx s\\,x_{\\text{old}} + \\delta',

  /** The noise scale, measured from the supporting residuals rather than set. */
  sigma:
    '\\sigma = \\operatorname{spread}\\left\\{\\,x_{\\text{new},i}'
    + ' - \\left(s\\,x_{\\text{old},i} + \\delta\\right)\\,\\right\\}',

  /**
   * One channel's evidence: how much more likely this reading is under "same
   * defect" than under "two unrelated defects that happen to lie near here".
   */
  logLikelihoodRatio:
    '\\log \\mathrm{LR}_{k} = \\log \\frac{p\\!\\left(\\Delta_{k} \\mid \\text{same}\\right)}'
    + '{p\\!\\left(\\Delta_{k} \\mid \\text{coincidence}\\right)}',

  /** Evidence adds; the prior is where the sum starts, not a separate step. */
  logBayesFactor:
    '\\log B = \\log \\frac{p}{1 - p} + \\sum_{k} \\log \\mathrm{LR}_{k}',

  /** Acceptance is a threshold on that total, not on any single channel. */
  acceptance: '\\log B > \\log B_{\\text{accept}}',

  /**
   * The reported confidence.
   *
   * The minimum, and this is the whole point of the step: a pair counts as
   * confident only when it is the best explanation of *both* defects. Taking
   * the mean, or either side alone, promotes a NEW defect that has no better
   * option even where the OLD defect plainly does.
   */
  posterior:
    'P\\!\\left(\\text{match}\\right) = \\min\\left(P_{\\text{old}},\\; P_{\\text{new}}\\right)',

  /** Each side normalised against its rivals and against "no match at all". */
  sidePosterior:
    'P_{\\text{side}} = \\frac{B}{B + \\sum_{r} B_{r} + 1}',

  /**
   * Odometer disagreement between the two runs over a common span, as the
   * simulator reports it.
   */
  odometerVariance:
    'v = \\left|\\frac{s_{\\text{old}}}{s_{\\text{new}}} - 1\\right| \\times 100\\,\\%',
} as const;
