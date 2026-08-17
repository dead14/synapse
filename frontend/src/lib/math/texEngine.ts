/**
 * MathJax itself — the heavy half, deliberately behind a dynamic import.
 *
 * This module is never imported statically. Everything in the application goes
 * through `mathjax.ts`, which pulls it in on first use, and the reason is
 * weight: the SVG output carries the TeX glyph outlines as path data, so this
 * file is about 1.6 MB raw. Bundled into the design system — where the maths
 * components live — that lands in the shared chunk every page imports a button
 * from, and the login screen would pay half a megabyte gzipped to render a
 * password field.
 *
 * Split off, it becomes a chunk of its own that arrives while the engineer is
 * still reading the panel around the equation.
 *
 * The three shaping decisions are here rather than at the call sites:
 *
 * 1. **Bundled, not from a CDN.** The plant networks this runs on are not
 *    guaranteed to reach the internet, and an assessment that renders its own
 *    equations as raw `\frac{}{}` on a site visit is worse than one that never
 *    used TeX. Nothing is fetched at runtime.
 *
 * 2. **SVG through the lite adaptor.** CHTML would need a web font and an
 *    injected stylesheet; SVG needs neither, and the markup is inert — no
 *    measurement pass, nothing for React to fight over.
 *
 * 3. **Only the packages the notation uses.** `AllPackages` would pull mhchem,
 *    physics, braket and the rest — a few hundred kilobytes of parser for
 *    macros no pipeline equation contains.
 */

import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';

// Imported for their registration side effects.
//
// `noundefined` matters more than it looks: without it an unknown macro throws
// out of the parser, so one typo in one formula string would take down the
// panel around it instead of showing a red token. `configmacros` is what makes
// the `macros` option below take effect at all.
import 'mathjax-full/js/input/tex/base/BaseConfiguration.js';
import 'mathjax-full/js/input/tex/ams/AmsConfiguration.js';
import 'mathjax-full/js/input/tex/newcommand/NewcommandConfiguration.js';
import 'mathjax-full/js/input/tex/noundefined/NoUndefinedConfiguration.js';
import 'mathjax-full/js/input/tex/configmacros/ConfigMacrosConfiguration.js';

const PACKAGES = ['base', 'ams', 'newcommand', 'noundefined', 'configmacros'];

/**
 * Shorthands for the quantities that recur across all three modules.
 *
 * Defined once, so that the flow stress is typeset identically in the FFS
 * trace, the corrosion envelope and the RBI evidence panel. A symbol that
 * changes shape between two screens reads as two different quantities.
 *
 * Multi-letter names are the reason most of these exist: TeX sets `SMYS` as a
 * product of four italic variables unless it is told the name is one upright
 * word.
 */
const MACROS: Record<string, string | [string, number]> = {
  ERF: '\\mathrm{ERF}',
  SMYS: '\\mathrm{SMYS}',
  MAOP: '\\mathrm{MAOP}',
  SFac: '\\mathrm{SF}',
  DFac: '\\mathrm{DF}',
  POF: '\\mathrm{POF}',
  COF: '\\mathrm{COF}',
  /** Corrosion rates, subscripted by the dimension they grow. */
  CRd: '\\mathrm{CR}_{d}',
  CRl: '\\mathrm{CR}_{L}',
  Sflow: 'S_{\\mathrm{flow}}',
  Sfail: 'S_{\\mathrm{F}}',
  Pfail: 'P_{\\mathrm{F}}',
  Psafe: 'P_{\\mathrm{S}}',
  Pop: 'P_{0}',
  Shoop: 'S_{0}',
  /** A unit, set upright behind a thin space, the way a report sets it. */
  unit: ['\\,\\mathrm{#1}', 1],
  /** A branch condition or aside carried alongside the expression. */
  cond: ['\\;\\text{(#1)}', 1],
};

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);

/**
 * Metrics for the layout pass.
 *
 * The SVG comes out measured in `ex`, so these set the expression's internal
 * proportions only — the element then scales with whatever font size it lands
 * in, which is what keeps an equation the same size as the prose around it.
 */
const METRICS = { em: 16, ex: 8, containerWidth: 1_200 } as const;

const forgiving = mathjax.document('', {
  InputJax: new TeX({ packages: PACKAGES, macros: MACROS }),
  // `local` keeps each container's glyph paths in its own `<defs>`, so a node
  // that is cloned, moved into a portal or re-parented still carries its font.
  OutputJax: new SVG({ fontCache: 'local' }),
});

/**
 * Typeset one expression, returning `null` if it could not be parsed.
 *
 * `display` selects display style — full-height fractions, roots and limits —
 * which is what a standalone equation wants. Inline math stays in text style so
 * it does not push apart the line it sits in.
 */
export function convertTex(tex: string, display: boolean): string | null {
  try {
    const node = forgiving.convert(tex, { display, ...METRICS });
    const html = adaptor.outerHTML(node);
    return html.includes('data-mjx-error') || html.includes('merror') ? null : html;
  } catch {
    // A formula string that cannot be parsed must not take the panel with it.
    return null;
  }
}

/**
 * A second, unforgiving parser — for the test suite only.
 *
 * `noundefined` is right on screen and wrong in a test. On screen an unknown
 * macro should degrade to red literal text so one bad formula string cannot
 * blank a panel an engineer is mid-review in. In a test that same leniency
 * means `\Sfloww` passes silently and ships as the word "Sfloww" sitting in the
 * middle of an equation, which is precisely the class of defect this whole
 * change exists to remove.
 *
 * Built on first use, because nothing in the running application calls it.
 */
let strict: ReturnType<typeof mathjax.document> | null = null;

export function parseError(tex: string): string | null {
  strict ??= mathjax.document('', {
    InputJax: new TeX({
      packages: PACKAGES.filter((name) => name !== 'noundefined'),
      macros: MACROS,
    }),
    OutputJax: new SVG({ fontCache: 'local' }),
  });

  try {
    const html = adaptor.outerHTML(strict.convert(tex, { display: false, ...METRICS }));
    return html.match(/data-mjx-error="([^"]*)"/)?.[1] ?? null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
