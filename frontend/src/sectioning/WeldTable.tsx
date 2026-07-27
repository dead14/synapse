import { useMemo, useState } from 'react';
import type { SpatialFeatures } from './types';

interface Props {
  features: SpatialFeatures;
}

interface WeldRow {
  key: string;
  run: string;
  status: string;
  id: string;
  distance: number;
  partnerId: string;
  partnerDistance: number | null;
  unmatched: boolean;
  detail: string;
}

const numberFrom = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export default function WeldTable({ features }: Props) {
  const [filter, setFilter] = useState<'ALL' | 'MATCHED' | 'MISSING'>('ALL');
  const rows = useMemo<WeldRow[]>(() => {
    const masterRows = features.gws.map((gw, index) => ({
      key: `master-${gw.id}-${gw.dist}-${index}`,
      run: `NEW ${gw.runYear || ''}`.trim(),
      status: gw.status === 'MATCHED' ? 'MATCHED' : 'ONLY NEW',
      id: gw.id,
      distance: gw.dist,
      partnerId: String(gw.rawData.oldId ?? '-'),
      partnerDistance: numberFrom(gw.rawData.oldDistance),
      unmatched: gw.status !== 'MATCHED',
      detail: String(gw.rawData.missingReason ?? (gw.status === 'MATCHED' ? 'Paired to historical OLD' : 'No paired OLD GW')),
    }));
    const historicalRows = features.historicalLanes.flatMap((lane) => lane.gws.map((gw, index) => ({
      key: `${lane.id}-${gw.id}-${gw.dist}-${index}`,
      run: `OLD ${lane.year || ''}`.trim(),
      status: gw.status === 'MATCHED' ? 'MATCHED' : gw.status === 'MISSING_IN_MASTER' ? 'ONLY OLD' : 'UNRESOLVED',
      id: gw.id,
      distance: numberFrom(gw.rawData.sourceDistance) ?? gw.dist,
      partnerId: String(gw.rawData.matchedMasterId ?? '-'),
      partnerDistance: numberFrom(gw.rawData.masterDistance),
      unmatched: gw.status !== 'MATCHED',
      detail: String(gw.rawData.missingReason ?? (gw.status === 'MATCHED' ? 'Paired to master NEW' : 'No paired NEW GW')),
    })));
    return [...masterRows, ...historicalRows];
  }, [features]);

  const visibleRows = filter === 'ALL' ? rows : rows.filter((row) => filter === 'MATCHED' ? !row.unmatched : row.unmatched);

  return (
    <section className="sectioning-weld-table h-48 shrink-0 border-t border-slate-200 bg-white" aria-label="Weld data table">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wide text-slate-700">Weld data</h3>
          <p className="text-[11px] text-slate-500">Red = GW has no pair; the detail column explains which side is missing.</p>
        </div>
        <div className="sectioning-weld-table__controls">
          <div className="sectioning-weld-table__filters" role="group" aria-label="Weld status filter">
            {(['ALL', 'MATCHED', 'MISSING'] as const).map((value) => <button key={value} type="button" className={filter === value ? 'is-active' : ''} onClick={() => setFilter(value)}>{value} <b>{value === 'ALL' ? rows.length : value === 'MATCHED' ? rows.filter((row) => !row.unmatched).length : rows.filter((row) => row.unmatched).length}</b></button>)}
          </div>
          <span className="text-xs font-semibold text-slate-600">{visibleRows.length.toLocaleString()} visible / {rows.length.toLocaleString()} rows</span>
        </div>
      </div>
      <div className="h-[142px] overflow-auto">
        <table className="min-w-full border-collapse text-left text-xs">
          <thead className="sticky top-0 z-10 bg-slate-100 text-[10px] uppercase tracking-wide text-slate-600">
            <tr>
              <th className="px-3 py-2">Run</th><th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Weld ID</th><th className="px-3 py-2 text-right">Abs distance (m)</th>
              <th className="px-3 py-2">Matched weld</th><th className="px-3 py-2 text-right">Matched abs distance (m)</th><th className="px-3 py-2">Evidence detail</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visibleRows.map((row) => (
              <tr key={row.key} className={row.unmatched ? 'bg-rose-50 text-rose-800' : 'text-slate-700 hover:bg-slate-50'}>
                <td className="whitespace-nowrap px-3 py-1.5 font-semibold">{row.run}</td>
                <td className="whitespace-nowrap px-3 py-1.5"><span className={`weld-status weld-status--${row.unmatched ? 'missing' : 'matched'}`}>{row.status}</span></td>
                <td className="whitespace-nowrap px-3 py-1.5">{row.id}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-right font-mono">{row.distance.toFixed(3)}</td>
                <td className="whitespace-nowrap px-3 py-1.5">{row.partnerId}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-right font-mono">{row.partnerDistance?.toFixed(3) ?? '-'}</td>
                <td className="whitespace-nowrap px-3 py-1.5">{row.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
