/**
 * Step 7 — Risk determination and criteria (API 580 §12).
 *
 * Risk = probability × consequence, read off a documented matrix rather than
 * multiplied (§12.6.2). Two things this step insists on that a matrix alone does
 * not give you.
 *
 * The acceptance thresholds (§12.3, §12.7). A matrix without them ranks but does
 * not decide, and "which of these do we refuse to live with" is the operator's
 * call, not the tool's — so the four levels are mapped to acceptable, tolerable
 * (ALARP) or unacceptable by hand, and a scheme that accepts everything is
 * flagged, because it is not a threshold.
 *
 * The assumptions register (§12.6, §16.7). §16.7 makes it a shall: "these
 * assumptions shall be documented in the final report". Every assessment has
 * assumptions; an empty register means nobody wrote them down, not that there
 * were none.
 */

import { FiPlus } from 'react-icons/fi';

import { Badge, Button, Callout } from '../../../components/ds';
import { RISK_LEVELS } from '../../../lib/rbi/api580';
import { emptyAssumption } from '../../../lib/rbi/record';
import RiskMatrix, { RiskTag } from '../RiskMatrix';
import {
  EmptyState,
  FieldGrid,
  FullWidth,
  NoteField,
  PickField,
  RowCard,
  StepPanel,
  TextField,
} from '../RbiControls';
import type { StepProps } from '../stepProps';
import type { Option } from '../../../lib/rbi/catalogues';
import type { RbiAssumption, RiskAcceptance } from '../../../lib/rbi/types';

const ACCEPTANCE_OPTIONS: readonly Option<RiskAcceptance>[] = [
  { value: 'acceptable', label: 'Acceptable — no mitigation required' },
  { value: 'tolerable', label: 'Tolerable — ALARP, mitigate where practical' },
  { value: 'unacceptable', label: 'Unacceptable — mitigation required' },
];

const ACCEPTANCE_TONE: Record<RiskAcceptance, 'success' | 'warning' | 'danger'> = {
  acceptable: 'success',
  tolerable: 'warning',
  unacceptable: 'danger',
};

