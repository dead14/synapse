/**
 * Development-only harness for the Spool Detail View.
 *
 * The workspace only ever runs on an alignment session, which makes iterating
 * on it expensive: upload two tallies, align, pick a spool, open the view. This
 * page feeds it a deterministic set of rows shaped exactly like the engine's
 * comparison output, so the rendering can be worked on without a backend.
 *
 * It is mounted behind `import.meta.env.DEV`, alongside `/ds-preview`.
 */

import { useMemo, useState } from 'react';

import SpoolDetailView from '../components/spool/SpoolDetailView.tsx';

/** Deterministic pseudo-random so the harness looks the same on every reload. */
function makeRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

const START_M = 6.67;
const END_M = 18.79;
const WALL_MM = 8.7;

function clock(hours: number): string {
  const whole = Math.floor(hours) % 12;
  const minutes = Math.round((hours - Math.floor(hours)) * 60);
  return `${whole === 0 ? 12 : whole}:${String(minutes).padStart(2, '0')}`;
}

function buildRows() {
  const random = makeRandom(20260804);
  const rows: Array<Record<string, unknown>> = [];

  // Girth welds every ~3 m, matched in both runs.
  for (let index = 0; index < 5; index += 1) {
    const distance = START_M - 0.4 + index * 3.02;
    rows.push({
      'Identif. OLD': `GW-${140 + index}`,
      'Identif. NEW': `GW-${140 + index}`,
      'Feature Type OLD': 'Girth Weld',
      'Feature Type NEW': 'Girth Weld',
      'Log Dist OLD (m)': distance - 0.012,
      'Log Dist NEW (m)': distance,
      'Original Log Dist OLD (m)': distance - 0.31,
      'Original Log Dist NEW (m)': distance,
      'Result Group': 'GW',
      match_status: 'Matched',
      'Run Year OLD': 2023,
      'Run Year NEW': 2026,
    });
  }

  const types = ['Metal Loss', 'Metal Loss', 'Metal Loss', 'Dent', 'Crack-like'];

  for (let index = 0; index < 34; index += 1) {
    const distance = START_M + 0.3 + random() * (END_M - START_M - 0.6);
    const featureType = types[Math.floor(random() * types.length)];
    const hours = random() * 12;
    const depthOld = 8 + random() * 34;
    const grew = random() > 0.42;
    const depthNew = grew ? depthOld + 1.5 + random() * 9 : depthOld + (random() - 0.5) * 0.6;
    const lengthOld = 25 + random() * 90;
    const widthOld = 18 + random() * 60;
    const roll = random();

    // A slice of the set exercises the unmatched and bypassed paths.
    const onlyNew = roll > 0.86;
    const onlyOld = roll > 0.78 && roll <= 0.86;
    const bypassed = roll > 0.72 && roll <= 0.78;

    const erfOld = Number((0.45 + depthOld / 100).toFixed(2));
    const erfNew = Number((0.45 + depthNew / 100).toFixed(2));

    const oldSide = onlyNew ? {} : {
      'Identif. OLD': `A-${11800 + index}`,
      'Feature Type OLD': featureType,
      'Log Dist OLD (m)': distance - 0.04,
      'Original Log Dist OLD (m)': distance - 0.35,
      'Depth OLD (%WT)': Number(depthOld.toFixed(1)),
      'Length OLD (mm)': Math.round(lengthOld),
      'Width OLD (mm)': Math.round(widthOld),
      "O'Clock OLD": clock(hours),
      'Wall WT OLD (mm)': WALL_MM,
      'ERF ASME OLD': erfOld,
      'Psafe OLD (bar)': Number((92 - depthOld).toFixed(1)),
      'Surface OLD': random() > 0.5 ? 'INT' : 'EXT',
      'Joint No. OLD': `J-${44 + Math.floor(index / 4)}`,
      'Dist GW OLD (m)': Number((random() * 2.4).toFixed(3)),
      'Run Year OLD': 2023,
    };

    const newSide = onlyOld ? {} : {
      'Identif. NEW': `A-${12440 + index}`,
      'Feature Type NEW': featureType,
      'Log Dist NEW (m)': distance,
      'Original Log Dist NEW (m)': distance + 0.02,
      'Depth NEW (%WT)': Number(depthNew.toFixed(1)),
      'Length NEW (mm)': Math.round(lengthOld + (grew ? random() * 22 : 0)),
      'Width NEW (mm)': Math.round(widthOld + (grew ? random() * 14 : 0)),
      "O'Clock NEW": clock(hours),
      'Wall WT NEW (mm)': WALL_MM,
      'ERF ASME NEW': erfNew,
      'Psafe NEW (bar)': Number((92 - depthNew).toFixed(1)),
      'Surface NEW': random() > 0.5 ? 'INT' : 'EXT',
      'Joint No. NEW': `J-${44 + Math.floor(index / 4)}`,
      'Dist GW NEW (m)': Number((random() * 2.4).toFixed(3)),
      'Run Year NEW': 2026,
    };

    rows.push({
      ...oldSide,
      ...newSide,
      'Result Group': bypassed ? 'Bypassed' : 'Anomaly',
      'Bypass Reason': bypassed ? 'Clustering — not aligned' : '-',
      match_status: onlyNew ? 'ONLY_NEW' : onlyOld ? 'ONLY_OLD' : 'Matched',
      'Depth Growth (%WT/yr)': onlyNew || onlyOld ? '-' : Number(((depthNew - depthOld) / 3).toFixed(2)),
      'Length Growth (mm/yr)': onlyNew || onlyOld ? '-' : Number((random() * 3).toFixed(1)),
      Section: index % 3 === 0 ? 'Onshore — KP 0+000' : 'Offshore riser',
      'Physics Warning': '-',
      'Run Year OLD': 2023,
      'Run Year NEW': 2026,
    });
  }

  return rows;
}

export default function SpoolPreviewPage() {
  const rows = useMemo(buildRows, []);
  const [open, setOpen] = useState(true);

  return (
    <div style={{ padding: '2rem', fontFamily: 'var(--ds-font)' }}>
      <h1 style={{ fontSize: 'var(--ds-t-xl)', fontWeight: 700 }}>Spool Detail View — dev harness</h1>
      <p style={{ color: 'var(--ds-muted)', fontSize: 'var(--ds-t-sm)', marginTop: '0.5rem' }}>
        {rows.length} synthetic comparison rows, ILI 2026 against ILI 2023, master axis {START_M} m to {END_M} m.
      </p>
      <button type="button" className="ds-btn ds-btn--primary" style={{ marginTop: '1rem' }} onClick={() => setOpen(true)}>
        Open the workspace
      </button>

      {open && (
        <SpoolDetailView
          rows={rows}
          range={{ startM: START_M, endM: END_M, laneLabel: 'ILI 2026' }}
          onClose={() => setOpen(false)}
          onSelectRowIdx={(rowIndex) => console.info('row selected', rowIndex)}
        />
      )}
    </div>
  );
}
