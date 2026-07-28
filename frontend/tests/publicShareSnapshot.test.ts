import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPublicShareSnapshot,
  type PublicShareKind,
} from '../src/lib/sharing/publicShareSnapshot.ts';
import {
  publicShareUrl,
  tokenFromLocationHash,
} from '../src/lib/sharing/publicShareLink.ts';

test('normalizes every supported result kind into one read-only snapshot contract', () => {
  const cases: Array<{
    kind: PublicShareKind;
    row: Record<string, unknown>;
    expectedKey: string;
  }> = [
    {
      kind: 'GW_ALIGNMENT',
      row: {
        id: 'gw:1',
        status: 'Match',
        oldVal: 10,
        newVal: 10.2,
        oldDesc: 'Girth weld',
        newDesc: 'Girth weld',
        onSave() {},
      },
      expectedKey: 'oldVal',
    },
    {
      kind: 'SECTIONING',
      row: {
        id: 'section:1',
        name: 'KP 0-5',
        type: 'Mainline',
        startGw: 'GW-1',
        endGw: 'GW-9',
        startM: 0,
        endM: 5_000,
        length: 5_000,
      },
      expectedKey: 'name',
    },
    {
      kind: 'ILI_ALIGNMENT',
      row: {
        'Match/Unmatch': 'Match',
        'Source Key OLD': 'old:1',
        'Source Key NEW': 'new:1',
        'Original Log Dist OLD (m)': 41.9,
        'Original Log Dist NEW (m)': 42.4,
        'Log Dist NEW (m)': 42.5,
        'Dist GW OLD (m)': 3.2,
        'Dist GW NEW (m)': 3.4,
        'Joint No. OLD': 'J-10',
        'Joint No. NEW': 'J-11',
        'Run Year OLD': 2021,
        'Run Year NEW': 2026,
        pair_index: 0,
        pair_old_year: 2021,
        pair_new_year: 2026,
        __origIdx: 99,
      },
      expectedKey: 'Source Key NEW',
    },
    {
      kind: 'CORROSION',
      row: {
        sourceKey: 'new:1',
        featureId: 'ML-1',
        distanceM: 42.5,
        depthPct: 35,
        growthClass: 'active',
        ffsReady: true,
        blockers: [],
      },
      expectedKey: 'sourceKey',
    },
    {
      kind: 'FFS',
      row: {
        key: 'ffs:1',
        index: 0,
        nominal: {
          ld: 42.5,
          section: 'KP 0-5',
          surface: 'External',
          maxDepthPct: 35,
          ERF: 0.82,
          acceptance: 'Acceptable',
          safePressure: 91,
          branch: 'short',
        },
        conservative: { ERF: 0.91 },
        forecast: { ERF: 0.97 },
        lifeToErf1: 8.2,
        priority: 'Medium',
      },
      expectedKey: 'nominalErf',
    },
  ];

  for (const { kind, row, expectedKey } of cases) {
    const snapshot = buildPublicShareSnapshot(kind, [row]);
    assert.equal(snapshot.version, 1);
    assert.equal(snapshot.rows.length, 1);
    assert.ok(snapshot.columns.some((column) => column.key === expectedKey), `${kind} columns`);
    assert.ok(Object.hasOwn(snapshot.rows[0], expectedKey), `${kind} row projection`);
    assert.equal(Object.hasOwn(snapshot.rows[0], '__origIdx'), false);
    assert.equal(Object.hasOwn(snapshot.rows[0], 'onSave'), false);
    assert.deepEqual(snapshot.summary[0], { label: 'Rows', value: 1 });
  }
});