export default function StepRisk({ record, update, assessment }: StepProps) {
  const setRisk = (patch: Partial<typeof record.risk>) => {
    update((current) => ({ ...current, risk: { ...current.risk, ...patch } }));
  };
  const patchAssumption = (id: string, patch: Partial<RbiAssumption>) => {
    setRisk({
      assumptions: record.risk.assumptions.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    });
  };

  const acceptsEverything = !Object.values(record.risk.acceptance).includes('unacceptable');
  const unacceptable = assessment?.units.filter((unit) => unit.acceptance === 'unacceptable') ?? [];

  return (
    <>
      <StepPanel
        title="Risk matrix"
        section="§12.6.2"
        blurb="Probability up, consequence across, highest risk in the upper right. The number in a cell is how
          many sections of this line landed there."
      >
        {!assessment ? (
          <EmptyState>
            No filed FFS assessment is attached, so nothing can be placed on the matrix. Attach one from the
            assessment header.
          </EmptyState>
        ) : (
          <>
            <RiskMatrix units={assessment.units} />
            <Callout tone="info" title="This matrix is a decision, not an arithmetic result">
              The levels are written out rather than computed from the product of the two categories. The
              asymmetry is the decision: a consequence-5 section is never reported as low risk however
              unlikely failure is, which multiplying would have allowed.
            </Callout>
          </>
        )}
      </StepPanel>

      <StepPanel
        title="Risk acceptance criteria"
        section="§12.3 · §12.7"
        blurb="Which levels this operator will live with. §12.3.1 asks for corporate risk criteria to be applied
          where they exist; where they do not, setting them is itself a valid objective under §6.2.3."
      >
        <FieldGrid columns={2}>
          {RISK_LEVELS.map((level) => (
            <PickField
              key={level}
              label={<span className="ds-row"><RiskTag level={level} /></span>}
              value={record.risk.acceptance[level]}
              options={ACCEPTANCE_OPTIONS}
              onChange={(value) => setRisk({
                acceptance: { ...record.risk.acceptance, [level]: value },
              })}
            />
          ))}
          <FullWidth>
            <TextField
              label="Criteria source"
              hint="The corporate standard, regulation, or decision record these thresholds come from."
              value={record.risk.criteriaSource}
              onChange={(value) => setRisk({ criteriaSource: value })}
              placeholder="e.g. Corporate HSE risk matrix rev. 4, approved 2024"
            />
          </FullWidth>
        </FieldGrid>

        {acceptsEverything && (
          <Callout tone="warning" title="Nothing is unacceptable under these criteria">
            §12.7 asks for thresholds that divide the matrix into acceptable and unacceptable regions. A
            scheme where every level is acceptable or tolerable ranks the line but decides nothing, and the
            mitigation step will have nothing to act on.
          </Callout>
        )}

        {unacceptable.length > 0 && (
          <Callout
            tone="danger"
            title={`${unacceptable.length} section(s) at unacceptable risk`}
            meta={unacceptable.map((unit) => unit.label).join(', ')}
          >
            §13.3 makes these a shall: items with unacceptable risk shall be assessed for risk management
            through an inspection plan or another strategy. They are waiting on step 8.
          </Callout>
        )}
      </StepPanel>

      <StepPanel
        title="Assumptions register"
        section="§12.6 · §16.7 — a shall"
        blurb="“Risk assessment, by its very nature, requires that certain assumptions be made… these
          assumptions shall be documented in the final report.”"
        actions={(
          <Button
            variant="secondary"
            size="sm"
            startIcon={<FiPlus />}
            onClick={() => setRisk({ assumptions: [...record.risk.assumptions, emptyAssumption()] })}
          >
            Add assumption
          </Button>
        )}
      >
        {record.risk.assumptions.length === 0 && (
          <EmptyState>
            No assumptions recorded. Start with the ones this assessment has already made on your behalf: the
            growth rate behind the remaining life, the wall the corrosion-rate screen measures against, the
            population class along stretches nobody has surveyed, and the outage cost where none was entered.
          </EmptyState>
        )}

        {record.risk.assumptions.map((row, index) => (
          <RowCard
            key={row.id}
            title={row.assumption.trim() || `Assumption ${index + 1}`}
            removeLabel={`Remove assumption ${index + 1}`}
            onRemove={() => setRisk({
              assumptions: record.risk.assumptions.filter((item) => item.id !== row.id),
            })}
          >
            <FieldGrid columns={3}>
              <FullWidth>
                <TextField
                  label="Assumption"
                  value={row.assumption}
                  onChange={(value) => patchAssumption(row.id, { assumption: value })}
                />
              </FullWidth>
              <NoteField
                label="Basis"
                rows={2}
                value={row.basis}
                onChange={(value) => patchAssumption(row.id, { basis: value })}
                placeholder="Why this was assumed rather than measured."
              />
              <NoteField
                label="Impact if wrong"
                rows={2}
                hint="§12.5 warns against over-conservatism as much as under: inflated risk misleads planners
                  and costs the process its credibility."
                value={row.impactIfWrong}
                onChange={(value) => patchAssumption(row.id, { impactIfWrong: value })}
              />
            </FieldGrid>
          </RowCard>
        ))}
      </StepPanel>

      <StepPanel
        title="Sensitivity review"
        section="§12.4"
        blurb="Which inputs the answer actually turns on. §12.4 is direct about why it matters: the inputs that
          move the result are the ones worth gathering better data for."
      >
        <FieldGrid>
          <FullWidth>
            <NoteField
              label="Sensitivity note"
              rows={3}
              value={record.risk.sensitivityNote}
              onChange={(value) => setRisk({ sensitivityNote: value })}
              placeholder="e.g. The whole ranking turns on the assumed depth growth rate; a run pair would move six sections by a category. The population class at KP 30–40 has never been surveyed."
            />
          </FullWidth>
        </FieldGrid>

        {assessment && (
          <FieldGrid columns={3}>
            <div className="rbi-derived">
              <span className="rbi-derived__label">Sections on assumed growth</span>
              <span className="rbi-derived__value">
                {assessment.units.filter((unit) => unit.probability.growthAssumed).length}
              </span>
              <span className="rbi-derived__source">
                Their remaining life rests on a rate the source data did not report.
              </span>
            </div>
            <div className="rbi-derived">
              <span className="rbi-derived__label">Judged mechanisms</span>
              <span className="rbi-derived__value">
                {record.dmr.mechanisms.filter(
                  (row) => row.status !== 'ruled-out' && row.rateBasis !== 'measured-ili',
                ).length}
              </span>
              <span className="rbi-derived__source">
                Scored from susceptibility or a stated rate rather than measurement.
              </span>
            </div>
            <div className="rbi-derived">
              <span className="rbi-derived__label">Anomalies with no B31G result</span>
              <span className="rbi-derived__value">{assessment.totals.unassessed.toLocaleString()}</span>
              <span className="rbi-derived__source">
                Counted, grouped, and excluded from the measured probability.
              </span>
            </div>
          </FieldGrid>
        )}
      </StepPanel>

      {assessment && (
        <StepPanel
          title="Ranked sections"
          section="§12.7"
          blurb="The risk priority list §13.3 works from. Highest risk first."
        >
          <div className="ds-table-wrap">
            <table className="ds-table">
              <thead>
                <tr>
                  <th scope="col">Section</th>
                  <th scope="col">Extent</th>
                  <th scope="col">P</th>
                  <th scope="col">C</th>
                  <th scope="col">Risk</th>
                  <th scope="col">Acceptance</th>
                  <th scope="col">Governing mechanism</th>
                </tr>
              </thead>
              <tbody>
                {assessment.units.map((unit) => (
                  <tr key={unit.id}>
                    <th scope="row">{unit.label}</th>
                    <td className="ds-data">
                      {unit.fromM === null ? '—' : `${unit.fromM.toFixed(0)}`}
                      {' – '}
                      {unit.toM === null ? '—' : `${unit.toM.toFixed(0)} m`}
                    </td>
                    <td className="ds-data">{unit.probability.category}</td>
                    <td className="ds-data">{unit.consequence.category}</td>
                    <td><RiskTag level={unit.riskLevel} /></td>
                    <td><Badge tone={ACCEPTANCE_TONE[unit.acceptance]} pill>{unit.acceptance}</Badge></td>
                    <td>{unit.probability.governingMechanism ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </StepPanel>
      )}
    </>
  );
}
