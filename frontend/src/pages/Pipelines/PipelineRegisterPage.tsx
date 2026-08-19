/**
 * The pipeline register.
 *
 * Every line the organization has imported a run for, with the design data
 * filed against it. The intake writes this record and FFS reads it; this page
 * is where it can be read and corrected without starting a new alignment, and
 * where a line built from more than one size gets its stretches entered.
 */

import { useEffect, useMemo, useState } from 'react';
import { FiDatabase, FiRefreshCw, FiSave } from 'react-icons/fi';
import PageMeta from '../../components/common/PageMeta';
import { Button, Callout } from '../../components/ds';
import PipelineSpecFields from '../../components/pipeline/PipelineSpecFields';
import {
  EMPTY_PIPELINE_SPEC_FORM,
  formToSpecification,
  pipelineSpecFormProblems,
  specificationToForm,
  type PipelineSpecForm,
} from '../../domain/pipelineSpecForm';
import type { PipelineRegisterEntry } from '../../domain/pipelineSpecification';
import {
  fetchPipelineDossier,
  fetchPipelineRegister,
  savePipelineDossier,
} from '../../lib/pipelines/pipelineClient';
import { millimetresToInches } from '../../lib/ffs/units';

/** A diameter as an engineer says it: nominal inches, with the millimetres. */
function describeDiameter(millimetres: number): string {
  const inches = millimetresToInches(millimetres);
  return `${Number(inches.toFixed(1))} in (${Number(millimetres.toFixed(1))} mm)`;
}

function describeSizes(entry: PipelineRegisterEntry): string {
  const diameters = new Set<number>();
  if (entry.outerDiameterMm !== null) diameters.add(entry.outerDiameterMm);
  for (const diameter of entry.segmentDiameters) diameters.add(diameter);
  if (diameters.size === 0) return 'Not recorded';
  return [...diameters].sort((left, right) => left - right).map(describeDiameter).join(' → ');
}

export default function PipelineRegisterPage() {
  const [entries, setEntries] = useState<PipelineRegisterEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [form, setForm] = useState<PipelineSpecForm>(EMPTY_PIPELINE_SPEC_FORM);
  const [dossierLoading, setDossierLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const problems = useMemo(() => pipelineSpecFormProblems(form), [form]);
  const selected = entries.find((entry) => entry.pipelineId === selectedId) || null;

  const loadRegister = async () => {
    setLoading(true);
    setError('');
    try {
      const items = await fetchPipelineRegister();
      setEntries(items);
      setSelectedId((current) => (
        current !== null && items.some((item) => item.pipelineId === current)
          ? current
          : items[0]?.pipelineId ?? null
      ));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The pipeline register could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadRegister(); }, []);

  useEffect(() => {
    if (selectedId === null) return;
    let active = true;
    setDossierLoading(true);
    setMessage('');
    fetchPipelineDossier(selectedId)
      .then((dossier) => {
        if (!active) return;
        setForm(dossier?.specification
          ? specificationToForm(dossier.specification)
          : EMPTY_PIPELINE_SPEC_FORM);
      })
      .catch(() => { if (active) setForm(EMPTY_PIPELINE_SPEC_FORM); })
      .finally(() => { if (active) setDossierLoading(false); });
    return () => { active = false; };
  }, [selectedId]);

  const save = async () => {
    if (selectedId === null || problems.length > 0) return;
    setSaving(true);
    setError('');
    try {
      await savePipelineDossier(selectedId, formToSpecification(form));
      setMessage('Pipeline data saved. Assessments started from now on read these values.');
      await loadRegister();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The pipeline data could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="syn-page syn-ui-kit">
      <PageMeta title="Pipeline register" description="Line design data filed once and read by every assessment" />

      <div className="syn-page__header">
        <div>
          <p className="syn-eyebrow">Data &amp; alignment</p>
          <h1 className="syn-page__title">Pipeline register</h1>
          <p className="syn-page__subtitle">
            The design data behind every line: diameter, wall, grade, pressures, and the stretches a
            multi-size line is built from. Filed at intake, read by FFS and RBI, corrected here.
          </p>
        </div>
        <Button
          variant="secondary"
          onClick={() => void loadRegister()}
          startIcon={<FiRefreshCw className={loading ? 'animate-spin' : ''} aria-hidden="true" />}
        >
          Reload
        </Button>
      </div>

      {error && <Callout tone="danger">{error}</Callout>}
      {message && <Callout tone="success">{message}</Callout>}

      <div className="pipeline-register">
        <aside className="pipeline-register__list">
          <div className="pipeline-register__list-head">
            <FiDatabase aria-hidden="true" />
            <span>{entries.length.toLocaleString()} line{entries.length === 1 ? '' : 's'}</span>
          </div>
          {loading && <p className="pipeline-register__empty">Loading the register…</p>}
          {!loading && entries.length === 0 && (
            <p className="pipeline-register__empty">
              No pipeline yet. A line appears here once an inspection run is imported for it.
            </p>
          )}
          {entries.map((entry) => (
            <button
              key={entry.pipelineId}
              type="button"
              className={`pipeline-register__item${entry.pipelineId === selectedId ? ' is-active' : ''}`}
              onClick={() => setSelectedId(entry.pipelineId)}
            >
              <strong>{entry.pipelineName}</strong>
              <span>
                {entry.runCount.toLocaleString()} run{entry.runCount === 1 ? '' : 's'}
                {' · '}
                {entry.recorded ? describeSizes(entry) : 'No design data'}
              </span>
              {entry.segmentCount > 0 && (
                <span className="pipeline-register__badge">
                  {entry.segmentCount} stretch{entry.segmentCount === 1 ? '' : 'es'}
                </span>
              )}
            </button>
          ))}
        </aside>

        <section className="pipeline-register__detail">
          {selected === null ? (
            <p className="pipeline-register__empty">Select a line to see the data recorded for it.</p>
          ) : (
            <>
              <header className="pipeline-register__detail-head">
                <div>
                  <h2>{selected.pipelineName}</h2>
                  <p>
                    {selected.recorded
                      ? `Sizes on record: ${describeSizes(selected)}.`
                      : 'Nothing recorded yet. What you enter here is what every assessment of this line will start from.'}
                  </p>
                </div>
                <Button
                  onClick={() => void save()}
                  disabled={saving || dossierLoading || problems.length > 0}
                  startIcon={<FiSave aria-hidden="true" />}
                >
                  {saving ? 'Saving…' : 'Save pipeline data'}
                </Button>
              </header>

              {dossierLoading ? (
                <p className="pipeline-register__empty">Loading the recorded data…</p>
              ) : (
                <PipelineSpecFields value={form} onChange={setForm} problems={problems} disabled={saving} />
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
