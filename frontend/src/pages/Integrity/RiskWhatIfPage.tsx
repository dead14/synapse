import { useMemo, useState } from 'react';
import { FiAlertTriangle, FiTrendingDown } from 'react-icons/fi';
import PageMeta from '../../components/common/PageMeta';
import { compareLinePipeRiskScenarios } from '../../lib/risk';

const evidence = { completeness: 0.8, verification: 0.8, recency: 0.7 };
function factor(id: string, value: number) {
  return { id, value, unit: 'fraction' as const, weight: 1, uncertainty: { lower: Math.max(0, value - 0.1), upper: Math.min(1, value + 0.1) }, evidence };
}

export default function RiskWhatIfPage() {
  const [likelihood, setLikelihood] = useState(0.7);
  const [consequence, setConsequence] = useState(0.6);
  const [mitigation, setMitigation] = useState(0.3);
  const comparison = useMemo(() => compareLinePipeRiskScenarios({
    segmentId: 'ACTIVE-SEGMENT', scenarioId: 'CURRENT',
    likelihoodFactors: [factor('THREAT_LIKELIHOOD', likelihood)],
    consequenceFactors: [factor('CONSEQUENCE', consequence)],
  }, [{
    segmentId: 'ACTIVE-SEGMENT', scenarioId: 'MITIGATED',
    likelihoodFactors: [factor('THREAT_LIKELIHOOD', Math.max(0, likelihood - mitigation))],
    consequenceFactors: [factor('CONSEQUENCE', consequence)],
  }]), [likelihood, consequence, mitigation]);
  const alternative = comparison.alternatives[0];
  const controls = [
    { label: 'Likelihood', value: likelihood, setValue: setLikelihood },
    { label: 'Consequence', value: consequence, setValue: setConsequence },
    { label: 'Mitigation reduction', value: mitigation, setValue: setMitigation },
  ];

  return <div className="syn-page syn-ui-kit"><PageMeta title="Pipeline Risk & What-if · Synapse" description="Transparent qualitative risk and mitigation comparison" /><div className="syn-shell">
    <header className="syn-page__header"><div><p className="syn-eyebrow">Transparent pipeline risk</p><h1 className="syn-page__title">Risk drivers & what-if mitigation</h1><p className="syn-page__subtitle">A visible relative-risk model with uncertainty, evidence quality, scenario deltas, and explicit limitations.</p></div></header>
    <div className="grid gap-4 xl:grid-cols-[.65fr_1.35fr]">
      <section className="syn-panel grid gap-5 p-5">
        {controls.map(({ label, value, setValue }) => <label key={label} className="grid gap-2 text-sm font-medium">{label} <strong className="syn-data">{value.toFixed(2)}</strong><input type="range" min="0" max="1" step="0.01" value={value} onChange={(event) => setValue(Number(event.target.value))} /></label>)}
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"><FiAlertTriangle className="mb-2" />Qualitative internal screening only. This is not probability of failure, a regulatory repair criterion, or API 580/581 compliance.</div>
      </section>
      <section className="grid gap-4 md:grid-cols-2">
        <article className="syn-panel p-5"><p className="syn-kicker">Current scenario</p><strong className="syn-data mt-4 block text-5xl">{comparison.baseline.risk.index.toFixed(3)}</strong><span className="syn-pill syn-pill--warning mt-3">{comparison.baseline.risk.band.id}</span><p className="syn-copy mt-4">Interval {comparison.baseline.risk.interval.lower.toFixed(3)}–{comparison.baseline.risk.interval.upper.toFixed(3)}</p></article>
        <article className="syn-panel syn-panel--signal p-5"><p className="syn-kicker">Mitigated scenario</p><strong className="syn-data mt-4 block text-5xl">{alternative.assessment.risk.index.toFixed(3)}</strong><span className="syn-pill syn-pill--signal mt-3"><FiTrendingDown />{alternative.direction}</span><p className="mt-4 text-sm">Risk delta {alternative.delta.riskIndex.toFixed(3)} · reduction {alternative.delta.riskReductionFraction == null ? 'N/A' : `${Math.round(alternative.delta.riskReductionFraction * 100)}%`}</p></article>
        <article className="syn-panel p-5 md:col-span-2"><p className="syn-kicker">Decision confidence</p><div className="mt-4 grid gap-3 md:grid-cols-3"><div><strong className="syn-data text-2xl">{Math.round(comparison.baseline.confidence.dataQualityIndex * 100)}%</strong><small className="block">Data quality</small></div><div><strong className="syn-data text-2xl">{Math.round(comparison.baseline.confidence.inputUncertaintyIndex * 100)}%</strong><small className="block">Input uncertainty</small></div><div><strong className="syn-data text-2xl">{Math.round(comparison.baseline.confidence.decisionConfidenceIndex * 100)}%</strong><small className="block">Decision confidence</small></div></div><p className="syn-copy mt-5">Method {comparison.baseline.provenance.method.id} · version {comparison.baseline.provenance.method.version} · {comparison.baseline.provenance.method.equation}</p></article>
      </section>
    </div>
  </div></div>;
}
