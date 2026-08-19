/**
 * Every formula string in the application has to parse.
 *
 * The renderer is deliberately forgiving: `noundefined` is configured so that
 * an unknown macro degrades to red literal text rather than blanking the panel
 * an engineer is mid-review in. That is right on screen and useless in a test,
 * because it means `\Sfloww` would ship silently as the word "Sfloww" sitting
 * in the middle of an equation. So the suite parses every source through the
 * strict document instead, where an undefined control sequence is an error.
 *
 * The calculation trace is checked branch by branch against the same matrix
 * `ffsCalcTrace.test.ts` uses, because its TeX is assembled at runtime out of
 * measured numbers and the branch that only fires on a long Original-method
 * flaw is exactly the one nobody opens by hand.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { ensureTexEngine, renderTex, texParseError } from '../src/lib/math/mathjax.ts';
import { escapeMathTex, texNumber, texPercentWall, texText } from '../src/lib/math/tex.ts';
import { processRow } from '../src/lib/ffs/calcEngine.ts';
import { buildCalcTrace } from '../src/lib/ffs/calcTrace.ts';
import {
  areaTermTex,
  failureStressTex,
  FFS_TEX,
  flowStressTex,
  FOLIAS_TEX,
  remnantLifeWorking,
} from '../src/lib/ffs/notation.ts';
import { remnantLimitLabel } from '../src/lib/ffs/lifeProjection.ts';
import { RBI_TEX } from '../src/lib/rbi/notation.ts';
import { ALIGNMENT_TEX } from '../src/lib/alignment/notation.ts';
import { DEFAULT_SCREENING_CONFIG, type FfsConfig } from '../src/lib/ffs/types.ts';

// The engine is dynamically imported in the application so it does not weigh
// down the first page load. Nothing here can run until it has landed.
await ensureTexEngine();

function assertParses(tex: string, where: string): void {
  assert.equal(texParseError(tex), null, `${where}: ${tex}`);
}

/* ── The shared vocabularies ──────────────────────────────────────────────── */

test('every FFS notation constant parses', () => {
  for (const [key, tex] of Object.entries(FFS_TEX)) assertParses(tex, `FFS_TEX.${key}`);
  for (const [key, tex] of Object.entries(FOLIAS_TEX)) assertParses(tex, `FOLIAS_TEX.${key}`);
  for (const method of ['original', 'modified'] as const) {
    assertParses(areaTermTex(method), `areaTermTex(${method})`);
    assertParses(failureStressTex(method), `failureStressTex(${method})`);
  }
});

test('the flow-stress notation parses on every method and stress mode', () => {
  const base: FfsConfig = {
    lineName: 'L',
    method: 'modified',
    modifiedSa: 'smys69',
    iliDate: new Date('2024-01-01T00:00:00.000Z'),
    highlightYears: 10,
  };
  for (const method of ['original', 'modified'] as const) {
    for (const modifiedSa of ['smys69', 'smys11'] as const) {
      assertParses(flowStressTex({ ...base, method, modifiedSa }), `flowStressTex ${method}/${modifiedSa}`);
    }
  }
});

test('every RBI notation constant parses', () => {
  for (const [key, tex] of Object.entries(RBI_TEX)) assertParses(tex, `RBI_TEX.${key}`);
});

test('every alignment notation constant parses', () => {
  for (const [key, tex] of Object.entries(ALIGNMENT_TEX)) assertParses(tex, `ALIGNMENT_TEX.${key}`);
});

/* ── The trace, which is built at runtime ─────────────────────────────────── */

const traceConfig: FfsConfig = {
  lineName: 'Typesetting test line',
  method: 'modified',
  modifiedSa: 'smys69',
  iliDate: new Date('2024-01-01T00:00:00.000Z'),
  highlightYears: 10,
};

function row(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    'LD [m]': '1200',
    Section: 'S-01',
    Surface: 'External',
    'Max Depth [%]': '45',
    'Length [mm]': '120',
    'Width [mm]': '60',
    'Orient. (hrs:mins)': '06:00',
    'Nominal Wall Thickness [mm]': '9.53',
    'CR Depth [mm/y]': '0.10',
    'CR Length [mm/y]': '1.5',
    'Design Factor': '0.72',
    'Outer Diameter Ds': '508',
    'SMYS [MPa]': '359',
    'Operating Pressure P₀ [MPa]': '6.0',
    ...overrides,
  };
}

test('every step of the trace typesets on every method, stress mode and branch', () => {
  const cases: { method: FfsConfig['method']; sa: FfsConfig['modifiedSa']; length: string }[] = [
    { method: 'original', sa: 'smys11', length: '120' },   // z <= 20
    { method: 'original', sa: 'smys11', length: '900' },   // z > 20, no Folias term
    { method: 'modified', sa: 'smys69', length: '120' },   // z <= 50
    { method: 'modified', sa: 'smys11', length: '120' },
    { method: 'modified', sa: 'smys69', length: '1800' },  // z > 50, linear Folias
  ];

  for (const { method, sa, length } of cases) {
    for (const safetyFactor of ['', '1.25', '1.39']) {
      const scoped: FfsConfig = { ...traceConfig, method, modifiedSa: sa };
      const result = processRow(row({ 'Length [mm]': length, 'Safety Factor': safetyFactor }), scoped);
      const trace = buildCalcTrace(result, scoped, DEFAULT_SCREENING_CONFIG);
      const where = `${method}/${sa}/L${length}/SF${safetyFactor || 'derived'}`;

      for (const step of trace) {
        assert.notEqual(step.formulaTex, '', `${where}:${step.id} has no TeX form`);
        assertParses(step.formulaTex, `${where}:${step.id}.formulaTex`);
        if (step.substitutionTex) {
          assertParses(step.substitutionTex, `${where}:${step.id}.substitutionTex`);
        }
      }
    }
  }
});

