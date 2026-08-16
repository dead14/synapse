/**
 * Risk-based inspection screening for a pipeline.
 *
 * Four steps, deliberately. Attach the filed fitness-for-service assessment,
 * review the eight pipeline threat categories, say who and what a release would
 * reach, and read the ranking. It answers one question — which sections carry
 * the most risk and when should each be inspected — and stops there. The full
 * assessment is an RBI engineer's work; this is the screening that tells them
 * where to start.
 *
 * The one thing the engineer is not asked for is the probability of metal loss.
 * That has already been measured, sized and assessed to B31G, and this page
 * re-reads the filed case on every render rather than storing a copy — so a
 * corrected assessment flows straight through to the ranking instead of leaving
 * a stale number in a database looking authoritative.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  FiAlertTriangle,
  FiChevronLeft,
  FiChevronRight,
  FiFilePlus,
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
} from '../../components/ds';
import { fetchFfsSession, listFfsSessions, type FfsSessionListItem } from '../../lib/ffs/sessions';
import { screenResults } from '../../lib/ffs/screening';
import type { RevivedFfsShareState } from '../../lib/ffs/shareState';
import { exportRbiWorkbook } from '../../lib/rbi/exports';
import { buildRbiAssessment } from '../../lib/rbi/fromFfs';
import { RBI_STEPS, emptyRbiRecord, outstandingFor, seedRecordFromFfs } from '../../lib/rbi/record';
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

import StepConsequence from './steps/StepConsequence';
import StepLine from './steps/StepLine';
import StepResult from './steps/StepResult';
import StepThreats from './steps/StepThreats';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export default function RbiPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const requestedSessionId = useMemo(
    () => new URLSearchParams(location.search).get('session'),
    [location.search],
  );

  const [sessions, setSessions] = useState<RbiSessionListItem[]>([]);
  const [ffsSessions, setFfsSessions] = useState<FfsSessionListItem[]>([]);
  const [loadingRegistry, setLoadingRegistry] = useState(true);

  const [sessionId, setSessionId] = useState<string | null>(requestedSessionId);
  const [record, setRecord] = useState<RbiRecord | null>(null);
  const [status, setStatus] = useState<'draft' | 'issued'>('draft');
  const [step, setStep] = useState<RbiStepId>('line');
  const [ffsState, setFfsState] = useState<RevivedFfsShareState | null>(null);
  const [ffsLoading, setFfsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');

  /**
   * Guards the seeding effect. Seeding rewrites the record, and running it on
   * every render of an attached case would fight the engineer's own edits to the
   * fields it fills.
   */
  const seededFor = useRef<string | null>(null);

  const refreshRegistry = useCallback(async () => {
    setLoadingRegistry(true);
    try {
      const [rbi, ffs] = await Promise.all([listRbiSessions(50), listFfsSessions(100)]);
      setSessions(rbi);
      setFfsSessions(ffs);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The register could not be loaded.');
    } finally {
      setLoadingRegistry(false);
    }
  }, []);

  useEffect(() => { void refreshRegistry(); }, [refreshRegistry]);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    setError(null);
    fetchRbiSession(sessionId)
      .then(({ session, record: stored }) => {
        if (cancelled) return;
        setRecord(stored);
        setStatus(session.status);
        setStep(session.currentStep ?? 'line');
        seededFor.current = null;
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : 'That assessment could not be opened.');
      });
    return () => { cancelled = true; };
  }, [sessionId]);

  const ffsSessionId = record?.ffsSessionId ?? null;

  useEffect(() => {
    if (!ffsSessionId) {
      setFfsState(null);
      return;
    }
    let cancelled = false;
    setFfsLoading(true);
    fetchFfsSession(ffsSessionId)
      .then((loaded) => {
        if (cancelled) return;
        setFfsState(loaded?.state ?? null);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setFfsState(null);
        setError(caught instanceof Error ? caught.message : 'The attached assessment could not be read.');
      })
      .finally(() => { if (!cancelled) setFfsLoading(false); });
    return () => { cancelled = true; };
  }, [ffsSessionId]);

  /**
   * The same screening the results workspace applies, from the same stored case.
   * Re-deriving it rather than storing a second copy is what keeps the ranking
   * and the assessment it cites from drifting apart.
   */
  const screened = useMemo(
    () => (ffsState ? screenResults(ffsState.results, ffsState.config, ffsState.screening) : []),
    [ffsState],
  );

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

  const geometry = useMemo(() => {
    const first = screened[0]?.nominal;
    if (!first) return null;
    return {
      outerDiameterMm: Number(first.od) || 0,
      operatingPressureMpa: Number(first.p0) || 0,
    };
  }, [screened]);

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
      summary: summarize(assessment),
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
  }, [assessment, navigate, refreshRegistry, sessionId]);

  const update = useCallback((mutate: (current: RbiRecord) => RbiRecord) => {
    setRecord((current) => (current ? mutate(current) : current));
    setSaveState('idle');
  }, []);

  const startNew = useCallback(() => {
    setSessionId(null);
    setRecord(emptyRbiRecord());
    setStatus('draft');
    setStep('line');
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

  const stepIndex = RBI_STEPS.findIndex((item) => item.id === step);
  const goTo = useCallback((next: RbiStepId) => {
    setStep(next);
    if (record) void save(record, status, next);
  }, [record, save, status]);

  const attachFfs = useCallback((id: string) => {
    seededFor.current = null;
    update((current) => ({ ...current, ffsSessionId: id || null }));
  }, [update]);

  if (!record) {
    return (
      <div className="syn-page syn-ui-kit">
        <PageMeta title="Risk-based inspection · Synapse" description="Pipeline RBI screening" />
        <Header saveState="idle" />
        {error && <Callout tone="danger" icon={<FiAlertTriangle />} title="Something went wrong">{error}</Callout>}
        <div style={{ marginTop: '1rem' }}>
          <Registry
            sessions={sessions}
            loading={loadingRegistry}
            activeId={null}
            onOpen={openSession}
            onNew={startNew}
            onDelete={removeSession}
          />
        </div>
      </div>
    );
  }

  const stepProps = { record, update, assessment };

  return (
    <div className="syn-page syn-ui-kit">
      <PageMeta title="Risk-based inspection · Synapse" description="Pipeline RBI screening" />
      <Header saveState={saveState} />

      {error && (
        <Callout tone="danger" icon={<FiAlertTriangle />} title="Something went wrong">{error}</Callout>
      )}

      <div className="rbi-shell" style={{ marginTop: '1rem' }}>
        <div className="rbi-shell__rail">
          <Panel>
            <PanelHeader
              title={record.title.trim() || 'Untitled screening'}
              subtitle={status === 'issued' ? 'Issued' : 'Draft'}
            />
            <PanelBody>
              <nav className="rbi-stepper" aria-label="Assessment steps">
                {RBI_STEPS.map((item, index) => {
                  const outstanding = outstandingFor(record, item.id);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`rbi-step${item.id === step ? ' is-active' : ''}${outstanding === 0 ? ' is-complete' : ''}`}
                      aria-current={item.id === step ? 'step' : undefined}
                      onClick={() => goTo(item.id)}
                    >
                      <span className="rbi-step__index">{index + 1}</span>
                      <span>
                        <span className="rbi-step__label">{item.label}</span>
                      </span>
                      {outstanding > 0 && (
                        <span
                          className="rbi-step__gap rbi-step__gap--blocking"
                          title={`${outstanding} outstanding`}
                        >
                          {outstanding}
                        </span>
                      )}
                    </button>
                  );
                })}
              </nav>

              {assessment && (
                <p className="rbi-check__hint" style={{ marginTop: '0.75rem' }}>
                  {assessment.lineName} · {assessment.sections.length} sections ·{' '}
                  {assessment.totals.features.toLocaleString()} features · inspected{' '}
                  {assessment.assessmentDateIso}
                </p>
              )}
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
          <div>
            <p className="ds-eyebrow">Step {stepIndex + 1} of {RBI_STEPS.length}</p>
            <h2 className="syn-page__title" style={{ fontSize: 'var(--ds-t-lg)' }}>
              {RBI_STEPS[stepIndex].label}
            </h2>
            <p className="rbi-check__hint">{RBI_STEPS[stepIndex].blurb}</p>
          </div>

          {step === 'line' && (
            <StepLine
              {...stepProps}
              ffsSessions={ffsSessions}
              ffsLoading={ffsLoading}
              evidenceUnreadable={!ffsLoading && record.ffsSessionId !== null && ffsState === null}
              onAttach={attachFfs}
              geometry={geometry}
            />
          )}
          {step === 'threats' && <StepThreats {...stepProps} />}
          {step === 'consequence' && <StepConsequence {...stepProps} />}
          {step === 'result' && (
            <StepResult
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
              <Button
                variant="ghost"
                size="sm"
                startIcon={<FiSave />}
                onClick={() => void save(record, status, step)}
              >
                {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : 'Save'}
              </Button>
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
        <p className="syn-eyebrow">Assessment</p>
        <h1 className="syn-page__title">Risk-based inspection</h1>
        <p className="syn-page__subtitle">
          A pipeline screening in four steps. Probability from the metal loss a filed assessment already
          measured and from the threats it cannot see; consequence from what the line carries and where it
          runs. It says which sections to inspect first and when — not what a full RBI assessment would.
        </p>
      </div>
      {saveState === 'error' && <Badge tone="danger" pill>Not saved</Badge>}
      {saveState === 'saved' && <Badge tone="success" pill>Saved</Badge>}
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
}: {
  sessions: RbiSessionListItem[];
  loading: boolean;
  activeId: string | null;
  onOpen: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <Panel>
      <PanelHeader
        title="Saved screenings"
        actions={(
          <Button variant="primary" size="sm" startIcon={<FiFilePlus />} onClick={onNew}>
            New
          </Button>
        )}
      />
      <PanelBody>
        {loading && <p className="rbi-check__hint">Loading…</p>}

        {!loading && sessions.length === 0 && (
          <p className="rbi-empty">Nothing saved yet. Start one and it will be here.</p>
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
                  {typeof session.summary.sections === 'number' && ` · ${session.summary.sections} sections`}
                  {typeof session.summary.unacceptable === 'number' && session.summary.unacceptable > 0
                    && ` · ${session.summary.unacceptable} unacceptable`}
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
