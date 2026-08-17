/**
 * The screening rules, written as the arithmetic they are.
 *
 * This module is a semi-quantitative assessment, so most of what it does is
 * pick a category from a table — and the pages say so in prose, which is right.
 * But four of the rules are genuinely arithmetic, and each one had been
 * paraphrased rather than stated:
 *
 * - the safety consequence is the *lower* of hazard and exposure, which the
 *   panel explained in three sentences and a river crossing;
 * - the probability is the worst of four independent readings of the same
 *   section, which nothing on the screen said at all;
 * - a judged threat's category is a base plus a coverage adjustment, floored;
 * - the interval is half the remaining life under two caps.
 *
 * Prose is the right medium for *why* each rule is what it is, and every one of
 * those sentences stays. What the prose could not do is say precisely which
 * combination of four numbers produced the category in the badge, and that is
 * the first question a reviewer asks. Both, then: the rule in symbols and the
 * reason in words.
 *
 * `api580.ts` remains the only place the numbers live. Nothing here is used to
 * compute anything — if a constant in that file changes, these strings describe
 * the shape of the rule, not its thresholds.
 */

export const RBI_TEX = {
  /**
   * Probability: the worst of four readings, three measured off the filed B31G
   * assessment and one judged per threat.
   */
  probability:
    '\\mathrm{P} = \\max\\left(\\mathrm{P}_{\\ERF},\\; \\mathrm{P}_{\\text{life}},\\;'
    + ' \\mathrm{P}_{\\text{depth}},\\; \\max_{i}\\,\\mathrm{P}_{\\text{threat},\\,i}\\right)',

  /** A judged threat: relevance, adjusted by what the inspection would have found. */
  threatCategory:
    '\\mathrm{P}_{\\text{threat}} = \\mathrm{clamp}_{1}^{5}'
    + '\\left(\\mathrm{P}_{\\text{relevance}} + \\Delta_{\\text{coverage}}\\right)',

  /**
   * Safety: a hurt person needs both a hazardous fluid and somebody within
   * reach of it, which is a minimum and not a maximum.
   */
  safety: '\\mathrm{C}_{\\text{safety}} = \\min\\left(H_{\\text{fluid}},\\; E_{\\text{exposure}}\\right)',

  /** Exposure never falls below the responder who has to walk up to the release. */
  exposure:
    'E_{\\text{exposure}} = \\max\\left(E_{\\text{population}},\\; E_{\\text{responder}}\\right)',

  /** Consequence: the worst of the three, raised once by a large stored energy. */
  consequence:
    '\\mathrm{C} = \\mathrm{clamp}_{1}^{5}\\Big('
    + '\\max\\left(\\mathrm{C}_{\\text{safety}},\\; \\mathrm{C}_{\\text{env}},\\;'
    + ' \\mathrm{C}_{\\text{business}}\\right) + \\big[\\,\\Phi \\ge 3\\,\\big]\\Big)',

  /** Stored energy, as a coarse proxy for how fast and how far a release reaches. */
  releaseScale: '\\Phi = \\frac{D}{1000}\\,\\Pop',

  /** The matrix is a lookup, not a product — that asymmetry is the decision. */
  risk: '\\mathrm{R} = \\mathrm{M}\\left(\\mathrm{P},\\, \\mathrm{C}\\right)',

  /** Half the remaining life, capped by the risk level and then by any legal limit. */
  interval:
    'T = \\min\\left(\\tfrac{1}{2}\\,L_{\\text{remaining}},\\; T_{\\mathrm{R}},\\;'
    + ' T_{\\text{regulatory}}\\right)',
} as const;