/**
 * The remnant-life block, on every shape of projection it reports.
 *
 * Its equations are substituted from figures that are routinely null — a defect
 * with no axial rate, one that reaches no limit inside the horizon, one whose
 * reported life is the original design life rather than either B31G limit. Each
 * of those takes a different branch through the working, and a branch that only
 * fires on an unusual feature is the one an engineer opens under pressure and
 * the one nobody typeset by hand.
 */
test('every remnant-life equation typesets on every projection outcome', () => {
  const features: { where: string; overrides: Record<string, string> }[] = [
    { where: 'growing', overrides: {} },
    { where: 'shallow', overrides: { 'Max Depth [%]': '5', 'CR Depth [mm/y]': '0.001' } },
    { where: 'deep and long', overrides: { 'Max Depth [%]': '70', 'Length [mm]': '900' } },
  ];

  for (const method of ['original', 'modified'] as const) {
    for (const { where, overrides } of features) {
      const scoped: FfsConfig = { ...traceConfig, method };
      const result = processRow(row(overrides), scoped);
      const life = result.remnantLife;
      // The branches the intake cannot produce on its own: the axial rate and
      // the two limits are established downstream of the row, so they are
      // varied here rather than left to whichever case the sample data hits.
      const lives = [
        { label: 'as computed', life },
        { label: 'length held constant', life: { ...life, lengthHeldConstant: true } },
        {
          label: 'no limit reached',
          life: {
            ...life,
            years: null,
            dueDateIso: null,
            governingLimit: null,
            depthLimitYears: null,
            erfLimitYears: null,
          },
        },
        {
          label: 'design life cap',
          life: { ...life, designLifeCapApplied: true, designLifeYears: 25 },
        },
      ];

      for (const variant of lives) {
        for (const evidence of [result.growthEvidence, undefined]) {
          const working = remnantLifeWorking({
            result: { ...result, growthEvidence: evidence },
            life: variant.life,
            method,
            iliDateIso: '2024-01-01',
            governingLabel: remnantLimitLabel(variant.life),
            depthTolerancePct: DEFAULT_SCREENING_CONFIG.depthTolerancePct,
            lengthToleranceMm: DEFAULT_SCREENING_CONFIG.lengthToleranceMm,
          });
          const at = `${method}/${where}/${variant.label}/${evidence ? 'evidence' : 'no evidence'}`;

          for (const [key, line] of Object.entries(working)) {
            assert.notEqual(line.formulaTex, '', `${at}:${key} has no TeX form`);
            assertParses(line.formulaTex, `${at}:${key}.formulaTex`);
            if (line.substitutionTex) {
              assertParses(line.substitutionTex, `${at}:${key}.substitutionTex`);
            }
          }
        }
      }
    }
  }
});

/**
 * A feature whose safe pressure has collapsed produces a non-finite ERF. The
 * character `∞` loose in a math list is not the same thing as `\infty`, and the
 * substitution lines are assembled from engine output, so this is reachable.
 */
test('a non-finite result is spelled as an infinity, not as a stray character', () => {
  assert.equal(texNumber(Number.POSITIVE_INFINITY), '\\infty');
  assert.equal(texNumber(Number.NEGATIVE_INFINITY), '-\\infty');
  assert.equal(texNumber(null), '\\text{--}');
  assertParses(texNumber(Number.POSITIVE_INFINITY), 'texNumber(∞)');
});

/* ── Escaping ─────────────────────────────────────────────────────────────── */

test('a percent sign in math mode is escaped, so it cannot comment out the rest', () => {
  assert.equal(escapeMathTex('80 %WT'), '80 \\%WT');
  assertParses(`d = ${escapeMathTex('80 %WT')}`, 'escaped percent');
  assertParses(texPercentWall(45.2), 'texPercentWall');
});

/**
 * The body of `\text{}` is literal in MathJax, so the math-mode escaper must
 * not be used inside one: `\%` there renders as a backslash followed by a
 * percent sign rather than as a percent sign.
 */
test('prose in a text group keeps its punctuation and loses only its group breakers', () => {
  assert.equal(texText('80 %WT reached'), '\\text{80 %WT reached}');
  assert.equal(texText('a{b}c'), '\\text{a b c}');
  assertParses(texText('derived from the design factor'), 'texText');
});

/* ── The renderer itself ──────────────────────────────────────────────────── */

test('rendering produces a self-contained SVG with no external reference', () => {
  const render = renderTex(FFS_TEX.erf, true);

  assert.ok(render, 'the engine is loaded, so this must not be the pending sentinel');
  assert.equal(render.failed, false);
  assert.match(render.html, /<svg/);
  // Nothing may be fetched at runtime: this runs on plant networks with no
  // route to the internet, and an equation that needs a font from a CDN would
  // render as nothing on the one machine that matters.
  assert.doesNotMatch(render.html, /https?:\/\/(?!www\.w3\.org)/);
  assert.doesNotMatch(render.html, /<script/i);
});

test('a malformed expression fails rather than throwing', () => {
  const render = renderTex('\\dfrac{a}', false);
  assert.equal(render?.failed, true);
});
