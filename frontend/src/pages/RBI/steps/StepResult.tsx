/**
 * Step 4 — Result.
 *
 * The deliverable: the matrix, the ranked sections, the intervals and the
 * recommendation for each. Signing it is two fields, and the readiness list
 * names anything still outstanding rather than greying out a button and leaving
 * the engineer to guess why.
 */

import { FiCheck, FiDownload, FiX } from 'react-icons/fi';

import { Badge, Button, Callout, MathBlock, Stat, StatGrid } from '../../../components/ds';
import { INTERVAL_BASIS_LABEL } from '../../../lib/rbi/catalogues';
import { RBI_TEX } from '../../../lib/rbi/notation';
import { RBI_STEPS, readiness } from '../../../lib/rbi/record';
import RiskMatrix, { RiskTag } from '../RiskMatrix';
import {
  DateField,
  EmptyState,
  FieldGrid,
  FullWidth,
  NoteField,
  StepPanel,
  TextField,
} from '../RbiControls';
import type { StepProps } from '../stepProps';
import type { RbiStepId, RiskAcceptance } from '../../../lib/rbi/types';

const ACCEPTANCE_TONE: Record<RiskAcceptance, 'success' | 'warning' | 'danger'> = {
  acceptable: 'success',
  tolerable: 'warning',
  unacceptable: 'danger',
};

interface Props extends StepProps {
  status: 'draft' | 'issued';
  onIssue: () => void;
  onWithdraw: () => void;
  onExport: () => void;
  onGoToStep: (step: RbiStepId) => void;
}

