/**
 * Risk-based inspection, API RP 580 4th edition.
 *
 * This is a document, not a calculator. §16.2 asks for an RBI assessment to be
 * captured completely enough that "the assessment can be recreated or updated at
 * a later time by others who were not involved in the original assessment", and
 * recommends holding it in a database — so the page is a ten-step authoring
 * workspace over a stored session, following the practice's own sequence: plan
 * the programme, name the team, collect and validate the data, review the damage
 * mechanisms, assess probability and consequence, determine risk against stated
 * criteria, plan inspection and mitigation, set the reassessment triggers, and
 * sign it off.
 *
 * The one thing the engineer is not asked for is the probability of metal loss.
 * That has already been measured: the line was inspected, the loss was sized,
 * and a B31G assessment of it was run and filed. The wizard reads that filed
 * case and re-derives the risk from it on every render, so a corrected
 * fitness-for-service assessment flows straight through to the ranking instead
 * of leaving a stale number in a database looking authoritative.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  FiAlertTriangle,
  FiChevronLeft,
  FiChevronRight,
  FiDownload,
  FiFilePlus,
  FiRefreshCw,
  FiSave,
  FiTrash2,
} from 'react-icons/fi';

import PageMeta from '../../components/common/PageMeta';
import {
  ActionBar,
  Badge,
  Button,
  Callout,
  Panel,
  PanelBody,
  PanelHeader,
  Select,
} from '../../components/ds';
import { fetchFfsSession, listFfsSessions, type FfsSessionListItem } from '../../lib/ffs/sessions';
import { screenResults } from '../../lib/ffs/screening';
import type { RevivedFfsShareState } from '../../lib/ffs/shareState';
import { evaluateChecklist, unmetForStep } from '../../lib/rbi/checklist';
import { exportRbiWorkbook } from '../../lib/rbi/exports';
import { buildRbiAssessment } from '../../lib/rbi/fromFfs';
import {
  RBI_STEPS,
  emptyRbiRecord,
  seedRecordFromFfs,
} from '../../lib/rbi/record';
import {
  createRbiSession,
  deleteRbiSession,
  fetchRbiSession,
  listRbiSessions,
  summarize,
  updateRbiSession,
  type RbiSessionListItem,
} from '../../lib/rbi/sessions';
import type { RbiAssessment, RbiRecord, RbiStepId } from '../../lib/rbi/types';

import StepCof from './steps/StepCof';
import StepData from './steps/StepData';
import StepDmr from './steps/StepDmr';
import StepDocumentation from './steps/StepDocumentation';
import StepEvergreen from './steps/StepEvergreen';
import StepPlan from './steps/StepPlan';
import StepPlanning from './steps/StepPlanning';
import StepPof from './steps/StepPof';
import StepRisk from './steps/StepRisk';
import StepTeam from './steps/StepTeam';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export default function RbiPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const requestedSessionId = useMemo(
    () => new URLSearchParams(location.search).get('session'),
    [location.search],
  );

  /* Registry -------------------------------------------------------------- */
  const [sessions, setSessions] = useState<RbiSessionListItem[]>([]);
  const [ffsSessions, setFfsSessions] = useState<FfsSessionListItem[]>([]);
  const [loadingRegistry, setLoadingRegistry] = useState(true);

  /* The open assessment --------------------------------------------------- */
  const [sessionId, setSessionId] = useState<string | null>(requestedSessionId);
  const [record, setRecord] = useState<RbiRecord | null>(null);
  const [status, setStatus] = useState<'draft' | 'issued'>('draft');
  const [step, setStep] = useState<RbiStepId>('planning');
  const [ffsState, setFfsState] = useState<RevivedFfsShareState | null>(null);
  const [loadingCase, setLoadingCase] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');

  /**
   * Guards the seeding effect. Seeding is idempotent but not free — it rewrites
   * the record — and running it on every render of an attached case would fight
   * the engineer's own edits to the fields it fills.
   */
  const seededFor = useRef<string | null>(null);

  const refreshRegistry = useCallback(async () => {
    setLoadingRegistry(true);
    try {
      const [rbi, ffs] = await Promise.all([listRbiSessions(50), listFfsSessions(100)]);
      setSessions(rbi);
      setFfsSessions(ffs);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The assessment register could not be loaded.');
    } finally {
      setLoadingRegistry(false);
    }
  }, []);

  useEffect(() => { void refreshRegistry(); }, [refreshRegistry]);

  /* Open a stored assessment ---------------------------------------------- */
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    setError(null);
    fetchRbiSession(sessionId)
      .then(({ session, record: stored }) => {
        if (cancelled) return;
        setRecord(stored);
        setStatus(session.status);
        setStep(session.currentStep ?? 'planning');
        seededFor.current = null;
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : 'That assessment could not be opened.');
      });
    return () => { cancelled = true; };
  }, [sessionId]);

  /* Read the cited FFS case ------------------------------------------------ */
  const ffsSessionId = record?.ffsSessionId ?? null;

  useEffect(() => {
    if (!ffsSessionId) {
      setFfsState(null);
      return;
    }
    let cancelled = false;
    setLoadingCase(true);
    fetchFfsSession(ffsSessionId)
      .then((loaded) => {
        if (cancelled) return;
        if (!loaded) {
          setFfsState(null);
          setError('That FFS assessment carries no readable result, so no risk can be derived from it.');
          return;
        }
        setFfsState(loaded.state);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setFfsState(null);
        setError(caught instanceof Error ? caught.message : 'The cited FFS assessment could not be read.');
      })
      .finally(() => { if (!cancelled) setLoadingCase(false); });
    return () => { cancelled = true; };
  }, [ffsSessionId]);

  /**
   * The same screening the FFS workspace applies, from the same stored case.
   *
   * Re-deriving it here rather than storing a second copy is what keeps the risk
   * ranking and the assessment it cites from drifting apart.
   */
  const screened = useMemo(
    () => (ffsState ? screenResults(ffsState.results, ffsState.config, ffsState.screening) : []),
    [ffsState],
  );

  // Fill in what the filed case already knows, once per attachment.
  useEffect(() => {
    if (!record || !ffsState || !ffsSessionId) return;
    if (seededFor.current === ffsSessionId) return;
    seededFor.current = ffsSessionId;
    setRecord((current) => (current
      ? seedRecordFromFfs(current, { ffsSessionId, state: ffsState, screened })
      : current));
  }, [record, ffsState, ffsSessionId, screened]);

  const assessment: RbiAssessment | null = useMemo(() => {
    if (!record || !ffsState || screened.length === 0) return null;
    return buildRbiAssessment({ record, state: ffsState, screened });
  }, [record, ffsState, screened]);

  const checklist = useMemo(
    () => evaluateChecklist(record ?? emptyRbiRecord()),
    [record],
  );

  /* Persistence ------------------------------------------------------------ */
  const save = useCallback(async (
    next: RbiRecord,
    nextStatus: 'draft' | 'issued',
    nextStep: RbiStepId,
  ) => {
    setSaveState('saving');
    const payload = {
      record: next,
      status: nextStatus,
      currentStep: nextStep,
      summary: summarize(assessment, checklist),
    };
    try {
      if (sessionId) {
        await updateRbiSession(sessionId, payload);
      } else {
        const created = await createRbiSession(payload);
        setSessionId(created);
        navigate(`/rbi?session=${encodeURIComponent(created)}`, { replace: true });
      }
      setSaveState('saved');
      void refreshRegistry();
    } catch (caught) {
      setSaveState('error');
      setError(caught instanceof Error ? caught.message : 'The assessment could not be saved.');
    }
  }, [assessment, checklist, navigate, refreshRegistry, sessionId]);

  const update = useCallback((mutate: (current: RbiRecord) => RbiRecord) => {
    setRecord((current) => (current ? mutate(current) : current));
    setSaveState('idle');
  }, []);

  const startNew = useCallback(() => {
    setSessionId(null);
    setRecord(emptyRbiRecord());
    setStatus('draft');
    setStep('planning');
    setFfsState(null);
    seededFor.current = null;
    setError(null);
    setSaveState('idle');
    navigate('/rbi', { replace: true });
  }, [navigate]);

  const openSession = useCallback((id: string) => {
    setSessionId(id);
    setSaveState('idle');
    navigate(`/rbi?session=${encodeURIComponent(id)}`, { replace: true });
  }, [navigate]);

  const removeSession = useCallback(async (id: string) => {
    try {
      await deleteRbiSession(id);
      if (id === sessionId) startNew();
      void refreshRegistry();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That assessment could not be deleted.');
    }
  }, [refreshRegistry, sessionId, startNew]);

  /* Navigation ------------------------------------------------------------- */
  const stepIndex = RBI_STEPS.findIndex((item) => item.id === step);
  const goTo = useCallback((next: RbiStepId) => {
    setStep(next);
    if (record) void save(record, status, next);
  }, [record, save, status]);

  const attachFfs = useCallback((id: string) => {
    seededFor.current = null;
    update((current) => ({ ...current, ffsSessionId: id || null }));
  }, [update]);

  /* Render ----------------------------------------------------------------- */
  if (!record) {
    return (
      <div className="syn-page syn-ui-kit">
        <PageMeta
          title="Risk-based inspection · Synapse"
          description="API 580 risk assessment, from planning through to sign-off"
        />
        <Header saveState="idle" />
        {error && <Callout tone="danger" icon={<FiAlertTriangle />} title="Something went wrong">{error}</Callout>}
        <Registry
          sessions={sessions}
          loading={loadingRegistry}
          activeId={null}
          onOpen={openSession}
          onNew={startNew}
          onDelete={removeSession}
          expanded
        />
      </div>
    );
  }

  const stepProps = { record, update, assessment, checklist };

  return (
    <div className="syn-page syn-ui-kit">
      <PageMeta
        title="Risk-based inspection · Synapse"
        description="API 580 risk assessment, from planning through to sign-off"
      />
      <Header saveState={saveState} />

      {error && (
        <Callout tone="danger" icon={<FiAlertTriangle />} title="Something went wrong">{error}</Callout>
      )}

      <div className="rbi-shell" style={{ marginTop: '1rem' }}>
        <div className="rbi-shell__rail">
          <Panel>
            <PanelHeader
              eyebrow="Assessment"
              title={record.title.trim() || 'Untitled assessment'}
              subtitle={status === 'issued' ? 'Issued' : 'Draft'}
            />
            <PanelBody>
              <label className="ds-field">
                <span className="ds-field__label">Evidence — filed FFS assessment</span>
                <Select
                  value={record.ffsSessionId ?? ''}
                  onChange={(event) => attachFfs(event.target.value)}
                >
                  <option value="">Not attached</option>
                  {ffsSessions.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label} · {item.featureCount.toLocaleString()} features
                    </option>
                  ))}
                </Select>
                <span className="ds-field__hint">
                  The measured half of the probability. §16.2 e asks the assessment to cite the inputs it
                  rests on, and this is the one that cannot be typed.
                </span>
              </label>

              {loadingCase && (
                <p className="rbi-check__hint">
                  <FiRefreshCw className="animate-spin" aria-hidden="true" /> Reading the filed assessment…
                </p>
              )}

              {!loadingCase && record.ffsSessionId && !ffsState && (
                <Callout tone="warning" title="Evidence unavailable">
                  The cited FFS assessment could not be read. The document is still editable, but nothing can
                  be ranked until it is restored or another one is attached.
                </Callout>
              )}

              {ffsSessions.length === 0 && !loadingRegistry && (
                <Callout tone="warning" title="No FFS assessment has been filed">
                  Run one from the{' '}
                  <Link to="/alignment-history">ILI alignment registry</Link>{' '}
                  first. API 580 needs measured damage to rank, and this product will not invent it.
                </Callout>
              )}

              {assessment && (
                <p className="rbi-check__hint" style={{ marginTop: '0.5rem' }}>
                  {assessment.lineName} · {assessment.totals.features.toLocaleString()} assessed features ·
                  inspection dated {assessment.assessmentDateIso}
                  {assessment.totals.unassessed > 0
                    && ` · ${assessment.totals.unassessed.toLocaleString()} anomalies carried no B31G result`}
                </p>
              )}

              <nav className="rbi-stepper" aria-label="API 580 assessment steps" style={{ marginTop: '0.75rem' }}>
                {RBI_STEPS.map((item, index) => {
                  const unmet = unmetForStep(checklist, item.id);
                  const blocking = unmet.some((entry) => entry.level === 'shall');
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`rbi-step${item.id === step ? ' is-active' : ''}${unmet.length === 0 ? ' is-complete' : ''}`}
                      aria-current={item.id === step ? 'step' : undefined}
                      onClick={() => goTo(item.id)}
                    >
                      <span className="rbi-step__index">{index + 1}</span>
                      <span>
                        <span className="rbi-step__label">{item.label}</span>
                        <span className="rbi-step__section">{item.section}</span>
                      </span>
                      {unmet.length > 0 && (
                        <span
                          className={`rbi-step__gap${blocking ? ' rbi-step__gap--blocking' : ''}`}
                          title={`${unmet.length} outstanding item(s)`}
                        >
                          {unmet.length}
                        </span>
                      )}
                    </button>
                  );
                })}
              </nav>
            </PanelBody>
          </Panel>

          <Registry
            sessions={sessions}
            loading={loadingRegistry}
            activeId={sessionId}
            onOpen={openSession}
            onNew={startNew}
            onDelete={removeSession}
          />
        </div>

        <div className="rbi-shell__main">
          <StepHeading stepIndex={stepIndex} />

          {step === 'planning' && <StepPlanning {...stepProps} />}
          {step === 'team' && <StepTeam {...stepProps} />}
          {step === 'data' && <StepData {...stepProps} />}
          {step === 'dmr' && <StepDmr {...stepProps} />}
          {step === 'pof' && <StepPof {...stepProps} />}
          {step === 'cof' && <StepCof {...stepProps} />}
          {step === 'risk' && <StepRisk {...stepProps} />}
          {step === 'plan' && <StepPlan {...stepProps} />}
          {step === 'evergreen' && <StepEvergreen {...stepProps} />}
          {step === 'documentation' && (
            <StepDocumentation
              {...stepProps}
              status={status}
              onGoToStep={goTo}
              onExport={() => { if (assessment) exportRbiWorkbook(assessment); }}
              onIssue={() => { setStatus('issued'); void save(record, 'issued', step); }}
              onWithdraw={() => { setStatus('draft'); void save(record, 'draft', step); }}
            />
          )}

          <ActionBar
            back={stepIndex > 0 && (
              <Button
                variant="secondary"
                startIcon={<FiChevronLeft />}
                onClick={() => goTo(RBI_STEPS[stepIndex - 1].id)}
              >
                {RBI_STEPS[stepIndex - 1].label}
              </Button>
            )}
            center={(
              <div className="ds-row">
                <Button
                  variant="ghost"
                  size="sm"
                  startIcon={<FiSave />}
                  onClick={() => void save(record, status, step)}
                >
                  {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : 'Save'}
                </Button>
                {assessment && (
                  <Button
                    variant="ghost"
                    size="sm"
                    startIcon={<FiDownload />}
                    onClick={() => exportRbiWorkbook(assessment)}
                  >
                    Export
                  </Button>
                )}
              </div>
            )}
            next={stepIndex < RBI_STEPS.length - 1 && (
              <Button
                variant="primary"
                endIcon={<FiChevronRight />}
                onClick={() => goTo(RBI_STEPS[stepIndex + 1].id)}
              >
                {RBI_STEPS[stepIndex + 1].label}
              </Button>
            )}
            help={checklist.blockers.length > 0
              ? `${checklist.blockers.length} Appendix A shall-item(s) still outstanding across the document.`
              : 'Every Appendix A shall-item is satisfied.'}
          />
        </div>
      </div>
    </div>
  );
}

