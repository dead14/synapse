/**
 * Step 10 — Review, sign-off and issue (API 580 §16, Appendix A).
 *
 * The whole Appendix A checklist is rendered here against the document as it
 * stands, because that is the practice's own definition of a complete RBI
 * programme and it is more useful as a live list than as an annex nobody opens.
 *
 * Unmet `shall` items block issue; unmet `should` items are shown and do not.
 * That is the distinction API 580 draws in its own Foreword — "shall" is a
 * minimum requirement, "should" is a recommendation — and blurring it would
 * teach engineers to type something into any field that shows a warning, which
 * produces a complete-looking assessment and a worse one.
 */

import { FiCheck, FiDownload, FiX } from 'react-icons/fi';

import { Badge, Button, Callout, Stat, StatGrid } from '../../../components/ds';
import type { ChecklistItem } from '../../../lib/rbi/checklist';
import { RBI_STEPS } from '../../../lib/rbi/record';
import {
  DateField,
  FieldGrid,
  FullWidth,
  NoteField,
  StepPanel,
  TextField,
} from '../RbiControls';
import type { StepProps } from '../stepProps';
import type { RbiStepId } from '../../../lib/rbi/types';

interface Props extends StepProps {
  status: 'draft' | 'issued';
  onIssue: () => void;
  onWithdraw: () => void;
  onExport: () => void;
  onGoToStep: (step: RbiStepId) => void;
}

function ChecklistRow({ item, onGoToStep }: { item: ChecklistItem; onGoToStep: (step: RbiStepId) => void }) {
  const state = item.satisfied
    ? 'is-met'
    : item.level === 'shall' ? 'is-unmet-shall' : 'is-unmet-should';
  const stepLabel = RBI_STEPS.find((step) => step.id === item.step)?.label ?? item.step;

  return (
    <div className={`rbi-checklist__item ${state}`}>
      <span aria-hidden="true">
        {item.satisfied ? <FiCheck color="var(--ds-success)" /> : <FiX color="var(--ds-danger)" />}
      </span>
      <div>
        <span className="rbi-checklist__req">
          {item.requirement}{' '}
          <span className="rbi-checklist__src">{item.section}</span>{' '}
          <Badge tone={item.level === 'shall' ? 'danger' : 'warning'} pill>{item.level}</Badge>
        </span>
        {!item.satisfied && (
          <span className="rbi-checklist__remedy">
            {item.remedy}{' '}
            <button type="button" className="ds-linklike" onClick={() => onGoToStep(item.step)}>
              Go to {stepLabel} →
            </button>
          </span>
        )}
      </div>
    </div>
  );
}

