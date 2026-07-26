import React, { useMemo, useState } from 'react';
import { sourceOdometerDistance } from '../domain/gwTimeline';
import { maxOf } from '../utils/numericRange.ts';

export default function OdometerDashboard({ matches, ota, setOta, dtwOn: _dtwOn, setDtwOn: _setDtwOn }: any) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const samples = useMemo(() => matches
    .map((match: any, index: number) => {
      const oldDistance = sourceOdometerDistance(match, 'old');
      const newDistance = sourceOdometerDistance(match, 'new');
      const ratioValue = Number(match.deviationRatio);
      const percentValue = Number(match.rawVarPct ?? match.varPct ?? match.otaPercent);
      const deviationPct = Number.isFinite(ratioValue)
        ? Math.abs(ratioValue) * 100
        : Number.isFinite(percentValue)
          ? Math.abs(percentValue)
          : 0;

      return {
        id: match.id ?? `sample-${index}`,
        label: match.oldDesc || match.newDesc || `Joint ${index + 1}`,
        oldDistance,
        newDistance,
        offset: newDistance - oldDistance,
        deviationPct,
        // Re-evaluate the review state from the current slider value.
        // `match.flagged` was calculated with the previous OTA value and
        // must not keep a joint flagged after the user raises the threshold.
        flagged: deviationPct > ota,
      };
    })
    .filter((sample: any) => Number.isFinite(sample.oldDistance) && Number.isFinite(sample.newDistance))
    .sort((left: any, right: any) => left.oldDistance - right.oldDistance), [matches, ota]);

  const maxDrift = maxOf(samples.map((sample: any) => Math.abs(sample.offset)));
  const avgSlip = samples.length > 0 ? samples.reduce((total: number, sample: any) => total + sample.deviationPct, 0) / samples.length : 0;
  const flaggedCount = samples.filter((sample: any) => sample.flagged).length;
  const selectedSample = samples[Math.min(selectedIndex, Math.max(samples.length - 1, 0))];
  const worstSamples = useMemo(() => [...samples]
    .sort((left: any, right: any) => right.deviationPct - left.deviationPct)
    .slice(0, 5), [samples]);
  const statusText = flaggedCount > 0
    ? `${flaggedCount} joints exceed the OTA. Review the red joints before continuing.`
    : 'All matched joints are within the current OTA tolerance.';

  return (
    <div className="w-full flex flex-col gap-5">
      <div className="rounded-xl border border-blue-100 bg-blue-50/70 px-4 py-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h4 className="text-sm font-semibold text-gray-900">What this panel checks</h4>
            <p className="mt-1 text-xs leading-relaxed text-gray-600">
              Validates whether matched weld spacing is physically consistent after alignment. Spikes indicate possible odometer slippage, skipped welds, repair spool insertion, or a bad anchor match.
            </p>
          </div>
          <div className="min-w-[220px] rounded-lg border border-blue-200 bg-white px-3 py-2">
            <label className="flex items-center justify-between text-xs font-semibold text-gray-700">
              <span>Review threshold</span>
              <span className="font-mono text-blue-700">{ota}% OTA</span>
            </label>
            <input
              type="range"
              min="0.1"
              max="10"
              step="0.1"
              value={ota}
              onChange={(event) => setOta?.(parseFloat(event.target.value))}
              className="mt-2 w-full accent-blue-600"
              aria-label="Set OTA review threshold"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
          <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
            <svg className="w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
          </div>
          <div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Max Drift</div>
            <div className="text-sm font-bold font-mono text-gray-800">+{maxDrift.toFixed(2)}m</div>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
          <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center">
            <svg className="w-4 h-4 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
          </div>
          <div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Avg Slippage</div>
            <div className="text-sm font-bold font-mono text-gray-800">{avgSlip.toFixed(2)}%</div>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
          <div className={`w-8 h-8 rounded-lg ${flaggedCount > 0 ? 'bg-red-50' : 'bg-green-50'} flex items-center justify-center`}>
            <svg className={`w-4 h-4 ${flaggedCount > 0 ? 'text-red-500' : 'text-green-500'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>
          </div>
          <div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Flagged {'>'} {ota}%</div>
            <div className={`text-sm font-bold font-mono ${flaggedCount > 0 ? 'text-red-500' : 'text-green-600'}`}>{flaggedCount} Joints</div>
          </div>
        </div>
      </div>

      <div className={`rounded-xl border px-4 py-3 text-sm ${flaggedCount > 0 ? 'border-red-200 bg-red-50 text-red-800' : 'border-green-200 bg-green-50 text-green-800'}`}>
        <div className="font-semibold">Engineering decision</div>
        <div className="mt-1 text-xs">{statusText}</div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-theme-xs">
          <div className="border-b border-gray-100 px-4 py-3">
            <h4 className="text-sm font-semibold text-gray-800">Joints to review first</h4>
            <p className="mt-1 text-xs text-gray-500">Sorted by highest OTA deviation. Click a row to inspect its drift and tolerance status.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead className="bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Old run</th>
                  <th className="px-4 py-2">New run</th>
                  <th className="px-4 py-2 text-right">Drift</th>
                  <th className="px-4 py-2 text-right">OTA</th>
                  <th className="px-4 py-2">Likely action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {worstSamples.map((sample: any) => {
                  const originalIndex = samples.findIndex((item: any) => item.id === sample.id);
                  return (
                    <tr
                      key={sample.id}
                      onClick={() => setSelectedIndex(Math.max(originalIndex, 0))}
                      className={`cursor-pointer transition-colors hover:bg-blue-50 ${originalIndex === selectedIndex ? 'bg-blue-50' : ''}`}
                    >
                      <td className="px-4 py-2">
                        <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${sample.flagged ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
                          {sample.flagged ? 'Review' : 'OK'}
                        </span>
                      </td>
                      <td className="px-4 py-2 font-mono text-gray-800">{sample.oldDistance.toFixed(3)} m</td>
                      <td className="px-4 py-2 font-mono text-gray-800">{sample.newDistance.toFixed(3)} m</td>
                      <td className="px-4 py-2 text-right font-mono text-gray-800">{sample.offset.toFixed(3)} m</td>
                      <td className={`px-4 py-2 text-right font-mono font-semibold ${sample.flagged ? 'text-red-600' : 'text-green-700'}`}>{sample.deviationPct.toFixed(2)}%</td>
                      <td className="px-4 py-2 text-gray-600">{sample.flagged ? 'Check anchor / spool evidence' : 'No action needed'}</td>
                    </tr>
                  );
                })}
                {worstSamples.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-gray-500">No matched joints available for odometer review.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-theme-xs">
          <h4 className="text-sm font-semibold text-gray-800">Selected joint</h4>
          {selectedSample ? (
            <div className="mt-4 space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Old run</span>
                <span className="font-mono font-semibold text-gray-800">{selectedSample.oldDistance.toFixed(3)} m</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500">New run</span>
                <span className="font-mono font-semibold text-gray-800">{selectedSample.newDistance.toFixed(3)} m</span>
              </div>
              <div className="flex items-center justify-between border-t border-gray-100 pt-3">
                <span className="text-gray-500">Raw drift</span>
                <span className="font-mono font-semibold text-gray-800">{selectedSample.offset.toFixed(3)} m</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500">OTA deviation</span>
                <span className={`font-mono font-semibold ${selectedSample.flagged ? 'text-red-600' : 'text-green-700'}`}>{selectedSample.deviationPct.toFixed(2)}%</span>
              </div>
              <div className={`rounded-lg px-3 py-2 ${selectedSample.flagged ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
                {selectedSample.flagged
                  ? 'This joint exceeds the current tolerance. Treat it as an engineering review item, not an automatic match.'
                  : 'This joint supports the current alignment under the selected tolerance.'}
              </div>
            </div>
          ) : (
            <p className="mt-3 text-xs text-gray-500">Select a point or row to inspect the joint.</p>
          )}
        </div>
      </div>
    </div>
  );
}
