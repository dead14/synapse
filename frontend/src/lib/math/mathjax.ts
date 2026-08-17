/**
 * TeX to SVG — the facade the application uses, and the load boundary.
 *
 * Every equation this application shows an engineer — the B31G working in the
 * FFS drawer, the drift and cost channels behind an alignment match, the
 * probability and interval rules in the RBI screening — used to be a run of
 * Unicode characters inside a monospace paragraph. `S_F`, `√(1 + 0.8z)` and
 * `(depth% / 100) × t` are readable, but they are not typeset: a subscript that
 * is really an underscore does not sit below the baseline, a root has no
 * vinculum over its radicand, and a division written as a slash gives no visual
 * grouping at all. On a document that is signed and defended in a review that
 * matters, because the reader is left to reconstruct the precedence the
 * notation should have shown them.
 *
 * MathJax does the typesetting, and lives in `texEngine.ts` behind a dynamic
 * import. The SVG output carries glyph outlines as path data, so the engine is
 * about 1.6 MB; static, it would land in the shared chunk every page imports a
 * button from, and the login screen would pay half a megabyte gzipped to render
 * a password field. Loaded on first use it is a chunk of its own that arrives
 * while the engineer is still reading the panel around the equation.
 *
 * That is why `renderTex` can return `null`: not an error, just "not yet".
 * Callers subscribe through `subscribeTexEngine` and re-render when it lands.
 * Between the two they show the plain-text form of the same formula, which is
 * what the application displayed before any of this — so the worst case of a
 * slow chunk is the screen everyone has been reading for a year.
 *
 * Results are cached by (tex, display): a results table asks for the same
 * formula once per row, and the parse is the expensive part.
 */

import type { convertTex, parseError } from './texEngine.ts';

interface TexEngine {
  convertTex: typeof convertTex;
  parseError: typeof parseError;
}

export interface TexRender {
  /** `<mjx-container>` markup, safe to inject: MathJax emits no scripts. */
  html: string;
  /** True when the TeX did not parse, so the caller can fall back to text. */
  failed: boolean;
}

let engine: TexEngine | null = null;
let loading: Promise<TexEngine> | null = null;

/**
 * Bumped when the engine lands.
 *
 * `useSyncExternalStore` compares snapshots by identity, so this has to be a
 * value that changes rather than a boolean that flips — a component that
 * mounted before the engine arrived and one that mounted after must not read
 * the same snapshot and skip the re-render.
 */
let generation = 0;
const listeners = new Set<() => void>();

/** Loads MathJax, once. Safe to call from a render path — it does not block. */
export function ensureTexEngine(): Promise<TexEngine> {
  if (engine) return Promise.resolve(engine);
  loading ??= import('./texEngine.ts').then((module) => {
    engine = module;
    generation += 1;
    for (const listener of listeners) listener();
    return module;
  });
  return loading;
}

export function subscribeTexEngine(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The snapshot `useSyncExternalStore` watches. */
export function texEngineGeneration(): number {
  return generation;
}

const cache = new Map<string, TexRender>();

/** Above this the cache is cleared wholesale rather than evicted one by one. */
const CACHE_LIMIT = 4_000;

/**
 * Typeset one TeX expression, or `null` while the engine is still loading.
 *
 * `display` selects display style — full-height fractions, roots and limits —
 * which is what a standalone equation wants. Inline math stays in text style so
 * it does not push apart the line it sits in.
 */
export function renderTex(tex: string, display = false): TexRender | null {
  if (!engine) {
    void ensureTexEngine();
    return null;
  }

  const key = `${display ? 'D' : 'I'} ${tex}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const html = engine.convertTex(tex, display);
  const result: TexRender = { html: html ?? '', failed: html === null };

  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, result);
  return result;
}

/** Test seam, and the escape hatch if a formula source is ever hot-reloaded. */
export function clearTexCache(): void {
  cache.clear();
}

/**
 * The strict parse, for the test suite. Await `ensureTexEngine()` first.
 *
 * Throws rather than returning a "not loaded" sentinel, because a test that
 * silently reports "no error" for every formula because it forgot to await is
 * a test that passes while the notation rots.
 */
export function texParseError(tex: string): string | null {
  if (!engine) throw new Error('texParseError: await ensureTexEngine() first');
  return engine.parseError(tex);
}