export default function StepDocumentation({
  record,
  update,
  assessment,
  checklist,
  status,
  onIssue,
  onWithdraw,
  onExport,
  onGoToStep,
}: Props) {
  const setDoc = (patch: Partial<typeof record.documentation>) => {
    update((current) => ({
      ...current,
      documentation: { ...current.documentation, ...patch },
    }));
  };

  const unmet = checklist.items.filter((item) => !item.satisfied);
  const met = checklist.items.filter((item) => item.satisfied);
  const canIssue = checklist.blockers.length === 0;

  return (
    <>
      <StepPanel
        title="Appendix A — checklist for creating an RBI programme"
        section="Appendix A · §16"
        blurb="The practice's own list, evaluated against this document. Unmet shall-items prevent issue;
          unmet should-items are recommendations and do not."
      >
        <StatGrid>
          <Stat
            label="Shall items met"
            value={`${checklist.shallMet} / ${checklist.shallTotal}`}
            tone={checklist.blockers.length === 0 ? 'success' : 'danger'}
            lead
            hint="Minimum requirements for conformance."
          />
          <Stat
            label="Should items met"
            value={`${checklist.shouldMet} / ${checklist.shouldTotal}`}
            tone={checklist.shouldMet === checklist.shouldTotal ? 'success' : 'warning'}
            hint="Recommendations. Advised, not required."
          />
          <Stat
            label="Status"
            value={status === 'issued' ? 'Issued' : 'Draft'}
            tone={status === 'issued' ? 'success' : 'neutral'}
            hint={status === 'issued' ? 'Signed off under §16.5.' : 'Not yet signed off.'}
          />
        </StatGrid>

        {unmet.length > 0 && (
          <>
            <p className="ds-field__label" style={{ marginTop: '0.875rem' }}>
              Outstanding ({unmet.length})
            </p>
            <div className="rbi-checklist">
              {unmet.map((item) => (
                <ChecklistRow key={item.id} item={item} onGoToStep={onGoToStep} />
              ))}
            </div>
          </>
        )}

        {met.length > 0 && (
          <>
            <p className="ds-field__label" style={{ marginTop: '0.875rem' }}>
              Satisfied ({met.length})
            </p>
            <div className="rbi-checklist">
              {met.map((item) => (
                <ChecklistRow key={item.id} item={item} onGoToStep={onGoToStep} />
              ))}
            </div>
          </>
        )}
      </StepPanel>

      <StepPanel
        title="Sign-off"
        section="§16.5 · §16.8"
        blurb="An unsigned risk assessment is a draft, whatever it says on the cover."
      >
        <FieldGrid columns={2}>
          <TextField
            label="Assessed by"
            value={record.documentation.assessedBy}
            onChange={(value) => setDoc({ assessedBy: value })}
          />
          <DateField
            label="Assessed on"
            value={record.documentation.assessedOnIso}
            onChange={(value) => setDoc({ assessedOnIso: value })}
          />
          <TextField
            label="Reviewed by"
            hint="A second engineer. §8.3 and §16.5 both turn on somebody other than the author having looked."
            value={record.documentation.reviewedBy}
            onChange={(value) => setDoc({ reviewedBy: value })}
          />
          <DateField
            label="Reviewed on"
            value={record.documentation.reviewedOnIso}
            onChange={(value) => setDoc({ reviewedOnIso: value })}
          />
          <TextField
            label="Approved by"
            hint="Whoever accepts the residual risk on behalf of the operator (§7.2.7)."
            value={record.documentation.approvedBy}
            onChange={(value) => setDoc({ approvedBy: value })}
          />
          <DateField
            label="Approved on"
            value={record.documentation.approvedOnIso}
            onChange={(value) => setDoc({ approvedOnIso: value })}
          />
          <FullWidth>
            <NoteField
              label="Methodology note (§16.3)"
              rows={3}
              value={record.documentation.methodologyNote}
              onChange={(value) => setDoc({ methodologyNote: value })}
              placeholder="How the methodology was applied here, and how the options it offers were resolved. §16.3 asks for enough that the logic can be checked or replicated later."
            />
          </FullWidth>
          <FullWidth>
            <NoteField
              label="Distribution"
              rows={2}
              value={record.documentation.distribution}
              onChange={(value) => setDoc({ distribution: value })}
              placeholder="Who holds a controlled copy, and where the record is filed."
            />
          </FullWidth>
        </FieldGrid>
      </StepPanel>

      <StepPanel
        title="Issue and export"
        section="§16.2"
        blurb="The workbook carries a sheet per section of the practice — inputs, team, mechanisms, rules,
          result, plan, and what the assessment does not cover."
        actions={(
          <Button
            variant="secondary"
            size="sm"
            startIcon={<FiDownload />}
            disabled={!assessment}
            onClick={onExport}
          >
            Export workbook
          </Button>
        )}
      >
        {status === 'issued' ? (
          <>
            <Callout tone="success" title="This assessment is issued">
              It stays editable — §15.1.1 expects evergreening to continue — but the register records it as a
              signed document rather than a draft. Withdraw it if it needs substantive rework.
            </Callout>
            <div className="ds-row" style={{ marginTop: '0.75rem' }}>
              <Button variant="danger" size="sm" onClick={onWithdraw}>
                Withdraw to draft
              </Button>
            </div>
          </>
        ) : canIssue ? (
          <>
            <Callout tone="success" title="Every Appendix A shall-item is satisfied">
              {checklist.shouldTotal - checklist.shouldMet > 0
                ? `${checklist.shouldTotal - checklist.shouldMet} recommendation(s) remain outstanding. They do not block issue — API 580 distinguishes a "should" from a "shall" and so does this.`
                : 'Every recommendation is satisfied too.'}
            </Callout>
            <div className="ds-row" style={{ marginTop: '0.75rem' }}>
              <Button variant="primary" size="sm" startIcon={<FiCheck />} onClick={onIssue}>
                Issue assessment
              </Button>
            </div>
          </>
        ) : (
          <Callout
            tone="danger"
            title={`${checklist.blockers.length} shall-item(s) outstanding`}
          >
            The assessment cannot be issued until they are met. They are listed at the top of this step, each
            with a link to the field that answers it. The workbook can still be exported — a draft marked as a
            draft is a legitimate thing to circulate.
          </Callout>
        )}

        {assessment && (
          <StatGrid style={{ marginTop: '0.875rem' }}>
            <Stat label="Sections assessed" value={assessment.units.length} />
            <Stat
              label="At unacceptable risk"
              value={assessment.totals.byAcceptance.unacceptable}
              tone={assessment.totals.byAcceptance.unacceptable > 0 ? 'danger' : 'success'}
            />
            <Stat label="Assessed features" value={assessment.totals.features.toLocaleString()} />
            <Stat
              label="Earliest inspection due"
              value={assessment.totals.nextDueIso ?? '—'}
              hint="Counted from the inspection date the evidence carries."
            />
          </StatGrid>
        )}
      </StepPanel>

      {assessment && (
        <StepPanel
          title="What this assessment does not cover"
          section="§16.7"
          blurb="Carried onto the last sheet of the workbook. A risk report without its limits reads as a clean
            bill of health for threats it never looked at."
        >
          <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
            {assessment.provenance.limitations.map((limit) => (
              <li key={limit} className="rbi-check__hint" style={{ display: 'list-item' }}>{limit}</li>
            ))}
          </ul>
        </StepPanel>
      )}
    </>
  );
}
