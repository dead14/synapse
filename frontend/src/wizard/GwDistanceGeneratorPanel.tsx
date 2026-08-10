import { useCallback, useEffect, useState } from 'react';
import { FiCheckCircle, FiGitCommit, FiPlay, FiRefreshCw } from 'react-icons/fi';

import { Badge, Button, Callout, Panel, PanelBody, PanelHeader } from '../components/ds';
import { apiFetch } from '../utils/api';

/**
 * Generates the absolute U/S girth weld distance for one run, from its odometer.
 *
 * Why this is a visible step and not something the engine quietly does: the
 * value is derived, and a derived measurement nobody inspected is not obviously
 * better than a blank one. The preview runs the identical pass the apply would,
 * with the commit withheld, so what an engineer checks here is exactly what gets
 * written — not a second estimate of it.
 */

export type GwDistanceSummary = {
  runId: number;
  runYear?: number | null;
  applied: boolean;
  featureCount: number;
  girthWelds: number;
  derivedCount: number;
  noUpstreamWeldCount: number;
  unreadableDistanceCount: number;
  vendorReportedCount: number;
  vendorCoverage: number;
  medianJointLengthM: number | null;
  firstGirthWeldM: number | null;
  lastGirthWeldM: number | null;
  sample: Array<{
    featureId: string | null;
    featureType: string | null;
    logDistanceM: number | null;
    derivedM: number | null;
    referenceWeldM: number | null;
    vendorM: number | null;
  }>;
  warnings: string[];
  lastGeneration?: { generatedAt: string; derivedCount: number } | null;
};

function metres(value: number | null | undefined, places = 3): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(places) : '—';
}

export default function GwDistanceGeneratorPanel({
  runId,
  label,
}: {
  runId: number;
  label: string;
}) {
  const [summary, setSummary] = useState<GwDistanceSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPreview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSummary(await apiFetch<GwDistanceSummary>(`/api/runs/${runId}/gw-distance`));
    } catch (caught: any) {
      setError(caught?.message || 'Could not preview the generation for this run.');
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => { void loadPreview(); }, [loadPreview]);

  const apply = async () => {
    setApplying(true);
    setError(null);
    try {
      setSummary(await apiFetch<GwDistanceSummary>(`/api/runs/${runId}/gw-distance`, {
        method: 'POST',
      }));
    } catch (caught: any) {
      setError(caught?.message || 'Could not generate the U/S GW distance for this run.');
    } finally {
      setApplying(false);
    }
  };

  const alreadyGenerated = Boolean(summary?.lastGeneration);
  const canGenerate = Boolean(summary && summary.girthWelds > 0);

  return (
    <Panel>
      <PanelHeader
        plain
        eyebrow={label}
        title="U/S girth weld distance"
        subtitle="Derive each feature's distance to its own upstream girth weld from the odometer."
        actions={
          <Button
            size="sm"
            variant="ghost"
            startIcon={<FiRefreshCw aria-hidden="true" />}
            onClick={() => void loadPreview()}
            disabled={loading}
          >
            Refresh
          </Button>
        }
      />
      <PanelBody className="ds-stack">
        {error && <Callout tone="danger">{error}</Callout>}

        {loading && !summary ? (
          <p className="tol-row__desc">Reading the run…</p>
        ) : !summary ? null : (
          <>
            <dl className="tol-profile__summary">
              <div><dt>Girth welds found</dt><dd>{summary.girthWelds.toLocaleString()}</dd></div>
              <div><dt>Would be derived</dt><dd>{summary.derivedCount.toLocaleString()}</dd></div>
              <div><dt>Vendor already reports</dt><dd>{summary.vendorReportedCount.toLocaleString()}</dd></div>
              <div><dt>Median joint length</dt><dd>{metres(summary.medianJointLengthM, 2)} m</dd></div>
              <div><dt>No upstream weld</dt><dd>{summary.noUpstreamWeldCount.toLocaleString()}</dd></div>
            </dl>

            {summary.warnings.map((warning) => (
              <Callout key={warning} tone="warning">{warning}</Callout>
            ))}

            {summary.sample.length > 0 && (
              <div className="alignment-review-inventory__table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Feature</th>
                      <th>Log distance (m)</th>
                      <th>− U/S weld at (m)</th>
                      <th>= Derived (m)</th>
                      <th>Vendor (m)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.sample.map((row, index) => (
                      <tr key={`${row.featureId ?? index}`}>
                        <th scope="row">{row.featureId ?? '—'}</th>
                        <td>{metres(row.logDistanceM)}</td>
                        <td>{metres(row.referenceWeldM)}</td>
                        <td><strong>{metres(row.derivedM)}</strong></td>
                        <td>{row.vendorM === null ? 'blank' : metres(row.vendorM)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <Callout tone="info" icon={<FiGitCommit aria-hidden="true" />}>
              The result is written to a separate derived column; the vendor's own
              readings are never overwritten. Generating it does not commit the comparison
              to using it — that stays with the U/S GW distance source setting in the
              Tolerances step, which requires both runs to be on the same provenance.
            </Callout>

            <div className="ds-row">
              <Button
                startIcon={<FiPlay aria-hidden="true" />}
                onClick={() => void apply()}
                disabled={!canGenerate || applying}
              >
                {applying ? 'Generating…' : alreadyGenerated ? 'Regenerate' : 'Generate and save'}
              </Button>
              {alreadyGenerated && (
                <Badge tone="success" pill icon={<FiCheckCircle aria-hidden="true" />}>
                  Generated · {summary.lastGeneration?.derivedCount.toLocaleString()} values
                </Badge>
              )}
              {summary.applied && <Badge tone="success" pill>Saved</Badge>}
            </div>
          </>
        )}
      </PanelBody>
    </Panel>
  );
}
