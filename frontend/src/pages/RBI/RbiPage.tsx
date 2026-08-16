/**
 * Risk-based inspection, API 580.
 *
 * The likelihood side is read from a filed FFS assessment rather than asked for:
 * the metal loss has already been measured and assessed to B31G, and that is
 * stronger evidence than any workshop scoring. The engineer supplies the
 * consequence side, which nothing in an ILI file can know, and the page is
 * explicit about which half of the risk is measured and which is judgement.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { FiAlertTriangle, FiDownload, FiRefreshCw, FiShield } from 'react-icons/fi';

import PageMeta from '../../components/common/PageMeta';
import SynButton from '../../components/ui/SynButton';
import { Callout, Panel } from '../../components/ffs/FfsPrimitives';
import { fetchFfsSession, listFfsSessions, type FfsSessionListItem } from '../../lib/ffs/sessions';
import { screenResults } from '../../lib/ffs/screening';
import type { RevivedFfsShareState } from '../../lib/ffs/shareState';
import { buildRbiAssessment } from '../../lib/rbi/fromFfs';
import { exportRbiWorkbook } from '../../lib/rbi/exports';
import { RISK_LEVELS, RISK_MATRIX } from '../../lib/rbi/api580';
import type { RbiAssessment, RbiConsequenceInput, RiskLevel } from '../../lib/rbi/types';

const DEFAULT_CONSEQUENCE: Omit<RbiConsequenceInput, 'outerDiameterMm' | 'operatingPressureMpa'> = {
  fluid: 'crude-oil',
  population: 'rural',
  environment: 'moderate',
  businessImpact: 'moderate',
};

const FLUIDS: { value: RbiConsequenceInput['fluid']; label: string }[] = [
  { value: 'sour-gas', label: 'Sour gas (H₂S)' },
  { value: 'sweet-gas', label: 'Sweet gas' },
  { value: 'crude-oil', label: 'Crude oil' },
  { value: 'refined-product', label: 'Refined product' },
  { value: 'produced-water', label: 'Produced water' },
  { value: 'water', label: 'Water' },
];

const POPULATIONS: { value: RbiConsequenceInput['population']; label: string }[] = [
  { value: 'remote', label: 'Remote / no dwellings' },
  { value: 'rural', label: 'Rural' },
  { value: 'suburban', label: 'Suburban' },
  { value: 'urban', label: 'Urban / high occupancy' },
];

const ENVIRONMENTS: { value: RbiConsequenceInput['environment']; label: string }[] = [
  { value: 'low', label: 'Low sensitivity' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'sensitive', label: 'Sensitive (waterway, aquifer)' },
  { value: 'protected', label: 'Protected area' },
];

const BUSINESS: { value: RbiConsequenceInput['businessImpact']; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical / no redundancy' },
];

const LEVEL_CLASS: Record<RiskLevel, string> = {
  Low: 'rbi-cell rbi-cell--low',
  Medium: 'rbi-cell rbi-cell--medium',
  'Medium high': 'rbi-cell rbi-cell--medium-high',
  High: 'rbi-cell rbi-cell--high',
};

function formatMetres(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(0)} m`;
}

export default function RbiPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const requestedSessionId = useMemo(
    () => new URLSearchParams(location.search).get('ffsSessionId'),
    [location.search],
  );

  const [sessions, setSessions] = useState<FfsSessionListItem[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string>(requestedSessionId ?? '');
  const [caseState, setCaseState] = useState<RevivedFfsShareState | null>(null);
  const [caseLoading, setCaseLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consequence, setConsequence] = useState(DEFAULT_CONSEQUENCE);

  useEffect(() => {
    let cancelled = false;
    setSessionsLoading(true);
    listFfsSessions(100)
      .then((items) => {
        if (cancelled) return;
        setSessions(items);
        setSelectedId((current) => (
          current && items.some((item) => item.id === current) ? current : items[0]?.id ?? ''
        ));
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : 'Filed FFS assessments could not be loaded.');
        }
      })
      .finally(() => { if (!cancelled) setSessionsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setCaseState(null);
      return;
    }
    let cancelled = false;
    setCaseLoading(true);
    setError(null);
    fetchFfsSession(selectedId)
      .then((loaded) => {
        if (cancelled) return;
        if (!loaded) {
          setCaseState(null);
          setError('That FFS assessment carries no readable result, so no risk can be derived from it.');
          return;
        }
        setCaseState(loaded.state);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setCaseState(null);
        setError(caught instanceof Error ? caught.message : 'The FFS assessment could not be loaded.');
      })
      .finally(() => { if (!cancelled) setCaseLoading(false); });
    return () => { cancelled = true; };
  }, [selectedId]);

  /**
   * The same screening the FFS workspace applies, from the same stored case.
   *
   * Re-deriving it here rather than storing a second copy is what keeps the risk
   * ranking and the assessment it cites from drifting apart.
   */
  const screened = useMemo(
    () => (caseState ? screenResults(caseState.results, caseState.config, caseState.screening) : []),
    [caseState],
  );

  const assessment: RbiAssessment | null = useMemo(() => {
    if (!caseState || screened.length === 0) return null;
    return buildRbiAssessment({
      ffsSessionId: selectedId || null,
      state: caseState,
      screened,
      consequence: {
        ...consequence,
        // Line size and pressure are properties of the line the assessment was
        // run on, so they are read from the case rather than typed again.
        outerDiameterMm: screened[0]?.nominal.od ?? 0,
        operatingPressureMpa: screened[0]?.nominal.p0 ?? 0,
      },
    });
  }, [caseState, screened, consequence, selectedId]);

  const selectSession = useCallback((id: string) => {
    setSelectedId(id);
    navigate(id ? `/rbi?ffsSessionId=${encodeURIComponent(id)}` : '/rbi', { replace: true });
  }, [navigate]);

  return (
    <div className="syn-page syn-ui-kit">
      <PageMeta title="Risk-based inspection · Synapse" description="API 580 risk ranking from filed FFS assessments" />

      <div className="syn-page__header">
        <div className="min-w-0">
          <p className="syn-eyebrow">Assessment · API 580</p>
          <h1 className="syn-page__title">Risk-based inspection</h1>
          <p className="syn-page__subtitle">
            Likelihood from the metal loss a filed FFS assessment already measured; consequence from what the
            line carries and where it runs. The plan follows from where the two meet.
          </p>
        </div>
        {assessment && (
          <SynButton variant="lime" size="sm" onClick={() => exportRbiWorkbook(assessment)}>
            <span className="inline-flex items-center gap-2"><FiDownload /> Export Excel</span>
          </SynButton>
        )}
      </div>

      {error && (
        <Callout tone="warn">
          <span className="inline-flex items-start gap-2">
            <FiAlertTriangle className="mt-0.5 shrink-0" aria-hidden="true" /><span>{error}</span>
          </span>
        </Callout>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        {/* Inputs */}
        <div className="space-y-4">
          <Panel>
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Source assessment</p>
            <label className="mt-2.5 block text-xs font-semibold text-slate-500">
              Filed FFS assessment
              <select
                value={selectedId}
                onChange={(event) => selectSession(event.target.value)}
                disabled={sessionsLoading || caseLoading}
                className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                <option value="">Select a filed assessment</option>
                {sessions.map((session) => (
                  <option key={session.id} value={session.id}>
                    {session.label} · {session.featureCount.toLocaleString()} features
                  </option>
                ))}
              </select>
            </label>
            {sessionsLoading && <p className="mt-2 text-xs text-slate-500">Loading filed assessments…</p>}
            {!sessionsLoading && sessions.length === 0 && (
              <p className="mt-2 text-xs text-amber-600">
                No FFS assessment has been filed yet. Run one from the{' '}
                <Link to="/alignment-history" className="font-semibold text-indigo-600 hover:underline">
                  ILI alignment registry
                </Link>{' '}
                first — API 580 needs measured damage to rank, and this product will not invent it.
              </p>
            )}
            {caseLoading && (
              <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-slate-500">
                <FiRefreshCw className="animate-spin" aria-hidden="true" /> Reading the filed assessment…
              </p>
            )}
            {assessment && (
              <p className="mt-2 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                {assessment.lineName} · {assessment.totals.features.toLocaleString()} assessed features ·
                inspection dated {assessment.assessmentDateIso}
                {assessment.totals.unassessed > 0
                  && ` · ${assessment.totals.unassessed.toLocaleString()} anomalies carried no B31G result`}
              </p>
            )}
          </Panel>

          <Panel>
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Consequence of failure</p>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
              Entered, not measured. An inspection run knows the metal loss; it does not know what the line
              carries or who lives beside it. Every value here is reported in the assessment as a stated input.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-semibold text-slate-500">
                Fluid
                <select
                  value={consequence.fluid}
                  onChange={(event) => setConsequence((previous) => ({
                    ...previous, fluid: event.target.value as RbiConsequenceInput['fluid'],
                  }))}
                  className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  {FLUIDS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-semibold text-slate-500">
                Population exposure
                <select
                  value={consequence.population}
                  onChange={(event) => setConsequence((previous) => ({
                    ...previous, population: event.target.value as RbiConsequenceInput['population'],
                  }))}
                  className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  {POPULATIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-semibold text-slate-500">
                Environment
                <select
                  value={consequence.environment}
                  onChange={(event) => setConsequence((previous) => ({
                    ...previous, environment: event.target.value as RbiConsequenceInput['environment'],
                  }))}
                  className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  {ENVIRONMENTS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-semibold text-slate-500">
                Business impact
                <select
                  value={consequence.businessImpact}
                  onChange={(event) => setConsequence((previous) => ({
                    ...previous, businessImpact: event.target.value as RbiConsequenceInput['businessImpact'],
                  }))}
                  className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  {BUSINESS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
            </div>
          </Panel>

          {assessment && (
            <Panel>
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Method and limits</p>
              <p className="mt-1 text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                {assessment.provenance.edition} · {assessment.provenance.approach}
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                {assessment.provenance.rules.map((rule) => <li key={rule}>{rule}</li>)}
              </ul>
              <p className="mt-3 text-[11px] font-semibold text-slate-700 dark:text-slate-200">What this is not</p>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                {assessment.provenance.limitations.map((limit) => <li key={limit}>{limit}</li>)}
              </ul>
            </Panel>
          )}
        </div>

        {/* Results */}
        <div className="space-y-4">
          {!assessment && !caseLoading && (
            <Callout tone="info">
              <span className="inline-flex items-start gap-2">
                <FiShield className="mt-0.5 shrink-0" aria-hidden="true" />
                <span>
                  Select a filed FFS assessment. Its measured metal loss becomes the likelihood side of the
                  risk; nothing here is scored from opinion.
                </span>
              </span>
            </Callout>
          )}

          {assessment && (
            <>
              <Panel>
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Risk matrix</p>
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  Likelihood down, consequence across. The number in a cell is how many units of this line
                  landed there.
                </p>
                <div className="mt-3 overflow-x-auto">
                  <table className="rbi-matrix">
                    <caption className="sr-only">API 580 five by five risk matrix</caption>
                    <thead>
                      <tr>
                        <th scope="col" className="rbi-matrix__corner">L \ C</th>
                        {[1, 2, 3, 4, 5].map((consequenceCategory) => (
                          <th key={consequenceCategory} scope="col">{consequenceCategory}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[5, 4, 3, 2, 1].map((likelihood) => (
                        <tr key={likelihood}>
                          <th scope="row">{likelihood}</th>
                          {[1, 2, 3, 4, 5].map((consequenceCategory) => {
                            const level = RISK_MATRIX[likelihood - 1][consequenceCategory - 1];
                            const occupants = assessment.units.filter((unit) => (
                              unit.likelihood.category === likelihood
                              && unit.consequence.category === consequenceCategory
                            )).length;
                            return (
                              <td
                                key={consequenceCategory}
                                className={LEVEL_CLASS[level]}
                                title={`Likelihood ${likelihood}, consequence ${consequenceCategory}: ${level}`}
                              >
                                {occupants > 0 ? occupants : ''}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-slate-500 dark:text-slate-400">
                  {RISK_LEVELS.map((level) => (
                    <span key={level} className="inline-flex items-center gap-1.5">
                      <span className={`${LEVEL_CLASS[level]} rbi-swatch`} aria-hidden="true" />
                      {level} · {assessment.totals.byLevel[level]}
                    </span>
                  ))}
                </div>
              </Panel>

              <Panel padded={false}>
                <div className="border-b border-slate-200 px-5 py-3.5 dark:border-slate-700">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                    Inspection plan by unit
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                    Units are the sections the alignment named, so the ranking divides the line the way the
                    assessment behind it already did. Highest risk first.
                  </p>
                </div>
                <div className="max-h-[32rem] overflow-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-900/70">
                      <tr>
                        <th className="px-4 py-2">Unit</th>
                        <th className="px-2 py-2 text-right">L</th>
                        <th className="px-2 py-2 text-right">C</th>
                        <th className="px-2 py-2">Risk</th>
                        <th className="px-2 py-2 text-right">Interval</th>
                        <th className="px-2 py-2">Next inspection</th>
                        <th className="px-4 py-2">Driver</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {assessment.units.map((unit) => {
                        const erf = unit.likelihood.drivers.find((driver) => driver.id === 'erf');
                        const life = unit.likelihood.drivers.find((driver) => driver.id === 'remaining-life');
                        return (
                          <tr key={unit.id}>
                            <td className="px-4 py-2">
                              <span className="font-semibold text-slate-700 dark:text-slate-200">{unit.label}</span>
                              <span className="block text-[10px] text-slate-400">
                                {formatMetres(unit.fromM)} – {formatMetres(unit.toM)} ·{' '}
                                {unit.featureCount.toLocaleString()} assessed
                                {unit.likelihood.unassessedCount > 0
                                  && ` · ${unit.likelihood.unassessedCount.toLocaleString()} unassessed`}
                              </span>
                            </td>
                            <td className="px-2 py-2 text-right tabular-nums">{unit.likelihood.category}</td>
                            <td className="px-2 py-2 text-right tabular-nums">{unit.consequence.category}</td>
                            <td className="px-2 py-2">
                              <span className={`${LEVEL_CLASS[unit.riskLevel]} rbi-tag`}>{unit.riskLevel}</span>
                            </td>
                            <td className="px-2 py-2 text-right tabular-nums">
                              {unit.inspection.intervalYears === null
                                ? '—'
                                : `${unit.inspection.intervalYears} y`}
                            </td>
                            <td className="px-2 py-2">
                              <span className="tabular-nums">{unit.inspection.dueDateIso ?? '—'}</span>
                              <span className="block text-[10px] text-slate-400">
                                {unit.inspection.basis === 'half-remaining-life'
                                  ? 'Half remaining life'
                                  : unit.inspection.basis === 'risk-target-interval'
                                    ? 'Risk-based target'
                                    : unit.inspection.basis === 'immediate-action'
                                      ? 'Immediate action'
                                      : 'No basis'}
                              </span>
                            </td>
                            <td className="px-4 py-2 text-[11px] text-slate-500 dark:text-slate-400">
                              ERF {erf?.value ?? '—'} · life {life?.value ?? '—'} y
                              {unit.likelihood.growthAssumed && (
                                <span className="ml-1.5 rounded border border-amber-300 px-1 py-px text-[9px] font-bold uppercase tracking-wide text-amber-600 dark:border-amber-700 dark:text-amber-400">
                                  assumed growth
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Panel>

              <Panel>
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Recommendations</p>
                <ul className="mt-2 space-y-2.5">
                  {assessment.units.map((unit) => (
                    <li key={unit.id} className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
                      <span className="font-semibold text-slate-800 dark:text-slate-100">{unit.label}</span>
                      {' — '}{unit.inspection.recommendation}
                      {unit.governingFeature?.featureId && (
                        <span className="block text-[10px] text-slate-400">
                          Governed by {unit.governingFeature.featureId} at{' '}
                          {formatMetres(unit.governingFeature.ldM)}
                          {unit.governingFeature.erf !== null
                            && ` · ERF ${unit.governingFeature.erf.toFixed(3)}`}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </Panel>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
