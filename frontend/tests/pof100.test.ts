import assert from 'node:assert/strict';
import test from 'node:test';

import {
  POF_COLUMN_TITLES,
  POF_COMPONENT_LABEL,
  POF_RUN_COMPARISON_STATUS,
  pofColumnTitle,
  pofMatchOutcome,
  pofMatchStatus,
} from '../src/domain/pof100.ts';

test('engine result keys are titled with the POF 100 column names', () => {
  // POF 100 Appendix 8 "Run comparison example".
  assert.equal(pofColumnTitle('Log Dist NEW (m)'), 'Log distance NEW [m]');
  assert.equal(pofColumnTitle('Abs. Dist OLD (m)'), 'Log distance OLD [m]');
  assert.equal(pofColumnTitle('Dist GW NEW (m)'), 'Feature to upstream weld NEW [m]');
  assert.equal(pofColumnTitle('Joint No. OLD'), 'Girth weld number OLD');
  assert.equal(pofColumnTitle("O'Clock NEW"), 'Clock position NEW');
  assert.equal(pofColumnTitle('Wall WT OLD (mm)'), 'Wall thickness OLD [mm]');
  assert.equal(pofColumnTitle('Surface NEW'), 'Surface location NEW');
  // POF §2.7: depth is a percentage of wall thickness t, not "%WT".
  assert.equal(pofColumnTitle('Depth OLD (%WT)'), 'Depth OLD [%t]');
  // POF §2.6.3 names the ratio ERF; the assessment method is stated elsewhere.
  assert.equal(pofColumnTitle('ERF ASME NEW'), 'ERF NEW');
});

test('both identification levels POF distinguishes stay distinct', () => {
  // Appendix 2 keeps "Feature type" (Anomaly / Component / Weld) apart from
  // "Feature identification" (Corrosion / Valve / Bend begin). Collapsing them
  // is exactly the ambiguity the standard exists to remove.
  assert.equal(pofColumnTitle('Feature Type NEW'), 'Feature type NEW');
  assert.equal(pofColumnTitle('Feature Identification NEW'), 'Feature identification NEW');
  assert.equal(pofColumnTitle('Dim Classification NEW'), 'Anomaly class NEW');
});

test('a column POF does not name is left as the engine wrote it', () => {
  assert.equal(pofColumnTitle('Something The Engine Invented'), 'Something The Engine Invented');
});

test('every mapped title covers both run sides', () => {
  const sided = Object.keys(POF_COLUMN_TITLES).filter((key) => key.includes('NEW'));
  assert.ok(sided.length > 10);
  for (const key of sided) {
    const oldKey = key.replace('NEW', 'OLD');
    assert.ok(oldKey in POF_COLUMN_TITLES, `${oldKey} has no OLD-side title`);
  }
});

test('run comparison outcomes use the POF wording, not house words', () => {
  // POF §7.5 asks for "new or missed features"; Appendix 8 writes "… matched".
  assert.equal(POF_RUN_COMPARISON_STATUS.persistent, 'Matched');
  assert.equal(POF_RUN_COMPARISON_STATUS.new, 'New in this run');
  assert.equal(POF_RUN_COMPARISON_STATUS.lost, 'Missing in next run');
});

test('a row the OLD run reported and the NEW run did not is missing', () => {
  // The engine names the side it built the row from; the report names what the
  // comparison concluded about the pipe.
  assert.equal(pofMatchStatus('Only OLD'), 'Missing');
  assert.equal(pofMatchStatus('Only NEW'), 'New');
  assert.equal(pofMatchStatus('Matched'), 'Matched');
  assert.equal(pofMatchStatus('Match'), 'Matched');
});

test('a bypassed row is not compared, which is not the same claim as missing', () => {
  // A cluster was never offered to the matcher, so the NEW run saying nothing
  // about it says nothing about the pipe. Reading these two as one word is how
  // an unaligned cluster turns into a repair scope.
  assert.equal(pofMatchStatus('Bypassed OLD'), 'Not compared (OLD)');
  assert.equal(pofMatchStatus('Bypassed NEW'), 'Not compared (NEW)');
  assert.equal(pofMatchOutcome('Bypassed OLD'), 'not-compared');
  assert.notEqual(pofMatchOutcome('Bypassed OLD'), pofMatchOutcome('Only OLD'));
});

test('an outcome resolves the same from the engine word and from its POF wording', () => {
  // The table filters and sorts on what it displays, so the badge has to reach
  // the same outcome from the translated value.
  assert.equal(pofMatchOutcome('Only OLD'), 'missing');
  assert.equal(pofMatchOutcome('Missing'), 'missing');
  assert.equal(pofMatchStatus(pofMatchStatus('Only OLD')), 'Missing');
});

test('an unknown status is shown as written rather than blanked', () => {
  assert.equal(pofMatchStatus('Partially merged'), 'Partially merged');
  assert.equal(pofMatchOutcome('Partially merged'), 'unknown');
  assert.equal(pofMatchStatus('-'), '-');
});

test('pipe furniture is named from the POF component list', () => {
  assert.equal(POF_COMPONENT_LABEL.valve, 'Valve');
  assert.equal(POF_COMPONENT_LABEL.tee, 'Tee / off take');
  assert.equal(POF_COMPONENT_LABEL.fitting, 'Other component');
});
