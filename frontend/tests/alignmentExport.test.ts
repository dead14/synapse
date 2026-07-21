import assert from 'node:assert/strict';
import test from 'node:test';

import { createExcelExportRows } from '../src/utils/alignmentExport.ts';

test('creates compact Excel export rows using the report fields and aliases', () => {
  const source = {
    'Abs. Dist NEW (m)': 1868.81,
    'Feature Type NEW': 'girth weld',
    'Identif. NEW': 16235,
    'Joint Number NEW': 44,
    'Joint Length NEW (m)': 12.5,
    'Dist to US GW NEW (m)': 0,
    'Wall Thickness NEW (mm)': 8.7,
    "O'Clock NEW": '3:00',
    'Length NEW (mm)': 0,
    'Width NEW (mm)': 15,
    'Depth NEW (%WT)': 20,
    'Surface NEW': 'external',
    'ERF ASME NEW': 0.95,
    'Psafe NEW (bar)': 99,
    'Comment NEW': 'verified',
    'Log Dist OLD (m)': 4.243,
    match_status: 'Matched',
    __resultGroup: 'GW',
    'Internal only': 'must not be exported',
  };

  const [row] = createExcelExportRows([source]);

  assert.deepEqual(row, {
    'Log Dist NEW (m)': 1868.81,
    'Feature Type NEW': 'girth weld',
    'Identif. NEW': 16235,
    'Joint No. NEW': 44,
    'Joint Len NEW (m)': 12.5,
    'Dist GW NEW (m)': 0,
    'Wall WT NEW (mm)': 8.7,
    "O'Clock NEW": '3:00',
    'Length NEW (mm)': 0,
    'Width NEW (mm)': 15,
    'Depth NEW (%WT)': 20,
    'Surface NEW': 'external',
    'ERF ASME NEW': 0.95,
    'Psafe NEW (bar)': 99,
    'Comment NEW': 'verified',
    'Log Dist OLD (m)': 4.243,
    'Match/Unmatch': 'Matched',
  });
  assert.equal(Object.hasOwn(row, '__resultGroup'), false);
  assert.equal(Object.hasOwn(row, 'Internal only'), false);
  assert.equal(source['Dist to US GW NEW (m)'], 0);
});