function Header({ saveState }: { saveState: SaveState }) {
  return (
    <div className="syn-page__header">
      <div className="min-w-0">
        <p className="syn-eyebrow">Assessment · API RP 580 (4th edition, 2021)</p>
        <h1 className="syn-page__title">Risk-based inspection</h1>
        <p className="syn-page__subtitle">
          A controlled document, authored through the practice's own sequence. Probability from the metal loss
          a filed FFS assessment already measured and from the damage mechanisms it cannot see; consequence
          from what the line carries and where it runs.
        </p>
      </div>
      {saveState === 'error' && <Badge tone="danger" pill>Not saved</Badge>}
      {saveState === 'saved' && <Badge tone="success" pill>Saved</Badge>}
    </div>
  );
}

function StepHeading({ stepIndex }: { stepIndex: number }) {
  const item = RBI_STEPS[Math.max(0, stepIndex)];
  return (
    <div>
      <p className="ds-eyebrow">
        Step {Math.max(0, stepIndex) + 1} of {RBI_STEPS.length} · API 580 {item.section}
      </p>
      <h2 className="syn-page__title" style={{ fontSize: 'var(--ds-t-lg)' }}>{item.label}</h2>
      <p className="rbi-check__hint">{item.blurb}</p>
    </div>
  );
}

