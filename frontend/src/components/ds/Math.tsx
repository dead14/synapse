/**
 * Typeset mathematics, at the size of the text around it.
 *
 * The proportion is the point of this file. MathJax emits an SVG measured in
 * `ex`, so an equation dropped into a caption comes out caption-sized and the
 * same equation in a step heading comes out heading-sized, with the x-height of
 * the glyphs matching the prose either way. That only holds if nothing here
 * pins a pixel size — so nothing does. `scale` exists for the one case the rule
 * does not cover: a fraction or a root inside a dense table row is taller than
 * the line it sits in, and a reader scanning a column wants it brought back to
 * the row rhythm rather than the row opened up around it.
 *
 * Two shapes, matching the two ways this application says something in symbols.
 * A stacked form-plus-substitution-plus-answer unit is deliberately *not* a
 * third: the one place that shape occurs is the FFS calculation trace, and that
 * step carries a tone, an index and a result column of its own, so composing
 * two `MathBlock`s there reads better than a component with eight props.
 *
 * - `MathInline` — inside a sentence. Text style, so a fraction stays on one
 *   line and the paragraph leading does not jump. Named for its position and
 *   not simply `Math`, which would shadow the global of that name in every
 *   file that imports it — half of which call `Math.max` a line later.
 * - `MathBlock` — a standalone equation on its own line. Display style, with
 *   full-height fractions and roots, and an optional tag on the right.
 *
 * Every one falls back to the TeX source in a monospace span if the expression
 * does not parse. A panel that renders `\frac{a}{b}` as literal text is ugly;
 * a panel that renders nothing has lost the engineer's number.
 */

import { useMemo, useSyncExternalStore } from 'react';

import {
  renderTex,
  subscribeTexEngine,
  texEngineGeneration,
  type TexRender,
} from '../../lib/math/mathjax';

export type MathScale = 'sm' | 'md' | 'lg';

/**
 * Typeset `tex`, re-running once the MathJax chunk lands.
 *
 * The engine is dynamically imported, so the first render of the first
 * equation on a page returns `null`. Subscribing to the load generation is what
 * turns that into a second render with the real thing — without it the
 * placeholder would stay on screen until something else happened to update the
 * component, which on a static results panel is never.
 */
function useTexRender(tex: string, display: boolean): TexRender | null {
  const generation = useSyncExternalStore(
    subscribeTexEngine,
    texEngineGeneration,
    texEngineGeneration,
  );
  // `generation` looks unused inside the callback and is the whole point of it:
  // `renderTex` reads module state that is empty until the chunk lands, so the
  // generation is what tells this memo that the same `tex` now has a different
  // answer. Dropping it leaves the placeholder frozen on screen.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => renderTex(tex, display), [tex, display, generation]);
}

interface MathProps {
  /** TeX source, without delimiters. */
  tex: string;
  /**
   * What the expression says, for anyone not reading the SVG — a screen reader,
   * or the tooltip on a dense row. Falls back to the TeX source, which is
   * closer to readable than the alternative of announcing nothing.
   */
  label?: string;
  /**
   * Nudges the equation off the surrounding font size. `md` is the default and
   * means "exactly the text around it"; `sm` pulls a tall expression back into
   * a table row, `lg` lifts a governing equation off the page.
   */
  scale?: MathScale;
  className?: string;
}

const SCALE_CLASS: Record<MathScale, string> = {
  sm: ' ds-math--sm',
  md: '',
  lg: ' ds-math--lg',
};

/**
 * What stands in for the equation when there is no SVG to show.
 *
 * Two different situations, deliberately given two different looks. While the
 * engine is still loading the caller's plain-text `label` is the same formula
 * in the notation this application used before any of this, so it is shown
 * quietly and reads as content. A parse failure has no plain-text twin to fall
 * back to, so the TeX source is shown in the danger colour — visible, because a
 * formula that silently disappears is the failure this component exists to
 * avoid.
 */
function MathFallback({
  tex,
  label,
  pending,
  className,
}: {
  tex: string;
  label?: string;
  pending: boolean;
  className?: string;
}) {
  return (
    <span
      className={
        `ds-math ds-math--raw${pending ? ' ds-math--pending' : ''}`
        + `${className ? ` ${className}` : ''}`
      }
      translate="no"
    >
      {pending ? (label ?? tex) : tex}
    </span>
  );
}

/**
 * Inline mathematics, sized to the text around it.
 */
export function MathInline({ tex, label, scale = 'md', className }: MathProps) {
  const render = useTexRender(tex, false);
  if (!render || render.failed) {
    return <MathFallback tex={tex} label={label} pending={!render} className={className} />;
  }

  return (
    <span
      className={`ds-math${SCALE_CLASS[scale]}${className ? ` ${className}` : ''}`}
      role="math"
      aria-label={label ?? tex}
      translate="no"
      dangerouslySetInnerHTML={{ __html: render.html }}
    />
  );
}

/**
 * A standalone equation on its own line, in display style.
 *
 * `tag` is the clause, step number or rule the equation answers to — set to the
 * right the way a numbered equation is, because on this application every
 * formula is supposed to be traceable to something.
 */
export function MathBlock({
  tex,
  label,
  tag,
  scale = 'md',
  align = 'left',
  className,
}: MathProps & { tag?: string; align?: 'left' | 'center' }) {
  const render = useTexRender(tex, true);

  return (
    <div
      className={
        `ds-math-block ds-math-block--${align}${SCALE_CLASS[scale]}`
        + `${className ? ` ${className}` : ''}`
      }
    >
      <div className="ds-math-block__body">
        {!render || render.failed ? (
          <MathFallback tex={tex} label={label} pending={!render} />
        ) : (
          <span
            className="ds-math"
            role="math"
            aria-label={label ?? tex}
            translate="no"
            dangerouslySetInnerHTML={{ __html: render.html }}
          />
        )}
      </div>
      {tag && <span className="ds-math-block__tag">{tag}</span>}
    </div>
  );
}

export default MathInline;
