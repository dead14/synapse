/**
 * Step 2 — Threats.
 *
 * The eight pipeline threat categories, grouped as ASME B31.8S groups them. Two
 * are measured by the in-line inspection this assessment reads and are answered
 * for you. The other six take two dropdowns each: how much of it this line
 * carries, and whether anyone has inspected with a method that would find it.
 *
 * A threat starts unreviewed and is scored as an unknown until somebody says
 * otherwise. That is the whole point of the step — not to collect opinions, but
 * to make sure nobody skipped a threat and left the ranking looking complete.
 */

import { FiAlertTriangle } from 'react-icons/fi';

import { Badge, Callout } from '../../../components/ds';
import {
  COVERAGE_OPTIONS,
  RELEVANCE_OPTIONS,
  THREATS,
  THREAT_GROUPS,
  threatLabel,
} from '../../../lib/rbi/catalogues';
import { FieldGrid, NoteField, PickField, StepPanel } from '../RbiControls';
import type { StepProps } from '../stepProps';
import type { ThreatAssessment, ThreatRelevance } from '../../../lib/rbi/types';

const RELEVANCE_TONE: Record<ThreatRelevance, 'danger' | 'warning' | 'neutral'> = {
  active: 'danger',
  possible: 'warning',
  unreviewed: 'warning',
  'not-credible': 'neutral',
};

export default function StepThreats({ record, update }: StepProps) {
  const patch = (id: ThreatAssessment['id'], change: Partial<ThreatAssessment>) => {
    update((current) => ({
      ...current,
      threats: current.threats.map((threat) => (
        threat.id === id ? { ...threat, ...change } : threat
      )),
    }));
  };

  const unreviewed = record.threats.filter((threat) => threat.relevance === 'unreviewed');
  const missingReason = record.threats.filter(
    (threat) => threat.relevance === 'not-credible' && threat.note.trim() === '',
  );
  const blind = record.threats.filter(
    (threat) => threat.relevance === 'active' && threat.coverage === 'none',
  );

  return (
    <>
      {unreviewed.length > 0 && (
        <Callout tone="warning" title={`${unreviewed.length} threat(s) not reviewed yet`}>
          {unreviewed.map((threat) => threatLabel(threat.id)).join(', ')}. Each is scored as an unknown until
          you answer it, and the assessment cannot be issued while any remain.
        </Callout>
      )}

      {THREAT_GROUPS.map((group) => (
        <StepPanel key={group.id} title={group.label} blurb={group.blurb}>
          {THREATS.filter((definition) => definition.group === group.id).map((definition) => {
            const threat = record.threats.find((item) => item.id === definition.id);
            if (!threat) return null;

            return (
              <div key={definition.id} className="rbi-row-card">
                <div className="rbi-row-card__head">
                  <div className="rbi-row-card__title">{definition.label}</div>
                  {definition.measured
                    ? <Badge tone="success" pill>measured</Badge>
                    : <Badge tone={RELEVANCE_TONE[threat.relevance]} pill>{threat.relevance}</Badge>}
                </div>
                <div className="rbi-row-card__body">
                  <p className="rbi-check__hint" style={{ marginBottom: '0.625rem' }}>
                    {definition.hint}
                  </p>

                  {definition.measured ? (
                    <p className="rbi-check__hint">
                      Scored from the filed B31G assessment, section by section — the worst estimating repair
                      factor, the shortest remaining life and the deepest wall loss in each. Nothing to answer
                      here.
                    </p>
                  ) : (
                    <FieldGrid columns={2}>
                      <PickField
                        label="On this line"
                        value={threat.relevance}
                        options={RELEVANCE_OPTIONS}
                        onChange={(value) => patch(definition.id, { relevance: value })}
                      />
                      <PickField
                        label="Inspection coverage"
                        hint={`Found by: ${definition.detectedBy.toLowerCase()}.`}
                        value={threat.coverage}
                        options={COVERAGE_OPTIONS}
                        onChange={(value) => patch(definition.id, { coverage: value })}
                        disabled={threat.relevance === 'not-credible'}
                      />
                      <div className="rbi-grid__full">
                        <NoteField
                          label={threat.relevance === 'not-credible'
                            ? 'Why it is not credible here'
                            : 'Evidence'}
                          value={threat.note}
                          onChange={(value) => patch(definition.id, { note: value })}
                          placeholder={threat.relevance === 'not-credible'
                            ? 'It will be re-tested against this reason when the line or its surroundings change.'
                            : 'What the judgement rests on — findings, survey results, similar service, operating history.'}
                        />
                      </div>
                    </FieldGrid>
                  )}
                </div>
              </div>
            );
          })}
        </StepPanel>
      ))}

      {missingReason.length > 0 && (
        <Callout tone="danger" icon={<FiAlertTriangle />} title="Ruled-out threats need a reason">
          {missingReason.map((threat) => threatLabel(threat.id)).join(', ')}. Ruling a threat out is a finding.
          Record why, so it can be re-tested when the line or its surroundings change.
        </Callout>
      )}

      {blind.length > 0 && (
        <Callout tone="warning" title="Active threats with no inspection">
          {blind.map((threat) => threatLabel(threat.id)).join(', ')}. Inspection does not change the damage,
          only what is known about it — where there has been none, the damage state is unknown. These are
          floored at category 3 and every affected section says so in its recommendation.
        </Callout>
      )}
    </>
  );
}
