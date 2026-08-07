import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  FiActivity,
  FiAlertTriangle,
  FiArrowLeft,
  FiBarChart2,
  FiCheckCircle,
  FiCompass,
  FiInfo,
  FiLayers,
  FiTrendingUp,
} from 'react-icons/fi';

import PageMeta from '../../components/common/PageMeta';
import { useToast } from '../../components/common/ToastProvider';
import { apiFetch } from '../../utils/api';
import {
  applyInterventions,
  includedInterventionRows,
  type InterventionEvent,
} from '../../utils/interventions';
import {
  Badge,
  Button,
  Callout,
  Field,
  Input,
  Panel,
  PanelBody,
  PanelHeader,
  Segmented,
  Stat,
  StatGrid,
} from '../../components/ds';
import ClockRose from '../../components/corrosion/ClockRose';
import DepthHistogram from '../../components/corrosion/DepthHistogram';
import DepthLengthEnvelope, { type PipeGeometry } from '../../components/corrosion/DepthLengthEnvelope';
import KpDensity from '../../components/corrosion/KpDensity';
import RemainingLife from '../../components/corrosion/RemainingLife';
import ReviewQueue from '../../components/corrosion/ReviewQueue';
import SectionGrowth from '../../components/corrosion/SectionGrowth';
import SegmentSeverity from '../../components/corrosion/SegmentSeverity';
import { SEVERITY_ORDER_VARS, SEVERITY_LABEL } from '../../components/corrosion/vizPrimitives';
import { fetchAlignmentResult, type ComparisonRow } from '../../utils/alignment';
import {
  analyseComparison,
  isMetalLoss,
  type CorrosionFeature,
} from '../../lib/corrosion/analysis';
import {
  corrosionVitals,
  hasSections,
  populationChange,
  surfaceSplit,
} from '../../lib/corrosion/analytics';
import {
  fetchFfsCandidates,
  saveFfsCandidates,
  type FfsCandidateReview,
} from '../../lib/corrosion/reviewClient';

const MatchingCharts = lazy(() => import('../../components/charts/AdvancedCharts'));

type TabId = 'overview' | 'distribution' | 'growth' | 'segments' | 'queue';

const TABS: Array<{ id: TabId; label: string; icon: ReactNode }> = [
  { id: 'overview', label: 'Overview', icon: <FiBarChart2 aria-hidden="true" /> },
  { id: 'distribution', label: 'Distribution', icon: <FiCompass aria-hidden="true" /> },
  { id: 'growth', label: 'Growth & life', icon: <FiTrendingUp aria-hidden="true" /> },
  { id: 'segments', label: 'Segments', icon: <FiLayers aria-hidden="true" /> },
  { id: 'queue', label: 'Review queue', icon: <FiActivity aria-hidden="true" /> },
];

