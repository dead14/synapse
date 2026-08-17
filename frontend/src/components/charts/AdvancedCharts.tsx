import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import Modal from '../common/Modal';
import DepthVsDistanceChart from './DepthVsDistanceChart';
import OrientationVsDistanceChart from './OrientationVsDistanceChart';
import CrVsDistanceChart from './CrVsDistanceChart';
import CrDistributionChart from './CrDistributionChart';
import { buildSectionBands } from '../../lib/sections/bands';
import type { SectionBandsPluginOptions } from '../../lib/sections/sectionBandsPlugin';
import SectionBandLegend from '../sections/SectionBandLegend';
import { Button, Segmented } from '../ds';

interface AdvancedChartsProps {
  data: any[];
  /**
   * `embedded` renders the charts inline inside a host panel — the form used on
   * Corrosion Analysis, where these figures belong with the rest of the
   * analysis. `modal` keeps the old full-screen overlay for any caller that
   * still opens them on their own.
   */
  variant?: 'modal' | 'embedded';
  onClose?: () => void;
}

type ChartTab = 'DepthVsDistance' | 'OrientationVsDistance' | 'CrVsDistance' | 'CrDistribution';

const CHART_TABS: Array<{ value: ChartTab; label: string }> = [
  { value: 'DepthVsDistance', label: 'Depth vs distance' },
  { value: 'OrientationVsDistance', label: 'Orientation vs distance' },
  { value: 'CrVsDistance', label: 'CR vs distance' },
  { value: 'CrDistribution', label: 'CR distribution' },
];