export default function StepResult({
  record,
  update,
  assessment,
  status,
  onIssue,
  onWithdraw,
  onExport,
  onGoToStep,
}: Props) {
  const set = <K extends keyof typeof record>(key: K, value: (typeof record)[K]) => {
    update((current) => ({ ...current, [key]: value }));
  };

  const checks = readiness(record);
  const outstanding = checks.filter((item) => !item.satisfied);

  if (!assessment) {
    return (
      <StepPanel title="Result" blurb="Nothing to rank yet.">
        <EmptyState>
          No filed assessment is attached, so there is no measured damage to rank. Attach one on the first
          step.
        </EmptyState>
      </StepPanel>
    );
  }

  return (
    <>
      <StepPanel title="Summary" blurb={`${assessment.lineName}, inspected ${assessment.assessmentDateIso}.`}>
        <StatGrid>
          <Stat label="Sections" value={assessment.sections.length} />
          <Stat
            label="At unacceptable risk"
            value={assessment.totals.unacceptable}
            tone={assessment.totals.unacceptable > 0 ? 'danger' : 'success'}
          />
          <Stat label="Assessed features" value={assessment.totals.features.toLocaleString()} />
          <Stat
            label="Earliest inspection due"
            value={assessment.totals.nextDueIso ?? '—'}
            hint="Counted from the inspection date the evidence carries."
          />
        </StatGrid>
      </StepPanel>

      <StepPanel
        title="Risk matrix"
        blurb="Probability up, consequence across. The number in a cell is how many sections landed there."
      >
        <RiskMatrix sections={assessment.sections} />
        <MathBlock tex={RBI_TEX.risk} label="risk is a lookup on probability and consequence" />
        <p className="rbi-check__hint">
          A lookup, not a product. The asymmetry is the decision an operator signs: a consequence-5
          section is never reported as low risk however unlikely failure is, which multiplying the two
          categories would have allowed.
        </p>
      </StepPanel>

      <StepPanel
        title="Inspection plan"
        blurb="Highest risk first. The interval is half the remaining life, capped by the risk level and then
          by any regulatory limit."
      >
        <MathBlock tex={RBI_TEX.interval} label="inspection interval rule" />
        <p className="rbi-check__hint" style={{ marginBottom: '0.75rem' }}>
          Half the remaining life, so the line is looked at again while there is still time to act on what
          is found. Where no remaining-life figure exists the caps are all there is, and the result is
          reported as a target rather than as a calculated interval.
        </p>
        <div className="ds-table-wrap">
          <table className="ds-table">
            <thead>
              <tr>
                <th scope="col">Section</th>
                <th scope="col">Extent</th>
                <th scope="col">P</th>
                <th scope="col">C</th>
                <th scope="col">Risk</th>
                <th scope="col">Interval</th>
                <th scope="col">Next inspection</th>
                <th scope="col">Governing threat</th>
              </tr>
            </thead>
            <tbody>
              {assessment.sections.map((section) => (
                <tr key={section.id}>
                  <th scope="row">
                    {section.label}
                    <span className="rbi-registry__meta">
                      {section.featureCount.toLocaleString()} assessed
                      {section.probability.unassessedCount > 0
                        && `, ${section.probability.unassessedCount.toLocaleString()} unassessed`}
                      {section.consequence.overridden && ' · consequence overridden'}
                    </span>
                  </th>
                  <td className="ds-data">
                    {section.fromM === null ? '—' : section.fromM.toFixed(0)}
                    {' – '}
                    {section.toM === null ? '—' : `${section.toM.toFixed(0)} m`}
                  </td>
                  <td className="ds-data">{section.probability.category}</td>
                  <td className="ds-data">{section.consequence.category}</td>
                  <td>
                    <RiskTag level={section.riskLevel} />
                    <Badge tone={ACCEPTANCE_TONE[section.acceptance]} pill>{section.acceptance}</Badge>
                  </td>
                  <td className="ds-data">{section.inspection.intervalYears} y</td>
                  <td>
                    <span className="ds-data">{section.inspection.dueDateIso ?? '—'}</span>
                    <span className="rbi-registry__meta">
                      {INTERVAL_BASIS_LABEL[section.inspection.basis]}
                    </span>
                  </td>
                  <td>
                    {section.probability.governingThreat ?? '—'}
                    {section.probability.growthAssumed && (
                      <Badge tone="warning" pill>assumed growth</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </StepPanel>

      <StepPanel title="Recommendations" blurb="One per section, in the order the ranking put them.">
        <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
          {assessment.sections.map((section) => (
            <li key={section.id} className="rbi-check__hint" style={{ display: 'list-item', marginBottom: '0.5rem' }}>
              <strong>{section.label}</strong> — {section.inspection.recommendation}
              {section.governingFeature?.featureId && (
                <span className="rbi-registry__meta">
                  Governed by {section.governingFeature.featureId}
                  {section.governingFeature.ldM !== null && ` at ${section.governingFeature.ldM.toFixed(0)} m`}
                  {section.governingFeature.erf !== null && `, ERF ${section.governingFeature.erf.toFixed(3)}`}
                </span>
              )}
            </li>
          ))}
        </ul>
      </StepPanel>

      <StepPanel
        title="Sign off and export"
        blurb="An unsigned risk assessment is a draft, whatever it says on the cover."
        actions={(
          <Button variant="secondary" size="sm" startIcon={<FiDownload />} onClick={onExport}>
            Export workbook
          </Button>
        )}
      >
        <FieldGrid columns={2}>
          <TextField
            label="Assessed by"
            value={record.assessedBy}
            onChange={(value) => set('assessedBy', value)}
          />
          <DateField
            label="Assessed on"
            value={record.assessedOnIso}
            onChange={(value) => set('assessedOnIso', value)}
          />
          <FullWidth>
            <NoteField
              label="Notes"
              rows={3}
              value={record.notes}
              onChange={(value) => set('notes', value)}
              placeholder="Anything the next reader needs — assumptions made, data that was missing, what the full assessment should look at."
            />
          </FullWidth>
        </FieldGrid>

        {outstanding.length > 0 ? (
          <>
            <div className="rbi-checklist" style={{ marginTop: '0.875rem' }}>
              {checks.map((item) => (
                <div
                  key={item.id}
                  className={`rbi-checklist__item ${item.satisfied ? 'is-met' : 'is-unmet-shall'}`}
                >
                  <span aria-hidden="true">
                    {item.satisfied
                      ? <FiCheck color="var(--ds-success)" />
                      : <FiX color="var(--ds-danger)" />}
                  </span>
                  <span className="rbi-checklist__req">
                    {item.requirement}
                    {!item.satisfied && (
                      <>
                        {' '}
                        <button type="button" className="ds-linklike" onClick={() => onGoToStep(item.step)}>
                          Go to {RBI_STEPS.find((step) => step.id === item.step)?.label} →
                        </button>
                      </>
                    )}
                  </span>
                </div>
              ))}
            </div>
            <Callout tone="warning" title="Not ready to issue">
              The workbook can still be exported — a draft marked as a draft is a legitimate thing to
              circulate, and the cover sheet says what is outstanding.
            </Callout>
          </>
        ) : status === 'issued' ? (
          <>
            <Callout tone="success" title="Issued">
              Still editable — a screening is meant to be re-run when new inspection results land. Withdraw it
              if it needs substantive rework.
            </Callout>
            <div className="ds-row" style={{ marginTop: '0.75rem' }}>
              <Button variant="danger" size="sm" onClick={onWithdraw}>Withdraw to draft</Button>
            </div>
          </>
        ) : (
          <div className="ds-row" style={{ marginTop: '0.875rem' }}>
            <Button variant="primary" size="sm" startIcon={<FiCheck />} onClick={onIssue}>
              Issue assessment
            </Button>
          </div>
        )}
      </StepPanel>

      <StepPanel
        title="What this does not cover"
        blurb="Carried onto the last sheet of the workbook."
      >
        <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
          {assessment.provenance.limitations.map((limit) => (
            <li key={limit} className="rbi-check__hint" style={{ display: 'list-item' }}>{limit}</li>
          ))}
        </ul>
      </StepPanel>
    </>
  );
}