function numberOrNull(value: string): number | null {
  const parsed = Number(value.trim().replace(',', '.'));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Corrosion Analysis — where the condition of the line is read, and the gate
 * into fitness-for-service.
 *
 * The page used to be a checkbox list: an engineer ticked features one at a
 * time with nothing on screen to base the decision on. Now the analysis comes
 * first — depth population, orientation, density, growth, section profile — and
 * the handoff to FFS is a single validation at the end.
 */
export default function CorrosionAnalysisPage() {
  const { sessionId = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('Loading the alignment result…');
  const [error, setError] = useState('');
  const [features, setFeatures] = useState<CorrosionFeature[]>([]);
  const [comparison, setComparison] = useState<ComparisonRow[]>([]);
  const [review, setReview] = useState<FfsCandidateReview | null>(null);
  const [tab, setTab] = useState<TabId>('overview');
  const [saving, setSaving] = useState(false);

  // Pipe geometry is not carried in the alignment result, so the acceptance
  // envelope stays off until the engineer supplies it rather than assuming a
  // diameter and drawing a curve that belongs to a different pipe.
  const [odMm, setOdMm] = useState('');
  const [smys, setSmys] = useState('359');
  const [maop, setMaop] = useState('');

  useEffect(() => {
    if (!sessionId) return;
    const controller = new AbortController();
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError('');
      try {
        const [result, saved, session] = await Promise.all([
          fetchAlignmentResult(sessionId, (pct, message) => {
            if (cancelled) return;
            setProgress(pct);
            setProgressMessage(message);
          }, controller.signal),
          fetchFfsCandidates(sessionId, controller.signal),
          apiFetch<{ config?: { interventions?: InterventionEvent[] } }>(
            `/api/wizard/session/${encodeURIComponent(sessionId)}`,
            { signal: controller.signal },
          ),
        ]);
        if (cancelled) return;
        const includedRows = includedInterventionRows(
          applyInterventions(result.comparison, session.config?.interventions || []),
        );
        setComparison(includedRows);
        setFeatures(analyseComparison(includedRows));
        setReview(saved);
      } catch (caught) {
        if (cancelled || (caught instanceof DOMException && caught.name === 'AbortError')) return;
        setError(caught instanceof Error ? caught.message : 'The alignment result could not be loaded.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [sessionId]);

  const metalLoss = useMemo(() => features.filter(isMetalLoss), [features]);
  const vitals = useMemo(() => corrosionVitals(features), [features]);
  const split = useMemo(() => surfaceSplit(metalLoss), [metalLoss]);
  const change = useMemo(() => populationChange(metalLoss), [metalLoss]);
  const sectioned = useMemo(() => hasSections(features), [features]);

  const geometry = useMemo<PipeGeometry | null>(() => {
    const od = numberOrNull(odMm);
    const smysMpa = numberOrNull(smys);
    const maopMpa = numberOrNull(maop);
    if (od === null || smysMpa === null || maopMpa === null) return null;
    return { outerDiameterMm: od, smysMpa, designFactor: 0.72, operatingPressureMpa: maopMpa };
  }, [maop, odMm, smys]);

  const releasedCount = review?.items.filter((item) => item.selected).length ?? 0;
  const validated = releasedCount > 0 && !review?.stale;

  /**
   * One action releases the whole metal-loss population. Features with
   * incomplete dimensions are included by decision — the count is shown next to
   * the button so the engineer knows what the B31G engine will reject.
   */
  const validateForFfs = useCallback(async () => {
    if (!review) return;
    setSaving(true);
    try {
      const items = metalLoss.map((feature) => ({
        sourceKey: feature.sourceKey,
        featureId: feature.featureId,
        selected: true,
        reason: feature.ffsReady ? null : feature.blockers.join('; '),
      }));
      const saved = await saveFfsCandidates(sessionId, { signature: review.signature, items });
      setReview(saved);
      toast.success(`${saved.selectedCount.toLocaleString()} feature(s) validated for FFS.`);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'The validation could not be saved.');
    } finally {
      setSaving(false);
    }
  }, [metalLoss, review, sessionId, toast]);

  if (!sessionId) {
    return (
      <div className="syn-page">
        <Callout tone="danger" title="No session">No alignment session was specified.</Callout>
      </div>
    );
  }

  return (
    <div className="syn-page">
      <PageMeta title="Corrosion Analysis" description="Analyse the corrosion condition of an aligned run pair" />

      <header className="syn-page__header">
        <div>
          <p className="syn-eyebrow">Final alignment phase</p>
          <h1 className="syn-page__title">Corrosion analysis</h1>
          <p className="syn-page__subtitle">
            Read the condition of the line from the aligned run pair, then validate the population
            for fitness-for-service.
          </p>
        </div>
        <div className="ds-btn-group">
          <Button variant="secondary" startIcon={<FiArrowLeft aria-hidden="true" />} onClick={() => navigate('/ili-comparison')}>
            Alignment results
          </Button>
        </div>
      </header>

      {loading && (
        <Panel>
          <PanelBody className="ds-stack ds-stack--sm">
            <p className="ds-panel__subtitle">{progressMessage}</p>
            <div className="ds-exec__track" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
              <i style={{ width: `${progress}%` }} />
            </div>
          </PanelBody>
        </Panel>
      )}

      {error && (
        <Callout tone="danger" role="alert" icon={<FiAlertTriangle aria-hidden="true" />} title="Could not load the result">
          {error}
        </Callout>
      )}

      {!loading && review && !review.reviewable && (
        <Callout tone="warning" icon={<FiAlertTriangle aria-hidden="true" />} title="This session cannot be released to FFS">
          {review.reason}
        </Callout>
      )}

      {!loading && review?.stale && (
        <Callout tone="warning" icon={<FiAlertTriangle aria-hidden="true" />} title="The alignment was re-run after the last validation">
          The previous validation no longer describes this result. Review the analysis again and
          re-validate to restore the FFS handoff.
        </Callout>
      )}

      {!loading && !error && (
        <div className="ds-stack ds-stack--lg">
          <Panel className="corrosion-review-brief">
            <PanelHeader
              plain
              eyebrow="Engineering review route"
              title="Screen severity, locate the concentration, then make the FFS handoff"
              subtitle="Overview is a screening sequence: establish the population, find the stretch that needs attention, then decide whether to release the run to fitness-for-service."
            />
            <PanelBody tight>
              <div className="corrosion-review-route" aria-label="Engineering review sequence">
                <div className="corrosion-review-route__step">
                  <span>01</span>
                  <div><strong>Screen</strong><small>Depth, ERF, and growth</small></div>
                </div>
                <div className="corrosion-review-route__step">
                  <span>02</span>
                  <div><strong>Locate</strong><small>Concentration along the line</small></div>
                </div>
                <div className="corrosion-review-route__step">
                  <span>03</span>
                  <div><strong>Release</strong><small>One controlled FFS handoff</small></div>
                </div>
              </div>
            </PanelBody>
          </Panel>

          {/* Vitals band — the four numbers that frame everything below */}
          <StatGrid>
            <Stat lead label="Metal loss" value={vitals.metalLoss.toLocaleString()} hint={`${vitals.assessable.toLocaleString()} with complete dimensions`} />
            <Stat label="Max depth" value={vitals.maxDepthPct === null ? '—' : `${vitals.maxDepthPct.toFixed(1)}%`} hint="Of wall thickness" tone={vitals.maxDepthPct !== null && vitals.maxDepthPct >= 60 ? 'danger' : 'neutral'} />
            <Stat label="Max ERF" value={vitals.maxErf === null ? '—' : vitals.maxErf.toFixed(3)} hint={vitals.maxErf !== null && vitals.maxErf >= 1 ? 'At or above 1' : 'Below 1'} tone={vitals.maxErf !== null && vitals.maxErf >= 1 ? 'danger' : 'success'} />
            <Stat label="Active growth" value={vitals.activeGrowth.toLocaleString()} hint="Measurably corroding" tone={vitals.activeGrowth > 0 ? 'warning' : 'neutral'} />
            <Stat label="Soonest limit" value={vitals.worstRemainingLife === null ? '—' : vitals.worstRemainingLife < 1 ? '< 1 yr' : `${vitals.worstRemainingLife.toFixed(1)} yr`} hint="To 80 %WT" tone={vitals.worstRemainingLife !== null && vitals.worstRemainingLife <= 5 ? 'danger' : 'neutral'} />
            <Stat label="New this run" value={change.newlyReported.toLocaleString()} hint="Not in the previous run" />
          </StatGrid>

          <Segmented<TabId>
            ariaLabel="Analysis view"
            value={tab}
            onChange={setTab}
            options={TABS.map((entry) => ({ value: entry.id, label: entry.label, icon: entry.icon }))}
          />

          {tab === 'overview' && (
            <div className="ds-stack">
              <div className="ds-grid-2">
                <Panel>
                  <PanelHeader plain eyebrow="01 | screening range" title="How severe is the wall loss?" subtitle="Read the depth population against the 80 %WT B31G screening boundary." />
                  <PanelBody><DepthHistogram features={metalLoss} /></PanelBody>
                </Panel>

                <Panel>
                  <PanelHeader plain eyebrow="01 | risk posture" title="Which population needs attention?" subtitle="Severity uses whichever of depth or ERF is more limiting." />
                  <PanelBody className="ds-stack ds-stack--sm">
                    <Callout
                      tone={vitals.severity.critical + vitals.severity.high > 0 ? 'warning' : 'success'}
                      title={vitals.severity.critical + vitals.severity.high > 0
                        ? `${(vitals.severity.critical + vitals.severity.high).toLocaleString()} feature(s) are high or critical`
                        : 'No feature is currently in a high or critical band'}
                    >
                      This is the population to prioritise before the FFS handoff.
                    </Callout>
                    <div className="seg-bars">
                      <div className="seg-bars__row">
                        <span className="seg-bars__label">All metal loss</span>
                        <div className="seg-bars__track">
                          {SEVERITY_ORDER_VARS.map(([severity, color]) => {
                            const count = vitals.severity[severity];
                            if (count === 0) return null;
                            return (
                              <span
                                key={severity}
                                className="seg-bars__seg"
                                style={{ width: `${(count / Math.max(1, vitals.metalLoss)) * 100}%`, background: color }}
                                title={`${SEVERITY_LABEL[severity]}: ${count.toLocaleString()}`}
                              />
                            );
                          })}
                        </div>
                        <span className="seg-bars__total">{vitals.metalLoss.toLocaleString()}</span>
                      </div>
                    </div>
                    <StatGrid>
                      {SEVERITY_ORDER_VARS.map(([severity]) => (
                        <Stat
                          key={severity}
                          compact
                          label={SEVERITY_LABEL[severity]}
                          value={vitals.severity[severity].toLocaleString()}
                          hint={`${((vitals.severity[severity] / Math.max(1, vitals.metalLoss)) * 100).toFixed(1)}%`}
                          tone={severity === 'critical' ? 'danger' : severity === 'high' ? 'warning' : 'neutral'}
                        />
                      ))}
                    </StatGrid>
                    <StatGrid>
                      <Stat compact label="Internal" value={split.internal.toLocaleString()} hint="Inside surface" />
                      <Stat compact label="External" value={split.external.toLocaleString()} hint="Outside surface" />
                      <Stat compact label="Surface unknown" value={split.unknown.toLocaleString()} hint="Not reported" />
                    </StatGrid>
                  </PanelBody>
                </Panel>
              </div>

              <Panel>
                <PanelHeader plain eyebrow="02 | location" title="Where should inspection focus first?" subtitle="The shaded window marks the densest contiguous stretch; use it to target the next engineering review." />
                <PanelBody><KpDensity features={metalLoss} /></PanelBody>
              </Panel>
            </div>
          )}

          {tab === 'distribution' && (
            <div className="ds-stack">
              <div className="ds-grid-2">
                <Panel>
                  <PanelHeader plain eyebrow="Mechanism" title="Orientation by clock position" subtitle="Which corrosion mechanism is running on this line." />
                  <PanelBody><ClockRose features={metalLoss} /></PanelBody>
                </Panel>

                <Panel>
                  <PanelHeader
                    plain
                    eyebrow="Acceptability"
                    title="Depth against length"
                    subtitle="Depth alone does not decide acceptability — length carries the rest."
                  />
                  <PanelBody className="ds-stack ds-stack--sm">
                    <div className="ds-row" style={{ flexWrap: 'nowrap', alignItems: 'flex-end', gap: '0.5rem' }}>
                      <Field label="OD [mm]">{({ id }) => <Input id={id} small data inputMode="decimal" placeholder="e.g. 273" value={odMm} onChange={(event) => setOdMm(event.target.value)} />}</Field>
                      <Field label="SMYS [MPa]">{({ id }) => <Input id={id} small data inputMode="decimal" value={smys} onChange={(event) => setSmys(event.target.value)} />}</Field>
                      <Field label="MAOP [MPa]">{({ id }) => <Input id={id} small data inputMode="decimal" placeholder="e.g. 8.3" value={maop} onChange={(event) => setMaop(event.target.value)} />}</Field>
                    </div>
                    <DepthLengthEnvelope features={metalLoss} geometry={geometry} />
                  </PanelBody>
                </Panel>
              </div>

              {/* The four matching charts that used to sit behind an "Analytics"
                  button on the comparison table live here, where the analysis is. */}
              <Panel>
                <PanelHeader
                  plain
                  eyebrow="Run pair"
                  title="Defect &amp; corrosion-rate matching"
                  subtitle="Matched and unmatched populations across both runs."
                />
                <PanelBody flush>
                  <Suspense fallback={<p className="viz-note" style={{ padding: '1rem' }}>Loading matching charts…</p>}>
                    <MatchingCharts data={comparison} variant="embedded" />
                  </Suspense>
                </PanelBody>
              </Panel>
            </div>
          )}

          {tab === 'growth' && (
            <div className="ds-stack">
              <StatGrid>
                <Stat lead label="Matched" value={change.matched.toLocaleString()} hint="Present in both runs" />
                <Stat label="Growing" value={change.growing.toLocaleString()} hint="Depth increased" tone={change.growing > 0 ? 'warning' : 'neutral'} />
                <Stat label="Dormant" value={change.dormant.toLocaleString()} hint="No measurable growth" tone="success" />
                <Stat label="New this run" value={change.newlyReported.toLocaleString()} hint="Not in the previous run" />
              </StatGrid>

              <Panel>
                <PanelHeader
                  plain
                  eyebrow="Projection"
                  title="Remaining life"
                  subtitle="Growing features ranked by how soon they reach the wall-loss limit."
                />
                <PanelBody><RemainingLife features={metalLoss} /></PanelBody>
              </Panel>

              {/* Growth per named stretch, not only per KP window — a section is
                  what a reassessment interval is actually written against. */}
              {sectioned && (
                <Panel>
                  <PanelHeader
                    plain
                    eyebrow="Segment rate"
                    title="Growth rate by section"
                    subtitle="The same growth population split across the sections defined during alignment, with each section's KP extent."
                  />
                  <PanelBody><SectionGrowth features={metalLoss} /></PanelBody>
                </Panel>
              )}

              <Callout tone="info" icon={<FiInfo aria-hidden="true" />} title="How to read these numbers">
                Growth here is the difference between two reported depths divided by the interval —
                it carries both runs&apos; tool tolerance. A negative rate does not mean the wall grew
                back; it means the two vendors sized the same defect differently. Treat the
                projection as a screening order, not a date.
              </Callout>
            </div>
          )}

          {tab === 'segments' && (
            sectioned ? (
              <div className="ds-stack">
                <Panel>
                  <PanelHeader plain eyebrow="Segment profile" title="Severity by section" subtitle="Feature count and severity mix across the sections defined during alignment." />
                  <PanelBody><SegmentSeverity features={metalLoss} /></PanelBody>
                </Panel>
                <Panel>
                  <PanelHeader
                    plain
                    eyebrow="Segment rate"
                    title="Corrosion growth rate by section"
                    subtitle="How fast each named stretch is actually corroding, with the KP extent it covers — the number a reassessment interval is set from."
                  />
                  <PanelBody><SectionGrowth features={metalLoss} /></PanelBody>
                </Panel>
                <Panel>
                  <PanelHeader plain eyebrow="Location" title="Density within the sectioned line" subtitle="Hotspots read against the same axis the sections were drawn on." />
                  <PanelBody><KpDensity features={metalLoss} windowM={250} /></PanelBody>
                </Panel>
              </div>
            ) : (
              <Panel>
                <PanelBody>
                  <Callout tone="info" icon={<FiLayers aria-hidden="true" />} title="No sections were defined for this alignment">
                    Segment analysis compares corrosion between named stretches of the line — river
                    crossings against buried pipe, aerial against transitions. It only becomes
                    meaningful once the sectioning stage has been filled in, so this view stays
                    empty rather than showing one undifferentiated bucket. Everything on the other
                    tabs works without sections.
                  </Callout>
                </PanelBody>
              </Panel>
            )
          )}

          {tab === 'queue' && (
            <Panel>
              <PanelHeader plain eyebrow="Engineering review" title="Ranked review queue" subtitle="Worst-first, with the reason each feature is where it is." />
              <PanelBody><ReviewQueue features={metalLoss} /></PanelBody>
            </Panel>
          )}

          {/* The FFS gate — one validation for the whole population */}
          <Panel>
            <PanelHeader
              eyebrow="03 | handoff decision"
              title="Release this reviewed population to fitness-for-service"
              subtitle="One decision for the run, taken after the analysis above — not per anomaly."
              icon={<FiCheckCircle aria-hidden="true" />}
              actions={validated ? <Badge tone="success">Validated</Badge> : <Badge tone="neutral">Not yet validated</Badge>}
            />
            <PanelBody className="ds-stack ds-stack--sm">
              <StatGrid>
                <Stat lead compact label="Population sent to FFS" value={vitals.metalLoss.toLocaleString()} hint="All metal loss on the NEW run" />
                <Stat compact label="B31G-ready" value={vitals.assessable.toLocaleString()} hint="Complete dimensions" tone="success" />
                <Stat compact label="Needs data repair" value={vitals.incomplete.toLocaleString()} hint="FFS will record the rejection reason" tone={vitals.incomplete > 0 ? 'warning' : 'neutral'} />
                <Stat compact label="Validated now" value={releasedCount.toLocaleString()} hint={review?.stale ? 'Stale — re-validate' : 'Saved'} />
              </StatGrid>

              {vitals.incomplete > 0 && (
                <Callout tone="warning" icon={<FiAlertTriangle aria-hidden="true" />} title={`${vitals.incomplete.toLocaleString()} feature(s) are missing dimensions B31G needs`}>
                  They are released with the rest, and the FFS engine will reject them with the
                  reason recorded here. Fix the source data if they matter.
                </Callout>
              )}

              <div className="ds-actionbar" style={{ marginTop: 0 }}>
                <span />
                <div className="ds-actionbar__end">
                  <Button
                    startIcon={<FiCheckCircle aria-hidden="true" />}
                    onClick={() => void validateForFfs()}
                    disabled={saving || !review?.reviewable || vitals.metalLoss === 0}
                  >
                    {saving ? 'Validating…' : `Validate ${vitals.metalLoss.toLocaleString()} features for FFS`}
                  </Button>
                  <Button
                    variant="secondary"
                    endIcon={<FiCheckCircle aria-hidden="true" />}
                    onClick={() => navigate(`/ffs?sessionId=${encodeURIComponent(sessionId)}`)}
                    disabled={!validated}
                    title={validated ? undefined : 'Validate the population first.'}
                  >
                    Open FFS
                  </Button>
                </div>
              </div>
            </PanelBody>
          </Panel>
        </div>
      )}
    </div>
  );
}
