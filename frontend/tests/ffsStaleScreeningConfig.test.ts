/**
 * The Narrative tab took the whole workspace down with
 * "Cannot read properties of undefined (reading 'toFixed')".
 *
 * The results workspace receives its screening config through router
 * navigation state, which the browser stores in its history entry — so it
 * survives a reload, a back navigation, and a deploy. An entry written by an
 * earlier build comes back shaped the way that build wrote it, and the type
 * declares fields the value does not carry, because it never passed through a
 * parser. A config restored without `reviewBandErf` reached the narrative,
 * which quotes the review band directly, and the tab crashed.
 *
 * The repair is at the boundary rather than at each `.toFixed`, so the fix
 * covers every panel reading these fields instead of the one that happened to
 * crash first.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { processRow } from '../src/lib/ffs/calcEngine.ts';
import { screenResults } from '../src/lib/ffs/screening.ts';
import { buildNarrative, DEFAULT_NARRATIVE_OPTIONS } from '../src/lib/ffs/narrative.ts';
import { buildExecutiveSummary } from '../src/lib/ffs/executiveSummary.ts';
import { DEFAULT_DEPTH_BUCKETS } from '../src/lib/ffs/statistics.ts';
import type { FfsReportContext } from '../src/lib/ffs/reportCase.ts';
import {
  DEFAULT_SCREENING_CONFIG,
  normaliseScreeningConfig,
  type FfsConfig,
  type FfsScreeningConfig,
} from '../src/lib/ffs/types.ts';

const config: FfsConfig = {
  lineName: 'Stale config line',
  method: 'modified',
  modifiedSa: 'smys69',
  iliDate: new Date('2024-08-23T00:00:00.000Z'),
  highlightYears: 5,
};

const reportContext: FfsReportContext = {
  inspectionDateIso: '2024-08-23',
  asOfDateIso: '2026-08-05',
  reviewThresholdYears: 5,
};

function population() {
  const row = {
    'LD [m]': '10',
    Section: 'S-01',
    Surface: 'External',
    'Max Depth [%]': '30',
    'Length [mm]': '20',
    'Width [mm]': '30',
    'Orient. (hrs:mins)': '6:00',
    'Nominal Wall Thickness [mm]': '9.27',
    'CR Depth [mm/y]': '0.1',
    'CR Length [mm/y]': '0',
    'Design Factor': '0.72',
    'Outer Diameter Ds': '508',
    'SMYS [MPa]': '359',
    'Operating Pressure P₀ [MPa]': '6.0',
  };
  return [processRow(row, config)];
}

const FIELDS: (keyof FfsScreeningConfig)[] = [
  'depthTolerancePct',
  'lengthToleranceMm',
  'growthBasis',
  'growthRateMmPerYear',
  'forecastYears',
  'reviewBandErf',
  'interactionSpacingFactor',
  'depthRejectionPct',
];

test('a config restored without reviewBandErf no longer crashes the narrative', () => {
  const stale: Partial<FfsScreeningConfig> = { ...DEFAULT_SCREENING_CONFIG };
  delete stale.reviewBandErf;

  const screening = normaliseScreeningConfig(stale);
  assert.equal(screening.reviewBandErf, DEFAULT_SCREENING_CONFIG.reviewBandErf);

  const items = screenResults(population(), config, screening);
  const blocks = buildNarrative(items, config, screening, reportContext, DEFAULT_NARRATIVE_OPTIONS);
  assert.ok(blocks.length > 0);
});

test('every field can be absent and the narrative still renders', () => {
  for (const field of FIELDS) {
    const stale: Partial<FfsScreeningConfig> = { ...DEFAULT_SCREENING_CONFIG };
    delete stale[field];
    const screening = normaliseScreeningConfig(stale);
    const items = screenResults(population(), config, screening);

    assert.doesNotThrow(
      () => buildNarrative(items, config, screening, reportContext, DEFAULT_NARRATIVE_OPTIONS),
      `narrative threw with ${field} absent`,
    );
    assert.doesNotThrow(
      () => buildExecutiveSummary(items, config, screening, reportContext, DEFAULT_DEPTH_BUCKETS),
      `executive summary threw with ${field} absent`,
    );
  }
});

test('a wholly absent config falls back to the defaults', () => {
  assert.deepEqual(normaliseScreeningConfig(undefined), DEFAULT_SCREENING_CONFIG);
  assert.deepEqual(normaliseScreeningConfig(null), DEFAULT_SCREENING_CONFIG);
  assert.deepEqual(normaliseScreeningConfig({}), DEFAULT_SCREENING_CONFIG);
});

test('non-finite values are repaired, not carried into the prose', () => {
  const broken = normaliseScreeningConfig({
    reviewBandErf: Number.NaN,
    forecastYears: Number.POSITIVE_INFINITY,
    depthRejectionPct: undefined,
    growthBasis: 'nonsense' as never,
  });

  assert.equal(broken.reviewBandErf, DEFAULT_SCREENING_CONFIG.reviewBandErf);
  assert.equal(broken.forecastYears, DEFAULT_SCREENING_CONFIG.forecastYears);
  assert.equal(broken.depthRejectionPct, DEFAULT_SCREENING_CONFIG.depthRejectionPct);
  assert.equal(broken.growthBasis, DEFAULT_SCREENING_CONFIG.growthBasis);
});

test('values the caller did supply survive normalisation untouched', () => {
  const supplied = normaliseScreeningConfig({
    ...DEFAULT_SCREENING_CONFIG,
    reviewBandErf: 0.85,
    depthRejectionPct: 70,
    growthBasis: 'uniform',
    growthRateMmPerYear: 0.25,
  });

  assert.equal(supplied.reviewBandErf, 0.85);
  assert.equal(supplied.depthRejectionPct, 70);
  assert.equal(supplied.growthBasis, 'uniform');
  assert.equal(supplied.growthRateMmPerYear, 0.25);
});