export default function AdvancedCharts({ data, variant = 'modal', onClose }: AdvancedChartsProps) {
  const [activeTab, setActiveTab] = useState<ChartTab>('DepthVsDistance');

  // Filter States
  const [matchedFilter, setMatchedFilter] = useState('Both'); // Run 1, Run 2, Both, Hide
  const [unmatchedFilter, setUnmatchedFilter] = useState('Both');
  const [depthType, setDepthType] = useState('Absolute'); // Absolute, Percentage
  const [defectTypes, setDefectTypes] = useState({ internal: true, external: true });
  const [multiMatchOnly, setMultiMatchOnly] = useState(false);
  const [visualType, setVisualType] = useState('Points'); // Points, Rectangles
  const [binSize, setBinSize] = useState(0.2);
  const [maxCr, setMaxCr] = useState(2);
  const [minCr, setMinCr] = useState(-2);
  const [heldBandId, setHeldBandId] = useState<string | null>(null);

  // Sections are read off the NEW run — the current state of the line, and the
  // axis every one of these charts is plotted against.
  const bands = useMemo(
    () => buildSectionBands(data.map((row) => ({
      distanceM: Number(row['Log Dist NEW (m)']),
      section: String(row['Section NEW'] ?? row.Section ?? '-'),
    }))),
    [data],
  );

  // Memoised so a filter toggle does not hand every chart a new options object
  // and force a full Chart.js update for nothing.
  const sectionBands = useMemo<SectionBandsPluginOptions | undefined>(
    () => (bands.length
      ? { bands, selectedId: heldBandId, onSelect: setHeldBandId, labelColor: '#ffffff' }
      : undefined),
    [bands, heldBandId],
  );

  const body: ReactNode = (
    <div className="adv-charts">
          <div className="ds-toolbar ds-toolbar--bare" style={{ minHeight: 0, padding: 0 }}>
            <Segmented<ChartTab>
              ariaLabel="Matching chart"
              value={activeTab}
              onChange={setActiveTab}
              options={CHART_TABS}
            />
          </div>

          {bands.length > 0 && activeTab !== 'CrDistribution' && (
            <SectionBandLegend bands={bands} selectedId={heldBandId} onSelect={setHeldBandId} />
          )}

          {/* Chart Area */}
          <div className="adv-charts__plot">
             {activeTab === 'DepthVsDistance' ? (
                <DepthVsDistanceChart 
                   data={data}
                   sectionBands={sectionBands} 
                   filters={{
                     matched: matchedFilter,
                     unmatched: unmatchedFilter,
                     depthType: depthType,
                     multiMatchOnly,
                     defectTypes
                   }} 
                />
             ) : activeTab === 'OrientationVsDistance' ? (
                <OrientationVsDistanceChart
                   data={data}
                   sectionBands={sectionBands}
                   filters={{
                     matched: matchedFilter,
                     unmatched: unmatchedFilter,
                     multiMatchOnly,
                     defectTypes,
                     visualType
                   }}
                />
             ) : activeTab === 'CrVsDistance' ? (
                <CrVsDistanceChart
                   data={data}
                   sectionBands={sectionBands}
                   filters={{
                     matched: matchedFilter,
                     unmatched: unmatchedFilter,
                     defectTypes
                   }}
                />
             ) : activeTab === 'CrDistribution' ? (
                <CrDistributionChart
                   data={data}
                   filters={{
                     matched: matchedFilter,
                     unmatched: unmatchedFilter,
                     defectTypes,
                     binSize,
                     maxCr,
                     minCr
                   }}
                />
             ) : (
               <div className="flex-1 border-2 border-dashed border-gray-200 rounded-xl flex items-center justify-center text-gray-400">
                  [ {activeTab} Chart Placeholder ]
               </div>
             )}
          </div>

          {/* Filter row — one row above the plot, scoping every chart */}
          <div className="adv-charts__filters">
            <fieldset className="adv-charts__group">
              <legend className="ds-panel__eyebrow">Matched ILI data</legend>
              {['Run 1', 'Run 2', 'Both', 'Hide'].map(val => (
                <label key={`m-${val}`} className="adv-charts__opt">
                  <input type="radio" name="matched-filter" checked={matchedFilter === val} onChange={() => setMatchedFilter(val)} />
                  <span>{val === 'Hide' ? 'Do not display' : val === 'Run 1' ? 'Run 1 (old)' : val === 'Run 2' ? 'Run 2 (new)' : 'Both'}</span>
                </label>
              ))}
              {activeTab !== 'CrVsDistance' && activeTab !== 'CrDistribution' && (
                <label className="adv-charts__opt">
                  <input type="checkbox" checked={multiMatchOnly} onChange={e => setMultiMatchOnly(e.target.checked)} />
                  <span>Multi match only</span>
                </label>
              )}
            </fieldset>

            <fieldset className="adv-charts__group">
              {/* The two POF outcomes of a run comparison, kept on their run
                  labels: run 1 alone is a missing feature, run 2 alone a new one. */}
              <legend className="ds-panel__eyebrow">Missing / new ILI data</legend>
              {['Run 1', 'Run 2', 'Both', 'Hide'].map(val => (
                <label key={`um-${val}`} className="adv-charts__opt">
                  <input type="radio" name="unmatched-filter" checked={unmatchedFilter === val} onChange={() => setUnmatchedFilter(val)} />
                  <span>{val === 'Hide' ? 'Do not display' : val === 'Run 1' ? 'Run 1 (missing)' : val === 'Run 2' ? 'Run 2 (new)' : 'Both'}</span>
                </label>
              ))}
            </fieldset>

            <fieldset className="adv-charts__group">
              <legend className="ds-panel__eyebrow">Defect types</legend>
              {activeTab === 'DepthVsDistance' && ['Absolute', 'Percentage'].map(val => (
                <label key={`depth-${val}`} className="adv-charts__opt">
                  <input type="radio" name="depth-type" checked={depthType === val} onChange={() => setDepthType(val)} />
                  <span>{val === 'Percentage' ? 'Depth as % of WT' : 'Depth absolute'}</span>
                </label>
              ))}
              <label className="adv-charts__opt">
                <input type="checkbox" checked={defectTypes.internal} onChange={e => setDefectTypes({ ...defectTypes, internal: e.target.checked })} />
                <span>Internal</span>
              </label>
              <label className="adv-charts__opt">
                <input type="checkbox" checked={defectTypes.external} onChange={e => setDefectTypes({ ...defectTypes, external: e.target.checked })} />
                <span>External</span>
              </label>
            </fieldset>

            {(activeTab === 'OrientationVsDistance' || activeTab === 'CrDistribution') && (
              <fieldset className="adv-charts__group">
                <legend className="ds-panel__eyebrow">
                  {activeTab === 'OrientationVsDistance' ? 'Mark type' : 'Histogram'}
                </legend>
                {activeTab === 'OrientationVsDistance' ? ['Points', 'Rectangles'].map(val => (
                  <label key={`vis-${val}`} className="adv-charts__opt">
                    <input type="radio" name="visual-type" checked={visualType === val} onChange={() => setVisualType(val)} />
                    <span>{val}</span>
                  </label>
                )) : (
                  <>
                    <label className="adv-charts__num">
                      <span>Bin size</span>
                      <input className="ds-input ds-input--sm" type="number" step="0.1" value={binSize} onChange={e => setBinSize(parseFloat(e.target.value) || 0.2)} />
                    </label>
                    <label className="adv-charts__num">
                      <span>Maximum</span>
                      <input className="ds-input ds-input--sm" type="number" value={maxCr} onChange={e => setMaxCr(parseFloat(e.target.value) || 2)} />
                    </label>
                    <label className="adv-charts__num">
                      <span>Minimum</span>
                      <input className="ds-input ds-input--sm" type="number" value={minCr} onChange={e => setMinCr(parseFloat(e.target.value) || -2)} />
                    </label>
                  </>
                )}
              </fieldset>
            )}
          </div>
    </div>
  );

  if (variant === 'embedded') return body;

  return (
    <Modal
      onClose={onClose ?? (() => {})}
      labelledBy="advanced-analytics-title"
      closeOnBackdrop={false}
      overlayClassName="fixed inset-0 z-[999999]"
      panelClassName="h-full w-full flex flex-col overflow-hidden animate-fade-in"
    >
      <div className="ds-panel" style={{ height: '100%', borderRadius: 0 }}>
        <div className="ds-panel__header">
          <div className="ds-panel__heading">
            <p className="ds-panel__eyebrow">Run pair</p>
            <h3 className="ds-panel__title" id="advanced-analytics-title">Defect &amp; CR matching overview</h3>
          </div>
          <div className="ds-panel__actions">
            <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close analytics">Close</Button>
          </div>
        </div>
        <div className="ds-panel__body" style={{ overflowY: 'auto' }}>{body}</div>
      </div>
    </Modal>
  );
}
