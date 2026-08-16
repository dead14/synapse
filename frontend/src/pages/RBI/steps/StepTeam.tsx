/**
 * Step 2 — Team, roles and qualifications (API 580 §7, §16.5).
 *
 * §16.5 wants the team on the record so that "the basis for the risk assessment"
 * is understandable "when the analysis is repeated or updated". Appendix A turns
 * one of those roles into a requirement: the team *shall* consult a corrosion
 * specialist to define the damage mechanisms. That is checked here rather than
 * left to a reviewer's memory, because the next step is the damage mechanism
 * review and the specialist is the person who is supposed to be doing it.
 */

import { FiPlus, FiUserCheck } from 'react-icons/fi';

import { Button, Callout } from '../../../components/ds';
import { CORROSION_SPECIALIST_ROLE, TEAM_ROLES } from '../../../lib/rbi/catalogues';
import { emptyTeamMember } from '../../../lib/rbi/record';
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
import type { RbiTeamMember } from '../../../lib/rbi/types';

export default function StepTeam({ record, update }: StepProps) {
  const setTeam = (team: RbiTeamMember[]) => update((current) => ({ ...current, team }));
  const patchMember = (id: string, patch: Partial<RbiTeamMember>) => {
    setTeam(record.team.map((member) => (member.id === id ? { ...member, ...patch } : member)));
  };

  const specialist = record.team.find(
    (member) => member.role === CORROSION_SPECIALIST_ROLE && member.name.trim() !== '',
  );

  return (
    <>
      <StepPanel
        title="Assessment team"
        section="§7 · §16.5"
        blurb="Who made this assessment, and what each of them brought to it."
        actions={(
          <Button
            variant="secondary"
            size="sm"
            startIcon={<FiPlus />}
            onClick={() => setTeam([...record.team, emptyTeamMember()])}
          >
            Add member
          </Button>
        )}
      >
        {record.team.length === 0 && (
          <EmptyState>
            No team members recorded. §16.5 asks for a record of who performed the assessment and the skill
            set they brought — without it, nobody repeating this work in five years can judge how much weight
            to give its judgements.
          </EmptyState>
        )}

        {record.team.map((member, index) => (
          <RowCard
            key={member.id}
            title={member.name.trim() || `Member ${index + 1}`}
            removeLabel={`Remove ${member.name.trim() || `member ${index + 1}`}`}
            onRemove={() => setTeam(record.team.filter((item) => item.id !== member.id))}
          >
            <FieldGrid columns={2}>
              <TextField
                label="Name"
                value={member.name}
                onChange={(value) => patchMember(member.id, { name: value })}
              />
              <PickField
                label="Role (§7.2)"
                value={member.role}
                placeholder="Select a role"
                options={TEAM_ROLES}
                onChange={(value) => patchMember(member.id, { role: value })}
              />
              <TextField
                label="Organization"
                value={member.organization}
                onChange={(value) => patchMember(member.id, { organization: value })}
                placeholder="Operator, contractor, vendor"
              />
              <TextField
                label="Qualification and experience"
                hint="§7.3 — what makes this person competent for the role, not their job title."
                value={member.qualification}
                onChange={(value) => patchMember(member.id, { qualification: value })}
                placeholder="e.g. NACE CP4, 12 years pipeline integrity"
              />
            </FieldGrid>
          </RowCard>
        ))}
      </StepPanel>

      <StepPanel
        title="Corrosion specialist"
        section="§9.1 — a shall"
        blurb="Appendix A states it plainly: the RBI team shall consult with a corrosion specialist to define
          the equipment damage mechanisms, damage modes, and potential failure modes."
      >
        {specialist ? (
          <Callout tone="success" icon={<FiUserCheck />} title="Corrosion specialist on the team">
            {specialist.name}
            {specialist.organization.trim() ? ` — ${specialist.organization}` : ''}
            {specialist.qualification.trim() ? `. ${specialist.qualification}` : ''}
          </Callout>
        ) : (
          <Callout tone="danger" title="No corrosion specialist recorded">
            The damage mechanism review on the next step is theirs to make. §9.1 makes this a shall and
            §15.2.4 repeats it: a qualified corrosion specialist shall be responsible for assessing the types
            of damage mechanisms and their applicability and severity. Add one above with the corrosion
            specialist role.
          </Callout>
        )}

        <FieldGrid>
          <FullWidth>
            <TextField
              label="Name as it appears on the damage mechanism review"
              hint="Carried onto the DMR sheet of the exported workbook."
              value={record.dmr.corrosionSpecialist}
              onChange={(value) => update((current) => ({
                ...current,
                dmr: { ...current.dmr, corrosionSpecialist: value },
              }))}
            />
          </FullWidth>
          <FullWidth>
            <NoteField
              label="Methodology note (§16.3)"
              hint="How the selected methodology is applied at this site — how the options it offers were
                resolved. §16.3 asks for enough that the logic can be replicated later."
              value={record.documentation.methodologyNote}
              onChange={(value) => update((current) => ({
                ...current,
                documentation: { ...current.documentation, methodologyNote: value },
              }))}
            />
          </FullWidth>
        </FieldGrid>
      </StepPanel>
    </>
  );
}
