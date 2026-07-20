import { useMemo, useState } from 'react';
import { FiAlertTriangle, FiArrowLeft, FiArrowRight, FiCheckCircle, FiDatabase, FiLayers } from 'react-icons/fi';

import { buildDataReview } from '../domain/alignmentReview';

interface StepDataSummaryProps {
  onNext: (data?: any) => void;
  onBack: () => void;
  config?: any;
}

type ReviewRun = {
  name: string;
  total: number;
  anomalies: number;
  welds: number;
  valves: number;
  tees: number;
  offtakes: number;
  bends: number;
  others: number;
  gwAnchors: number;
  invalidAnchorDistances: number;
  rawFeatures: any[];
};

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : 0;
}

function reviewRun(value: any): ReviewRun {
  return {
    name: typeof value?.name === 'string' && value.name.trim() ? value.name : 'Not recorded',
    total: numberValue(value?.total),
    anomalies: numberValue(value?.anomalies),
    welds: numberValue(value?.welds),
    valves: numberValue(value?.valves),
    tees: numberValue(value?.tees),
    offtakes: numberValue(value?.offtakes),
    bends: numberValue(value?.bends),
    others: numberValue(value?.others),
    gwAnchors: numberValue(value?.gwAnchors),
    invalidAnchorDistances: numberValue(value?.invalidAnchorDistances),
    rawFeatures: Array.isArray(value?.rawFeatures) ? value.rawFeatures : [],
  };
}

function typeName(feature: any): string {
  const value = feature?.type ?? feature?.featureType ?? feature?.originalType ?? feature?.['Feature Type'] ?? 'Other';
  return String(value).trim().replace(/\s+/g, ' ') || 'Other';
}

function RunEvidenceCard({ label, tone, run }: { label: string; tone: 'master' | 'historical'; run: ReviewRun }) {
  const featureCounts = [
    { label: 'Metal loss', value: run.anomalies },
    { label: 'Welds', value: run.welds },
    { label: 'Valves', value: run.valves },
    { label: 'Tees', value: run.tees },
    { label: 'Offtakes', value: run.offtakes },
    { label: 'Bends', value: run.bends },
    { label: 'Other features', value: run.others },
  ];

  return (
    <article className={`alignment-review-run alignment-review-run--${tone}`}>
      <header>
        <div>
          <span>{label}</span>
          <h3>{run.name}</h3>
        </div>
        <b>{tone === 'master' ? 'NEW · MASTER' : 'OLD · HISTORICAL'}</b>
      </header>
      <div className="alignment-review-run__body">
        <div className="alignment-review-run__total"><span>Total features</span><strong>{run.total.toLocaleString()}</strong></div>
        <div className="alignment-review-run__anchor">
          <span>GW anchors</span>
          <strong>{run.gwAnchors.toLocaleString()}</strong>
          <small>reference points</small>
        </div>
        <dl>
          {featureCounts.map(({ label: featureLabel, value }) => <div key={featureLabel}><dt>{featureLabel}</dt><dd>{value.toLocaleString()}</dd></div>)}
        </dl>
      </div>
    </article>
  );
}

