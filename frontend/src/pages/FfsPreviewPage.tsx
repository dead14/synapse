/**
 * Development-only harness for the FFS assessment workspace.
 *
 * The results page only ever opens on router state produced by a completed
 * alignment and a Corrosion Analysis release, which makes iterating on it
 * expensive: upload two tallies, align, review, release, run. This page feeds
 * the same page a deterministic population shaped exactly like the intake
 * produces, so the charts, the narrative, and the summary rail can be worked on
 * without a backend.
 *
 * It is mounted behind `import.meta.env.DEV`, alongside `/spool-preview`.
 */

import { useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import FfsResultsPage from './FFS/FfsResultsPage.tsx';
import { processRow } from '../lib/ffs/calcEngine.ts';
import { DEFAULT_SCREENING_CONFIG, type FfsConfig } from '../lib/ffs/types.ts';

/** Deterministic pseudo-random so the harness looks the same on every reload. */
function makeRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

const CONFIG: FfsConfig = {
  lineName: '8in HP Gas Lift — preview harness',
  method: 'modified',
  modifiedSa: 'smys69',
  iliDate: new Date('2024-08-23'),
  highlightYears: 5,
  analysisHorizonYears: 30,
  pressureBasis: 'maop',
  inputUnits: { pressure: 'MPa', diameter: 'mm' },
  serviceLife: { designLifeYears: 25, commissioningYear: 1985 },
};

/** Three sections at two design factors, matching the reference report's shape. */
const SECTIONS = [
  { name: 'Aerial Section', from: 0, to: 1_900, designFactor: 0.72 },
  { name: 'River Crossing RC#86', from: 1_900, to: 2_400, designFactor: 0.6 },
  { name: 'Buried Section', from: 2_400, to: 3_700, designFactor: 0.72 },
];

function clock(hours: number): string {
  const whole = Math.floor(hours) % 12;
  const minutes = Math.round((hours - Math.floor(hours)) * 60);
  return `${whole === 0 ? 12 : whole}:${String(minutes).padStart(2, '0')}`;
}

function buildResults() {
  const random = makeRandom(20260804);
  const rows: Record<string, string>[] = [];

  for (let index = 0; index < 420; index += 1) {
    const distance = random() * 3_700;
    const section = SECTIONS.find((entry) => distance >= entry.from && distance < entry.to) ?? SECTIONS[0];
    // Most features are shallow; a thin tail runs deep, which is what makes the
    // depth-band charts and the shortest-life ranking worth looking at.
    const depth = Math.min(78, 5 + Math.pow(random(), 2.6) * 74);
    const internal = random() < 0.24;
    const clustered = random() < 0.06;
    // A quarter of the population has no usable axial rate, so the "length held
    // constant" path is exercised rather than assumed.
    const lengthRate = random() < 0.25 ? 0 : Number((random() * 3).toFixed(2));

    rows.push({
      'Feature ID': `F-${String(index + 1).padStart(4, '0')}`,
      'LD [m]': distance.toFixed(3),
      Section: section.name,
      Surface: internal ? 'Internal' : 'External',
      'Max Depth [%]': depth.toFixed(1),
      'Length [mm]': (12 + random() * 120).toFixed(0),
      'Width [mm]': (30 + random() * 140).toFixed(0),
      'Orient. (hrs:mins)': clock(internal ? 5 + random() * 2 : random() * 12),
      'Nominal Wall Thickness [mm]': section.name.includes('River') ? '12.7' : '9.3',
      'CR Depth [mm/y]': (random() * 0.55).toFixed(3),
      'CR Length [mm/y]': lengthRate.toFixed(2),
      'Design Factor': String(section.designFactor),
      'Design Factor Source': 'section-override',
      'Outer Diameter Ds': '219.1',
      'SMYS [MPa]': '290',
      'Operating Pressure P₀ [MPa]': '9.35',
      'Clustered Metal Loss': clustered ? 'Yes' : 'No',
      'Repair Status': random() < 0.03 ? 'Temporary repair' : 'Unrepaired',
      'Repair Method': 'Composite wrap',
      'Repair Date': '2024-10-02',
      'Repair Reference': 'REP-PREVIEW',
      Recommendation: 'Replace at the next shutdown',
      'Action Owner': 'Integrity',
    });
  }

  return rows.map((row) => processRow(row, CONFIG));
}

export default function FfsPreviewPage() {
  const state = useMemo(
    () => ({ results: buildResults(), config: CONFIG, screening: DEFAULT_SCREENING_CONFIG }),
    [],
  );

  // The results page reads its input from router state, so the harness pushes
  // that state onto its own route and then renders the page unchanged, rather
  // than adding a second input path to production code for the sake of a
  // preview. Rendering is held back until the state has landed, because the
  // page redirects to setup when it opens without one.
  const location = useLocation();
  const navigate = useNavigate();
  const ready = Boolean((location.state as { results?: unknown } | null)?.results);

  useEffect(() => {
    if (!ready) navigate('/ffs-preview', { state, replace: true });
  }, [ready, navigate, state]);

  if (!ready) {
    return <p className="p-8 text-sm text-slate-500">Building the preview population…</p>;
  }
  return <FfsResultsPage />;
}
