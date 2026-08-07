/**
 * The 3D pipe and the unrolled shell for one FFS spool.
 *
 * Both panes are the ones the alignment side already uses — `SpoolScene3D` and
 * `SpoolUnrolled2D` — fed through `ffsSpoolGeometry`. Reusing them is the whole
 * point: an engineer who has learned to read the pipe in the comparison
 * workspace reads the same picture here, and there is no second implementation
 * that can drift on how large a defect is drawn.
 *
 * The two panes are stacked in their own boxes rather than overlaid. They are
 * different projections of the same metal, and putting one on top of the other
 * makes both unreadable.
 */

import { Suspense, lazy, useMemo, useState } from 'react';
import { FiMaximize2, FiRotateCw } from 'react-icons/fi';

import type { SpoolFeature } from '../../domain/spoolFeatures';
import type { CameraPreset } from '../spool/SpoolScene3D';
import SpoolUnrolled2D from '../spool/SpoolUnrolled2D';
import { collectSpoolFittings } from '../spool/spoolFittings';
import { ffsSpoolGeometry } from '../../lib/ffs/spoolGeometryAdapter';
import type { FfsSpool } from '../../lib/ffs/spoolReview';
import type { FfsScreenedResult } from '../../lib/ffs/types';
import '../spool/spool.css';

// three.js is a large dependency and the register itself never needs it, so the
// scene only loads once a spool card is open.
const SpoolScene3D = lazy(() => import('../spool/SpoolScene3D'));

const CAMERA_PRESETS: Array<[CameraPreset, string]> = [
  ['home', 'Home'],
  ['top', 'Top'],
  ['bottom', 'Bottom'],
  ['look-along', 'Look along'],
];

export default function FfsSpoolGeometryPanes({
  spool,
  selected,
  markedIndexes,
  onSelect,
}: {
  spool: FfsSpool;
  selected: FfsScreenedResult | null;
  markedIndexes?: ReadonlySet<number>;
  onSelect?: (item: FfsScreenedResult) => void;
}) {
  const geometry = useMemo(() => ffsSpoolGeometry(spool), [spool]);
  // Same rule as the comparison workspace: a bend reported inside the spool
  // turns the shell here too, so both pictures of one joint agree.
  const fittings = useMemo(
    () => collectSpoolFittings(geometry.features, { startM: geometry.startM, endM: geometry.endM }),
    [geometry],
  );
  const [markerScale, setMarkerScale] = useState(6);
  const [hovered, setHovered] = useState<SpoolFeature | null>(null);
  const [command, setCommand] = useState({ preset: 'home' as CameraPreset, nonce: 0 });

  // The panes speak SpoolFeature; the rest of the FFS workspace speaks feature
  // index. This is the only place the two identities meet.
  const byRowIndex = useMemo(
    () => new Map(spool.members.map((member) => [member.index, member])),
    [spool.members],
  );
  const pick = (feature: SpoolFeature | null) => {
    if (!feature) return;
    const member = byRowIndex.get(feature.rowIndex);
    if (member) onSelect?.(member);
  };
  const selectedKey = geometry.features.find(
    (feature) => feature.rowIndex === selected?.index,
  )?.key ?? null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400">
        <label className="flex items-center gap-1.5">
          Defect size
          <select
            value={markerScale}
            onChange={(event) => setMarkerScale(Number(event.target.value))}
            aria-label="Defect marker magnification"
            className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] dark:border-slate-700 dark:bg-slate-900"
          >
            {[1, 2, 4, 6, 10, 16].map((factor) => (
              <option key={factor} value={factor}>{factor === 1 ? 'True scale' : `${factor}×`}</option>
            ))}
          </select>
        </label>
        <span>
          {geometry.odMm === null
            ? 'No outer diameter on these rows — width drawn nominal'
            : `Arcs on OD ${geometry.odMm} mm`}
          {markerScale > 1 && `, magnified ${markerScale}× for display`}
        </span>
        {!geometry.weldBounded && (
          <span className="text-amber-600 dark:text-amber-400">
            No girth-weld boundary for this group; the frame is the span of the features.
          </span>
        )}
      </div>

      {/* 3D pipe */}
      <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-1.5 dark:border-slate-700 dark:bg-slate-900/50">
          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Pipe · 3D
          </span>
          <div className="flex items-center gap-1">
            {CAMERA_PRESETS.map(([preset, label]) => (
              <button
                key={preset}
                type="button"
                onClick={() => setCommand((current) => ({ preset, nonce: current.nonce + 1 }))}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-600 transition-colors hover:border-indigo-300 hover:text-indigo-600 dark:border-slate-700 dark:text-slate-300"
              >
                {preset === 'home' && <FiRotateCw aria-hidden="true" className="h-3 w-3" />}
                {label}
              </button>
            ))}
            <span className="ml-1 inline-flex items-center gap-1 text-[10px] text-slate-400">
              <FiMaximize2 aria-hidden="true" className="h-3 w-3" /> drag to orbit
            </span>
          </div>
        </div>
        <div style={{ height: 320 }} className="bg-slate-900">
          <Suspense fallback={<div className="grid h-full place-items-center text-xs text-slate-400">Loading the pipe…</div>}>
            <SpoolScene3D
              features={geometry.features}
              welds={geometry.welds}
              fittings={fittings}
              startM={geometry.startM}
              endM={geometry.endM}
              odMm={geometry.odMm}
              palette="ili"
              selectedKey={selectedKey}
              onSelect={(feature) => pick(feature)}
              onHover={setHovered}
              hovered={hovered}
              view={{
                xray: false,
                cutaway: false,
                crossSection: false,
                markerScale,
                showPrevious: false,
                showFittings: true,
              }}
              command={command}
              measureMode={false}
              measurePicks={[]}
            />
          </Suspense>
        </div>
      </div>

      {/* Unrolled shell */}
      <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
        <div className="border-b border-slate-200 bg-slate-50 px-3 py-1.5 dark:border-slate-700 dark:bg-slate-900/50">
          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Shell unrolled · 2D
          </span>
        </div>
        <div className="bg-slate-900/5 dark:bg-slate-900/40">
          <SpoolUnrolled2D
            features={geometry.features}
            welds={geometry.welds}
            startM={geometry.startM}
            endM={geometry.endM}
            odMm={geometry.odMm}
            palette="ili"
            markerScale={markerScale}
            showWelds={geometry.weldBounded}
            showAxialScale
            showPrevious={false}
            selectedKey={selectedKey}
            onSelect={(feature) => pick(feature)}
            onHover={setHovered}
          />
        </div>
      </div>

      {markedIndexes && markedIndexes.size > 0 && (
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          {markedIndexes.size} of {spool.featureCount} features are ticked for the disposition below.
        </p>
      )}
    </div>
  );
}