export default function StepDataSummary({ onNext, onBack, config }: StepDataSummaryProps) {
  const summary = config?.summaryData ?? {};
  const masterRun = reviewRun(summary.newRun);
  const historicalRun = reviewRun(summary.oldRun);
  const hasPersistedRunPair = Number.isSafeInteger(Number(summary.newRun?.runId))
    && Number(summary.newRun?.runId) > 0
    && Number.isSafeInteger(Number(summary.oldRun?.runId))
    && Number(summary.oldRun?.runId) > 0
    && Number(summary.newRun?.runId) !== Number(summary.oldRun?.runId);
  const hasRunPair = masterRun.total > 0 && historicalRun.total > 0 && hasPersistedRunPair;
  const [acknowledged, setAcknowledged] = useState(config?.dataReview?.status === 'acknowledged');

  const inventory = useMemo(() => {
    const rows = [...masterRun.rawFeatures.map((feature) => ({ feature, run: 'master' })), ...historicalRun.rawFeatures.map((feature) => ({ feature, run: 'historical' }))];
    const fields = new Set(rows.flatMap(({ feature }) => Object.keys(feature ?? {})));
    return Array.from(new Set(rows.map(({ feature }) => typeName(feature)))).map((type) => {
      const typeRows = rows.filter(({ feature }) => typeName(feature) === type);
      const master = typeRows.filter((row) => row.run === 'master').length;
      const historical = typeRows.length - master;
      const populated = Array.from(fields).filter((field) => typeRows.some(({ feature }) => feature?.[field] !== null && feature?.[field] !== undefined && String(feature[field]).trim() !== '')).length;
      return { type, master, historical, total: typeRows.length, populated };
    }).sort((left, right) => right.total - left.total || left.type.localeCompare(right.type));
  }, [masterRun.rawFeatures, historicalRun.rawFeatures]);

  const hasQualityWarning = masterRun.invalidAnchorDistances > 0 || historicalRun.invalidAnchorDistances > 0;
  const invalidAnchorCount = masterRun.invalidAnchorDistances + historicalRun.invalidAnchorDistances;
  const continueReview = () => {
    const dataReview = buildDataReview({ newRun: masterRun, oldRun: historicalRun }, acknowledged);
    if (dataReview) onNext({ dataReview });
  };

  return (
    <section className="alignment-data-review" aria-labelledby="data-review-title">
      <header className="alignment-review-heading">
        <div className="alignment-review-heading__icon"><FiDatabase aria-hidden="true" /></div>
        <div className="alignment-review-heading__copy"><p>Persisted inspection evidence</p><h2 id="data-review-title">Data review</h2><span>Confirm the extracted master and historical evidence before alignment begins.</span></div>
        {hasRunPair && <div className="alignment-review-heading__status"><FiCheckCircle aria-hidden="true" /><span>Two runs ready</span></div>}
      </header>

      {!hasRunPair ? (
        <div className="alignment-review-empty" role="status"><FiAlertTriangle aria-hidden="true" /><div><strong>Two persisted inspection runs are required</strong><span>Return to Inspection data and import one master and one historical run before continuing.</span></div></div>
      ) : (
        <>
          <div className="alignment-review-run-grid"><RunEvidenceCard label="Master run" tone="master" run={masterRun} /><RunEvidenceCard label="Historical run" tone="historical" run={historicalRun} /></div>

          <section className={`alignment-review-readiness ${hasQualityWarning ? 'is-warning' : 'is-ready'}`} aria-label="Evidence readiness">
            {hasQualityWarning ? <FiAlertTriangle aria-hidden="true" /> : <FiCheckCircle aria-hidden="true" />}
            <div><strong>{hasQualityWarning ? 'Anchor data needs attention' : 'Extraction evidence is ready for GW matching'}</strong><span>{hasQualityWarning ? 'One or more anchors have invalid upstream-GW distance values. Review them before relying on automated locks.' : 'Both persisted runs contain feature and anchor evidence.'}</span></div>
            <small>{hasQualityWarning ? `${invalidAnchorCount.toLocaleString()} invalid GW distance${invalidAnchorCount === 1 ? '' : 's'}` : '0 invalid GW distances'}</small>
          </section>

          <section className="alignment-review-inventory" aria-labelledby="data-inventory-title">
            <header><div><p>Feature inventory</p><h3 id="data-inventory-title">Coverage by extracted class</h3></div><span>{(masterRun.rawFeatures.length + historicalRun.rawFeatures.length).toLocaleString()} source records</span></header>
            {inventory.length === 0 ? <div className="alignment-review-inventory__empty"><FiLayers aria-hidden="true" />Detailed source rows are unavailable; aggregate counts above remain persisted for this session.</div> : <div className="alignment-review-inventory__table-wrap"><table><thead><tr><th>Feature class</th><th>NEW</th><th>OLD</th><th>Total</th><th>Fields</th></tr></thead><tbody>{inventory.map((row) => <tr key={row.type}><th scope="row">{row.type}</th><td>{row.master.toLocaleString()}</td><td>{row.historical.toLocaleString()}</td><td>{row.total.toLocaleString()}</td><td>{row.populated}</td></tr>)}</tbody></table></div>}
          </section>

          <label className="alignment-review-acknowledgement"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /><span><strong>I reviewed the extracted evidence.</strong><small>This acknowledgement is saved with the alignment session and used as the review record for this run pair.</small></span></label>
        </>
      )}

      <footer className="alignment-review-actions"><button type="button" className="syn-action syn-action--outline" onClick={onBack}><FiArrowLeft aria-hidden="true" />Back to inspection data</button><button type="button" className="syn-action syn-action--ink" onClick={continueReview} disabled={!hasRunPair || !acknowledged} aria-describedby={!hasRunPair || !acknowledged ? 'data-review-action-help' : undefined}>Continue to GW matching<FiArrowRight aria-hidden="true" /></button></footer>
      {(!hasRunPair || !acknowledged) && <p id="data-review-action-help" className="alignment-review-action-help">{hasRunPair ? 'Confirm the acknowledgement to continue.' : 'Import both runs to continue.'}</p>}
    </section>
  );
}
