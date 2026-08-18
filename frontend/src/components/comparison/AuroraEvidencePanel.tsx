import { useMemo, useState } from 'react';
import {
  FiActivity,
  FiAlertTriangle,
  FiChevronDown,
  FiChevronUp,
  FiCompass,
  FiInfo,
} from 'react-icons/fi';
import {
  AURORA_MODE_LABELS,
  AURORA_STATE_LABELS,
  formatMetres,
  formatPercent,
  type AuroraArtifacts,
  type AuroraTransformState,
} from '../../domain/auroraEvidence';
import { Badge, Callout, Panel, PanelBody, PanelHeader, Stat, StatGrid } from '../ds';

interface AuroraEvidencePanelProps {
  artifacts: AuroraArtifacts;
}

const SEVERITY_TONE: Record<string, 'danger' | 'warning' | 'info'> = {
  CRITICAL: 'danger',
  REVIEW: 'warning',
  INFO: 'info',
};

/**
 * How the registration field varies along the line.
 *
 * Two lanes rather than one axis: the axial residual is in metres and the
 * clock correction is in degrees, and drawing them on a shared scale would
 * make one of them look flat whichever pair of runs is loaded.
 */
function TransformFieldChart({ states }: { states: AuroraTransformState[] }) {
  const width = 720;
  const laneHeight = 54;
  const gap = 16;
  const height = laneHeight * 2 + gap;

  const series = useMemo(() => {
    if (states.length === 0) return null;
    const axial = states.map((state) => state.axialResidualM);
    const clock = states.map((state) => state.clockRotationDeg);
    const axialMax = Math.max(0.25, ...axial.map(Math.abs));
    const clockMax = Math.max(5, ...clock.map(Math.abs));
    const step = states.length > 1 ? width / (states.length - 1) : width;
    const path = (values: number[], scale: number, top: number) => values
      .map((value, index) => {
        const x = index * step;
        const y = top + laneHeight / 2 - (value / scale) * (laneHeight / 2 - 4);
        return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');
    return {
      axialPath: path(axial, axialMax, 0),
      clockPath: path(clock, clockMax, laneHeight + gap),
      axialMax,
      clockMax,
    };
  }, [states]);

  if (!series) return null;

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        preserveAspectRatio="none"
        role="img"
        aria-label="Local axial residual and clock rotation along the registered joints"
      >
        <line
          x1={0} x2={width} y1={laneHeight / 2} y2={laneHeight / 2}
          stroke="var(--ds-line-strong)" strokeWidth={1} strokeDasharray="3 3"
        />
        <line
          x1={0} x2={width}
          y1={laneHeight + gap + laneHeight / 2}
          y2={laneHeight + gap + laneHeight / 2}
          stroke="var(--ds-line-strong)" strokeWidth={1} strokeDasharray="3 3"
        />
        <path d={series.axialPath} fill="none" stroke="var(--ds-primary)" strokeWidth={1.6} />
        <path d={series.clockPath} fill="none" stroke="var(--ds-warning)" strokeWidth={1.6} />
      </svg>
      <div className="ds-row" style={{ justifyContent: 'space-between', fontSize: 'var(--ds-t-micro)' }}>
        <span className="ds-muted">
          <span style={{ color: 'var(--ds-primary)' }}>■</span> axial residual ±{series.axialMax.toFixed(2)} m
        </span>
        <span className="ds-muted">
          <span style={{ color: 'var(--ds-warning)' }}>■</span> clock rotation ±{series.clockMax.toFixed(0)}°
        </span>
      </div>
    </div>
  );
}

/**
 * The engineering evidence behind an AURORA run.
 *
 * The point of the strategy is that every automatic decision is reproducible
 * from stored evidence, so this panel exposes what the engine concluded at each
 * stage — capability, structural map, coordinate registration, pattern rescue —
 * rather than only the final match count.
 */
export default function AuroraEvidencePanel({ artifacts }: AuroraEvidencePanelProps) {
  const [expanded, setExpanded] = useState(false);
  const { summary, capabilityProfile, anchorMap, persistentJointMap, transformField } = artifacts;
  const modeLabel = AURORA_MODE_LABELS[summary.mode] || summary.mode || '—';
  const stateLabel = AURORA_STATE_LABELS[summary.state] || summary.state;
  const acceptedRescues = artifacts.rescueCases.filter((item) => item.status === 'ACCEPTED');
  const declinedRescues = artifacts.rescueCases.filter((item) => item.status !== 'ACCEPTED');

  return (
    <Panel className="animate-fade-in">
      <PanelHeader
        icon={<FiCompass aria-hidden="true" />}
        eyebrow={summary.pairLabel ? `AURORA-ILI · ${summary.pairLabel}` : 'AURORA-ILI'}
        title="Universal registration evidence"
        subtitle={
          summary.modeReasons.length > 0
            ? `${modeLabel} mode — ${summary.modeReasons.join('; ')}`
            : `${modeLabel} mode`
        }
        actions={
          <button
            type="button"
            className="ds-btn ds-btn--secondary ds-btn--sm"
            aria-expanded={expanded}
            onClick={() => setExpanded((open) => !open)}
          >
            {expanded ? <FiChevronUp aria-hidden="true" /> : <FiChevronDown aria-hidden="true" />}
            {expanded ? 'Hide evidence' : 'Show evidence'}
          </button>
        }
      />
      <PanelBody className="ds-stack">
        <div className="ds-row" style={{ gap: '0.375rem' }}>
          <Badge tone={summary.state === 'REVIEW_READY' ? 'success' : 'warning'} pill>
            {stateLabel}
          </Badge>
          <Badge tone="primary" pill>{modeLabel}</Badge>
          <Badge pill>config {summary.configVersion}</Badge>
          <Badge pill>model {summary.modelVersion}</Badge>
        </div>

        <StatGrid>
          <Stat
            label="Structural anchors registered"
            value={summary.anchorPairs.toLocaleString()}
            hint={anchorMap
              ? `${anchorMap.deleted} missing · ${anchorMap.inserted} added · ${formatPercent(anchorMap.confidence)} explained`
              : undefined}
          />
          <Stat
            label="Physical joints"
            value={(persistentJointMap?.jointCount ?? 0).toLocaleString()}
            hint={persistentJointMap
              ? `${persistentJointMap.trusted} trusted · ${persistentJointMap.uncertain} uncertain · ${persistentJointMap.changed} changed`
              : undefined}
          />
          <Stat
            label="Auto-accepted matches"
            value={summary.autoAccepted.toLocaleString()}
            tone="success"
            hint={`${summary.matchGroups.toLocaleString()} correspondence groups in total`}
          />
          <Stat
            label="Needs review"
            value={artifacts.reviewQueueTotal.toLocaleString()}
            tone={artifacts.reviewQueueTotal > 0 ? 'warning' : 'neutral'}
            hint={`${summary.regionOnly} region-only · ${summary.structuralChange} in change zones`}
          />
          <Stat
            label="Pattern rescues"
            value={`${summary.rescueAccepted} / ${summary.rescueAttempts}`}
            hint="accepted / attempted"
          />
          <Stat
            label="Local clock correction"
            value={transformField?.medianClockRotationDeg != null
              ? `${transformField.medianClockRotationDeg.toFixed(1)}°`
              : 'none'}
            hint={transformField
              ? `${transformField.rotatedJoints} joints rotated by more than 10°`
              : undefined}
          />
        </StatGrid>

        {artifacts.failureReason && (
          <Callout tone="warning" icon={<FiAlertTriangle aria-hidden="true" />} title="No identity was claimed">
            {artifacts.failureReason}
          </Callout>
        )}

        {artifacts.warnings.map((warning) => (
          <Callout
            key={`${warning.code}-${warning.message}`}
            tone={SEVERITY_TONE[warning.severity] || 'info'}
            icon={<FiInfo aria-hidden="true" />}
            title={warning.code.replace(/_/g, ' ').toLowerCase()}
          >
            {warning.message}
          </Callout>
        ))}

        {expanded && (
          <div className="ds-stack">
            {transformField && transformField.states.length > 1 && (
              <section className="ds-stack ds-stack--sm">
                <p className="ds-eyebrow">Local transform field</p>
                <TransformFieldChart states={transformField.states} />
                <p className="ds-muted" style={{ fontSize: 'var(--ds-t-xs)', margin: 0 }}>
                  Median axial scale {transformField.medianAxialScale?.toFixed(5) ?? '—'}
                  {transformField.driftCheck?.totalAccumulatedDriftM !== undefined && (
                    <>
                      {' · '}accumulated drift {formatMetres(transformField.driftCheck.totalAccumulatedDriftM)}
                      {transformField.driftCheck.explained
                        ? ' — fully explained by reported joint lengths, so it is not evidence of a wrong match'
                        : ' — not fully explained by joint lengths; review the joint map'}
                    </>
                  )}
                </p>
              </section>
            )}

            {capabilityProfile && (
              <section className="ds-stack ds-stack--sm">
                <p className="ds-eyebrow">Evidence available in this run pair</p>
                <div className="ds-table-wrap">
                  <table className="ds-table">
                    <thead>
                      <tr><th>Evidence</th><th className="ds-table__num">Coverage</th><th>Notes</th></tr>
                    </thead>
                    <tbody>
                      <tr>
                        <th scope="row">Structural anchors</th>
                        <td className="ds-table__num ds-data">{formatPercent(capabilityProfile.anchorCoverage)}</td>
                        <td>
                          {capabilityProfile.anchorCountOld.toLocaleString()} old ·{' '}
                          {capabilityProfile.anchorCountNew.toLocaleString()} new · median gap{' '}
                          {formatMetres(capabilityProfile.medianAnchorGapM)}
                        </td>
                      </tr>
                      <tr>
                        <th scope="row">Clock position</th>
                        <td className="ds-table__num ds-data">{formatPercent(capabilityProfile.clockCoverage)}</td>
                        <td>of metal-loss features carry a readable clock</td>
                      </tr>
                      <tr>
                        <th scope="row">Depth and length</th>
                        <td className="ds-table__num ds-data">{formatPercent(capabilityProfile.dimensionCoverage)}</td>
                        <td>weak identity evidence across tool generations — down-weighted, never a gate</td>
                      </tr>
                      <tr>
                        <th scope="row">Surface</th>
                        <td className="ds-table__num ds-data">{formatPercent(capabilityProfile.surfaceCoverage)}</td>
                        <td>internal and external loss are never paired with each other</td>
                      </tr>
                      <tr>
                        <th scope="row">Reporting density</th>
                        <td className="ds-table__num ds-data">
                          {capabilityProfile.densityRatio?.toFixed(2) ?? '—'}×
                        </td>
                        <td>
                          {capabilityProfile.metalLossOld.toLocaleString()} old ·{' '}
                          {capabilityProfile.metalLossNew.toLocaleString()} new metal-loss features
                        </td>
                      </tr>
                      <tr>
                        <th scope="row">Tool comparability</th>
                        <td className="ds-table__num ds-data">{formatPercent(capabilityProfile.toolComparability)}</td>
                        <td>
                          {capabilityProfile.crossTechnology
                            ? 'different sensing technologies — geometric uncertainty inflated'
                            : 'comparable technologies'}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {anchorMap && anchorMap.changeZones.length > 0 && (
              <section className="ds-stack ds-stack--sm">
                <p className="ds-eyebrow">Structural change zones</p>
                <div className="ds-table-wrap">
                  <table className="ds-table">
                    <thead>
                      <tr><th className="ds-table__num">Old KP</th><th className="ds-table__num">New KP</th><th>Why</th></tr>
                    </thead>
                    <tbody>
                      {anchorMap.changeZones.map((zone, index) => (
                        <tr key={`${zone.oldXFrom}-${index}`}>
                          <td className="ds-table__num ds-data">
                            {formatMetres(zone.oldXFrom)} – {formatMetres(zone.oldXTo)}
                          </td>
                          <td className="ds-table__num ds-data">
                            {formatMetres(zone.newXFrom)} – {formatMetres(zone.newXTo)}
                          </td>
                          <td>{zone.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="ds-muted" style={{ fontSize: 'var(--ds-t-xs)', margin: 0 }}>
                  Anomaly identity is not forced across these zones. Their features stay in the
                  report as bypassed rows so fitness-for-service still sees them.
                </p>
              </section>
            )}

            {artifacts.rescueCases.length > 0 && (
              <section className="ds-stack ds-stack--sm">
                <p className="ds-eyebrow">
                  Pattern rescue — {acceptedRescues.length} accepted, {declinedRescues.length} declined
                </p>
                <div className="ds-table-wrap">
                  <table className="ds-table">
                    <thead>
                      <tr>
                        <th>Joint</th>
                        <th>Outcome</th>
                        <th className="ds-table__num">Clock</th>
                        <th className="ds-table__num">Inliers</th>
                        <th className="ds-table__num">Uniqueness</th>
                        <th>Trigger</th>
                      </tr>
                    </thead>
                    <tbody>
                      {artifacts.rescueCases.slice(0, 40).map((rescue) => (
                        <tr key={`${rescue.pjid}-${rescue.status}`}>
                          <th scope="row" className="ds-data">{rescue.pjid}</th>
                          <td>
                            <Badge tone={rescue.status === 'ACCEPTED' ? 'success' : 'warning'}>
                              {rescue.status.replace(/_/g, ' ').toLowerCase()}
                            </Badge>
                          </td>
                          <td className="ds-table__num ds-data">
                            {rescue.clockRotationDeg.toFixed(1)}° ({rescue.clockRotationHours.toFixed(1)} h)
                          </td>
                          <td className="ds-table__num ds-data">
                            {rescue.inliers} / {Math.min(rescue.sourcePoints, rescue.targetPoints)}
                          </td>
                          <td className="ds-table__num ds-data">{formatPercent(rescue.ambiguity)}</td>
                          <td>{rescue.triggerReason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="ds-muted" style={{ fontSize: 'var(--ds-t-xs)', margin: 0 }}>
                  A rescue estimates the local transform and then scores the corrected residual.
                  It never widens the raw tolerance, and it never searches outside the registered
                  structural corridor.
                </p>
              </section>
            )}

            {artifacts.reviewQueue.length > 0 && (
              <section className="ds-stack ds-stack--sm">
                <p className="ds-eyebrow">
                  Review queue — {artifacts.reviewQueueTotal.toLocaleString()} exception
                  {artifacts.reviewQueueTotal === 1 ? '' : 's'}
                </p>
                <div className="ds-table-wrap">
                  <table className="ds-table">
                    <thead>
                      <tr>
                        <th>Joint</th>
                        <th>Type</th>
                        <th>Class</th>
                        <th className="ds-table__num">P(match)</th>
                        <th className="ds-table__num">Margin</th>
                        <th>Why it is here</th>
                      </tr>
                    </thead>
                    <tbody>
                      {artifacts.reviewQueue.slice(0, 50).map((item, index) => (
                        <tr key={`${item.pjid}-${item.type}-${index}`}>
                          <th scope="row" className="ds-data">{item.pjid || '—'}</th>
                          <td>{item.type.replace(/_/g, ' ').toLowerCase()}</td>
                          <td>
                            <Badge tone={item.confidenceClass === 'AMBIGUOUS' ? 'warning' : 'neutral'}>
                              {item.confidenceClass.replace(/_/g, ' ').toLowerCase()}
                            </Badge>
                          </td>
                          <td className="ds-table__num ds-data">{item.probability.toFixed(3)}</td>
                          <td className="ds-table__num ds-data">{item.ambiguityMargin.toFixed(3)}</td>
                          <td>{item.explanation.join('; ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {artifacts.reviewQueueTotal > artifacts.reviewQueue.length && (
                  <p className="ds-muted" style={{ fontSize: 'var(--ds-t-xs)', margin: 0 }}>
                    Showing the first {artifacts.reviewQueue.length.toLocaleString()} of{' '}
                    {artifacts.reviewQueueTotal.toLocaleString()} queued exceptions.
                  </p>
                )}
              </section>
            )}

            <Callout tone="info" icon={<FiActivity aria-hidden="true" />} title="How to read these rows">
              Result rows carry the AURORA columns: the group id ties the members of a split or
              merge together, and the axial and clock residuals are measured after the local
              transform, not against the raw odometer difference.
            </Callout>
          </div>
        )}
      </PanelBody>
    </Panel>
  );
}
