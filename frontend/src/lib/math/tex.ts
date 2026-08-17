/**
 * Building TeX out of values that came from an engine.
 *
 * The substitution lines in this application are assembled at runtime from
 * measured numbers, so two things have to be handled that a hand-written
 * formula never hits. A non-finite result has to become `\infty` rather than
 * the character `∞` sitting loose in a math list, and any prose spliced in
 * beside the numbers has to survive TeX's special characters — an unescaped
 * percent sign in math mode starts a comment and silently swallows the rest of
 * the expression, which on a percent-of-wall figure is exactly the character we
 * are most likely to be carrying.
 *
 * Text mode and math mode need different treatment, and this is the trap worth
 * naming: MathJax renders the body of `\text{…}` literally. `\%` inside a
 * `\text` group does not produce a percent sign, it produces a backslash
 * followed by one. So the two escapers below are genuinely different functions,
 * and using the math one inside `\text` puts stray backslashes on the screen.
 *
 * Kept separate from the renderer so formula sources can be unit-tested without
 * pulling MathJax in.
 */

/** TeX for a number, fixed to `digits`, with the non-finite cases spelled out. */
export function texNumber(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '\\text{--}';
  if (!Number.isFinite(value)) return value > 0 ? '\\infty' : '-\\infty';
  return value.toFixed(digits);
}

const MATH_SPECIALS: Record<string, string> = {
  '%': '\\%',
  '&': '\\&',
  '#': '\\#',
  $: '\\$',
  _: '\\_',
};

/**
 * Escapes the characters TeX reads as syntax in **math** mode.
 *
 * `^`, `~` and `\` are dropped rather than escaped: there is no short, reliable
 * spelling of them in MathJax's math mode, and no quantity in this application
 * carries one. Losing a stray character beats losing the equation after it.
 */
export function escapeMathTex(text: string): string {
  return text
    .replace(/[\\^~]/g, ' ')
    .replace(/[%&#$_]/g, (character) => MATH_SPECIALS[character] ?? character);
}

/**
 * Prose inside a math expression, set upright.
 *
 * The body of `\text{}` is literal, so the only characters that need handling
 * are the ones that would end the group early — braces, a backslash, and a
 * dollar sign, which switches mode and loses everything after it.
 */
export function texText(text: string): string {
  return `\\text{${text.replace(/[\\{}$]/g, ' ')}}`;
}

/**
 * A quantity and its unit, the way a report writes one: upright unit behind a
 * thin space — `12.3\,\mathrm{mm}`, never `12.3mm`.
 */
export function texQuantity(
  value: number | null | undefined,
  digits: number,
  unit?: string,
): string {
  const magnitude = texNumber(value, digits);
  return unit ? `${magnitude}\\,\\mathrm{${escapeMathTex(unit)}}` : magnitude;
}

/** Percent, with the sign escaped so it does not start a TeX comment. */
export function texPercent(value: number | null | undefined, digits = 1): string {
  return `${texNumber(value, digits)}\\,\\%`;
}

/** Percent of wall thickness — the unit almost every depth in this app carries. */
export function texPercentWall(value: number | null | undefined, digits = 1): string {
  return `${texNumber(value, digits)}\\,\\%\\mathrm{WT}`;
}

/**
 * A pass or fail mark, for the acceptance lines that check two conditions.
 *
 * Colour is not available inside the glyph run, so the mark carries the whole
 * signal and has to be unambiguous at caption size.
 */
export function texMark(passed: boolean): string {
  return passed ? '\\;\\checkmark' : '\\;\\times';
}