test('keeps the explicit ILI lane evidence needed by the existing comparison viewer', () => {
  const snapshot = buildPublicShareSnapshot('ILI_ALIGNMENT', [{
    'Match/Unmatch': 'Match',
    'Result Group': 'ANOMALY',
    'Source Key OLD': 'old:1',
    'Source Key NEW': 'new:1',
    'Identif. OLD': 'ML-100',
    'Identif. NEW': 'ML-101',
    'Feature Type OLD': 'metal loss',
    'Feature Type NEW': 'metal loss',
    'Original Log Dist OLD (m)': 41.9,
    'Original Log Dist NEW (m)': 42.4,
    'Log Dist OLD (m)': 42,
    'Log Dist NEW (m)': 42.5,
    'Dist GW OLD (m)': 3.2,
    'Dist GW NEW (m)': 3.4,
    'Joint No. OLD': 'J-10',
    'Joint No. NEW': 'J-11',
    "O'Clock OLD": '03:00',
    "O'Clock NEW": '03:15',
    'Depth OLD (%WT)': 20,
    'Depth NEW (%WT)': 24,
    'Length OLD (mm)': 15,
    'Length NEW (mm)': 18,
    'Width OLD (mm)': 11,
    'Width NEW (mm)': 13,
    'Int/Ext OLD': 'External',
    'Int/Ext NEW': 'External',
    'Run Year OLD': 2021,
    'Run Year NEW': 2026,
    pair_index: 0,
    pair_old_year: 2021,
    pair_new_year: 2026,
    __origIdx: 12,
    onUpdate() {},
  }]);

  assert.deepEqual(snapshot.rows[0], {
    'Match/Unmatch': 'Match',
    'Result Group': 'ANOMALY',
    'Source Key OLD': 'old:1',
    'Source Key NEW': 'new:1',
    'Identif. OLD': 'ML-100',
    'Identif. NEW': 'ML-101',
    'Feature Type OLD': 'metal loss',
    'Feature Type NEW': 'metal loss',
    'Original Log Dist OLD (m)': 41.9,
    'Original Log Dist NEW (m)': 42.4,
    'Log Dist OLD (m)': 42,
    'Log Dist NEW (m)': 42.5,
    'Dist GW OLD (m)': 3.2,
    'Dist GW NEW (m)': 3.4,
    'Joint No. OLD': 'J-10',
    'Joint No. NEW': 'J-11',
    "O'Clock OLD": '03:00',
    "O'Clock NEW": '03:15',
    'Depth OLD (%WT)': 20,
    'Depth NEW (%WT)': 24,
    'Length OLD (mm)': 15,
    'Length NEW (mm)': 18,
    'Width OLD (mm)': 11,
    'Width NEW (mm)': 13,
    'Int/Ext OLD': 'External',
    'Int/Ext NEW': 'External',
    'Run Year OLD': 2021,
    'Run Year NEW': 2026,
    pair_index: 0,
    pair_old_year: 2021,
    pair_new_year: 2026,
  });
});

test('adds caller-provided summary and notes without carrying mutable values', () => {
  const sourceSummary = [{ label: 'Selected for FFS', value: 4 }];
  const sourceNotes = ['Snapshot after engineering review'];
  const snapshot = buildPublicShareSnapshot(
    'CORROSION',
    [{ sourceKey: 'new:1', blockers: ['No width'] }],
    { summary: sourceSummary, notes: sourceNotes },
  );

  sourceSummary[0].value = 99;
  sourceNotes[0] = 'changed';

  assert.deepEqual(snapshot.summary, [
    { label: 'Rows', value: 1 },
    { label: 'Selected for FFS', value: 4 },
  ]);
  assert.deepEqual(snapshot.notes, ['Snapshot after engineering review']);
  assert.notEqual(snapshot.rows[0].blockers, undefined);
});

test('rejects a result set larger than the public contract instead of silently truncating it', () => {
  const rows = Array.from({ length: 10_001 }, (_, index) => ({
    'Source Key NEW': `new:${index}`,
  }));

  assert.throws(
    () => buildPublicShareSnapshot('ILI_ALIGNMENT', rows),
    /at most 10,000 rows/i,
  );
});

test('turns non-finite calculation output into a display-safe value', () => {
  const snapshot = buildPublicShareSnapshot('FFS', [{
    key: 'ffs:1',
    nominal: { ERF: Number.NaN, safePressure: Number.POSITIVE_INFINITY },
    conservative: { ERF: 0.9 },
    forecast: { ERF: 1.1 },
    lifeToErf1: Number.POSITIVE_INFINITY,
  }]);

  assert.equal(snapshot.rows[0].nominalErf, null);
  assert.equal(snapshot.rows[0].safePressure, null);
  assert.equal(snapshot.rows[0].lifeToErf1, null);
});

test('keeps the bearer secret in the URL fragment and recovers it safely', () => {
  const id = '123e4567-e89b-42d3-a456-426614174000';
  const secret = 'abc_DEF-123';
  const url = new URL(publicShareUrl(id, secret, 'https://synapse.example'));

  assert.equal(url.pathname, `/share/${id}`);
  assert.equal(url.search, '');
  assert.equal(url.hash, `#${secret}`);
  assert.equal(tokenFromLocationHash(url.hash), secret);
  assert.equal(tokenFromLocationHash('#%E0%A4%A'), '');
});
