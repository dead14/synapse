/**
 * Section 1 of the report, against the client's ILI executive-summary template.
 *
 * Two things are pinned here. The first is the shape: the client reads this
 * document beside the contractor's own report, so the headings and their order
 * are part of the deliverable, not a styling choice. The second is the honesty
 * of the fields the template asks for and this workspace never receives — the
 * tool technology, the contractor, the risk category. A template placeholder
 * filled with a plausible-looking value is the one failure mode a summary
 * cannot have, because the summary is the page that gets signed.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { processRow } from '../src/lib/ffs/calcEngine.ts';
import { screenResults } from '../src/lib/ffs/screening.ts';
import { buildNarrative } from '../src/lib/ffs/narrative.ts';
import { executiveBand } from '../src/lib/ffs/executiveNarrative.ts';
import { buildFfsReportCase, type FfsReportContext } from '../src/lib/ffs/reportCase.ts';
import { DEFAULT_SCREENING_CONFIG, type FfsConfig } from '../src/lib/ffs/types.ts';

const config: FfsConfig = {
  lineName: 'Executive summary line',
  method: 'modified',
  modifiedSa: 'smys69',
  iliDate: new Date('2024-08-23'),
  highlightYears: 5,
  analysisHorizonYears: 30,
  pressureBasis: 'maop',
};

const reportContext: FfsReportContext = {
  inspectionDateIso: '2024-08-23',
  asOfDateIso: '2026-08-03',
};

function row(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    'Feature ID': 'F-001',
    'LD [m]': '100',
    Section: 'Aerial',
    Surface: 'External',
    'Max Depth [%]': '40',
    'Length [mm]': '50',
    'Width [mm]': '80',
    'Orient. (hrs:mins)': '6:00',
    'Nominal Wall Thickness [mm]': '9.3',
    'CR Depth [mm/y]': '0.1',
    'CR Length [mm/y]': '1',
    'Design Factor': '0.72',
    'Outer Diameter Ds': '508',
    'SMYS [MPa]': '390',
    'Operating Pressure P₀ [MPa]': '9.46',
    ...overrides,
  };
}

function assessed(rows: Record<string, string>[]) {
  return screenResults(rows.map((item) => processRow(item, config)), config, DEFAULT_SCREENING_CONFIG);
}

function narrativeOf(rows: Record<string, string>[]) {
  const items = assessed(rows);
  return {
    items,
    blocks: buildNarrative(items, config, DEFAULT_SCREENING_CONFIG, undefined, reportContext),
  };
}

const HEADINGS = [
  '1  Executive summary',
  '1.1  Summary of results',
  '1.2  Fitness for service',
  '1.2.1  Immediate integrity assessment',
  '1.2.2  Corrosion growth assessment',
  '1.2.3  Future integrity assessment',
  '1.2.4  Feature prioritisation',
  '1.3  Risk assessment',
  '1.4  Next in-line inspection',
  '1.5  Conclusion',
  '1.6  Executive integrity status',
  '1.7  Management statement',
];

test('the narrative opens with the client template sections, in the template order', () => {
  const { blocks } = narrativeOf([
    row(),
    row({ 'Feature ID': 'F-002', 'LD [m]': '900', Section: 'Buried', Surface: 'Internal', 'Max Depth [%]': '62' }),
  ]);

  const headings = blocks
    .filter((block) => block.kind === 'heading')
    .map((block) => (block as { text: string }).text);

  assert.deepEqual(headings.slice(0, HEADINGS.length), HEADINGS);
  // The engineering detail the summary quotes stays behind it rather than
  // being replaced by it.
  assert.ok(headings.includes('2.0  Assessment methodology'));
  assert.ok(headings.includes('3.5  Residual life assessment'));
});

test('the template tables are numbered 1-1 to 1-7 and carry the section roll-up', () => {
  const { blocks } = narrativeOf([
    row(),
    row({ 'Feature ID': 'F-002', 'LD [m]': '900', Section: 'Buried', Surface: 'Internal', 'Max Depth [%]': '62' }),
  ]);

  const captions = blocks
    .filter((block) => block.kind === 'table')
    .map((block) => (block as { table: { caption: string } }).table.caption);

  for (const number of ['1-1', '1-2', '1-3', '1-4', '1-5', '1-6', '1-7']) {
    assert.ok(
      captions.some((caption) => caption.includes(`Table ${number}`)),
      `Table ${number} is missing from the executive summary`,
    );
  }

  const summaryTable = blocks.find(
    (block) => block.kind === 'table' && block.table.caption.includes('Table 1-1'),
  );
  assert.ok(summaryTable && summaryTable.kind === 'table');
  // One row per section, plus the overall row the template asks for.
  assert.equal(summaryTable.table.rows.length, 3);
  assert.equal(summaryTable.table.rows[2][0], 'Overall');
  assert.equal(summaryTable.table.rows[2][1], '1');
  assert.equal(summaryTable.table.rows[2][2], '1');
});

test('fields the intake never receives are declared missing, not filled in', () => {
  const { blocks } = narrativeOf([row()]);
  const text = JSON.stringify(blocks);

  assert.match(text, /tool technology, the inspection contractor, the propulsion method/i);
  assert.match(text, /establishes no risk category/i);
  assert.match(text, /Not established by this assessment/);
  // No bracketed template placeholder may survive into the document.
  assert.doesNotMatch(text, /\[(XX|XXX|XXXX|YYYY|SECTION|VENDOR|ILI [A-Z]+)/);
});

test('the executive verdict and the next-inspection date follow the assessed population', () => {
  const passing = narrativeOf([row({ 'Max Depth [%]': '20', 'CR Depth [mm/y]': '0.05' })]);
  const failing = narrativeOf([row({ 'Max Depth [%]': '78', 'Length [mm]': '400' })]);

  assert.match(JSON.stringify(passing.blocks), /FIT FOR SERVICE/);
  assert.match(JSON.stringify(failing.blocks), /NOT FIT FOR SERVICE/);

  // The date is the projection minus the three-year deferral margin, and it is
  // never presented as a risk-based interval.
  const reportCase = buildFfsReportCase(passing.items, reportContext);
  const text = JSON.stringify(passing.blocks);
  if (reportCase.remnantLife.years !== null && reportCase.remnantLife.years > 3) {
    assert.match(text, /next in-line inspection should be completed by \d{4}-\d{2}-\d{2}/i);
    assert.match(text, /not a risk-based interval/i);
  }
});

test('the priority bands restate the screening priority instead of inventing a second rule', () => {
  const items = assessed([
    row({ 'Feature ID': 'F-FAIL', 'Max Depth [%]': '78', 'Length [mm]': '400' }),
    row({ 'Feature ID': 'F-DEEP', 'LD [m]': '200', 'Max Depth [%]': '72' }),
    row({ 'Feature ID': 'F-MID', 'LD [m]': '300', 'Max Depth [%]': '52' }),
    row({ 'Feature ID': 'F-LOW', 'LD [m]': '400', 'Max Depth [%]': '15', 'CR Depth [mm/y]': '0.01' }),
  ]);

  for (const item of items) {
    const band = executiveBand(item);
    if (item.nominal.acceptance === 'Un-Acceptable') {
      assert.equal(band, 'immediate');
      continue;
    }
    assert.equal(
      band,
      item.priority === 'High' ? 'high' : item.priority === 'Medium' ? 'medium' : 'low',
      `${item.nominal.featureId} banded against its screening priority`,
    );
  }
});