function Registry({
  sessions,
  loading,
  activeId,
  onOpen,
  onNew,
  onDelete,
  expanded,
}: {
  sessions: RbiSessionListItem[];
  loading: boolean;
  activeId: string | null;
  onOpen: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  expanded?: boolean;
}) {
  return (
    <Panel style={expanded ? { marginTop: '1rem' } : undefined}>
      <PanelHeader
        eyebrow="§16.2"
        title="Assessment register"
        subtitle="Every RBI assessment this organization holds, newest worked-on first."
        actions={(
          <Button variant="primary" size="sm" startIcon={<FiFilePlus />} onClick={onNew}>
            New assessment
          </Button>
        )}
      />
      <PanelBody>
        {loading && <p className="rbi-check__hint">Loading the register…</p>}

        {!loading && sessions.length === 0 && (
          <p className="rbi-empty">
            No assessments yet. §16.2 asks for the record to be held somewhere it can be retrieved and
            stewarded — start one and it will be here.
          </p>
        )}

        <div className="rbi-registry">
          {sessions.map((session) => (
            <div key={session.id} className={`rbi-registry__row${session.id === activeId ? ' is-active' : ''}`}>
              <button
                type="button"
                onClick={() => onOpen(session.id)}
                style={{ all: 'unset', cursor: 'pointer', minWidth: 0 }}
              >
                <span className="rbi-registry__title">{session.label}</span>
                <span className="rbi-registry__meta">
                  {session.status === 'issued' ? 'Issued' : 'Draft'}
                  {session.ffsLabel ? ` · ${session.ffsLabel}` : ' · no evidence attached'}
                  {typeof session.summary.units === 'number' && ` · ${session.summary.units} sections`}
                  {typeof session.summary.unacceptable === 'number' && session.summary.unacceptable > 0
                    && ` · ${session.summary.unacceptable} unacceptable`}
                  {typeof session.summary.shallMet === 'number'
                    && ` · ${session.summary.shallMet}/${session.summary.shallTotal} shall-items`}
                </span>
              </button>
              <Button
                variant="ghost"
                size="xs"
                iconOnly
                aria-label={`Delete ${session.label}`}
                onClick={() => onDelete(session.id)}
              >
                <FiTrash2 />
              </Button>
            </div>
          ))}
        </div>
      </PanelBody>
    </Panel>
  );
}
