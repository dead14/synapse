/**
 * API 580 Appendix A, evaluated against the document in front of you.
 *
 * Appendix A is the practice's own checklist for creating an RBI programme — the
 * "shall"-type requirements and "should"-type recommendations gathered in one
 * place. This module walks the authored record against it and reports what is
 * still missing, so that "complete" means something a third party would accept
 * rather than "every step was visited".
 *
 * Two deliberate choices. First, `shall` and `should` are kept apart, because
 * the practice keeps them apart and treating a recommendation as a blocker would
 * teach engineers to fill fields to make a warning go away. Only unmet `shall`
 * items prevent an assessment from being issued. Second, no item is satisfied by
 * the mere presence of text: where the practice asks for a decision, the check
 * looks for the decision — a ruled-out mechanism needs its reason, an IOW needs
 * its action, an override needs why.
 */

import { CORROSION_SPECIALIST_ROLE } from './catalogues.ts';
import type { RbiRecord, RbiStepId } from './types.ts';

export type ChecklistLevel = 'shall' | 'should';

export interface ChecklistItem {
  id: string;
  /** Where in API 580 the requirement comes from. */
  section: string;
  requirement: string;
  level: ChecklistLevel;
  /** The step that satisfies it, so an unmet item is one click from its field. */
  step: RbiStepId;
  satisfied: boolean;
  /** What to do about it, when it is not satisfied. */
  remedy: string;
}

export interface ChecklistResult {
  items: ChecklistItem[];
  shallTotal: number;
  shallMet: number;
  shouldTotal: number;
  shouldMet: number;
  /** Unmet `shall` items. An assessment with any of these cannot be issued. */
  blockers: ChecklistItem[];
}

function filled(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function present(value: number | null | undefined): boolean {
  return value !== null && value !== undefined && Number.isFinite(value);
}

export function evaluateChecklist(record: RbiRecord): ChecklistResult {
  const mechanisms = record.dmr.mechanisms;
  const credible = mechanisms.filter((row) => row.status !== 'ruled-out');
  const ruledOut = mechanisms.filter((row) => row.status === 'ruled-out');

  const items: ChecklistItem[] = [
    /* ── Work process and management system (§16.1, §16.2) ─────────────────── */
    {
      id: 'scope-boundaries',
      section: '§6.3.2 · §16.4',
      requirement: 'The physical boundary of the assessment is stated.',
      level: 'shall',
      step: 'planning',
      satisfied: filled(record.planning.facility) || filled(record.planning.processUnit)
        || filled(record.planning.system),
      remedy: 'Name the facility, process unit, or system this assessment covers.',
    },
    {
      id: 'scope-inclusion',
      section: '§16.4',
      requirement: 'Both the equipment covered and the equipment not covered are documented.',
      level: 'shall',
      step: 'planning',
      satisfied: record.planning.includedEquipment.length > 0
        && record.planning.excludedEquipment.length > 0,
      remedy: '§16.4 asks for both lists. An empty exclusion list reads as "everything is covered", which is '
        + 'almost never what was meant.',
    },
    {
      id: 'scope-rationale',
      section: '§16.4',
      requirement: 'The reasoning behind the inclusion and exclusion list is recorded.',
      level: 'shall',
      step: 'planning',
      satisfied: filled(record.planning.scopeRationale),
      remedy: 'State why these classes are in scope and the others are not.',
    },
    {
      id: 'objectives',
      section: '§6.2',
      requirement: 'The objectives and goals of the assessment are defined.',
      level: 'should',
      step: 'planning',
      satisfied: record.planning.objectives.length > 0,
      remedy: 'Select at least one objective; §6.7 a makes clear objectives the first key to success.',
    },
    {
      id: 'operating-boundary',
      section: '§6.4',
      requirement: 'Operating boundaries are established, including start-up, shutdown, upset and cyclic '
        + 'conditions.',
      level: 'shall',
      step: 'planning',
      satisfied: record.planning.operating.startupShutdownConsidered
        && record.planning.operating.upsetConsidered
        && record.planning.operating.cyclicConsidered,
      remedy: '§6.4.2 makes start-up and shutdown conditions a "shall" for every item covered. Confirm each '
        + 'was considered and record what was concluded — including "not applicable, and here is why".',
    },
    {
      id: 'timeframe',
      section: '§16.6',
      requirement: 'The timeframe over which the assessment is applicable is defined.',
      level: 'shall',
      step: 'planning',
      satisfied: filled(record.planning.timeframeFromIso) && filled(record.planning.timeframeToIso),
      remedy: 'Set the window the assessment speaks for. Risk is a function of time; an assessment without '
        + 'an expiry cannot be managed over one.',
    },
    {
      id: 'codes',
      section: '§16.11',
      requirement: 'The applicable in-service codes and standards are referenced.',
      level: 'should',
      step: 'planning',
      satisfied: record.planning.codes.length > 0,
      remedy: 'Particularly important where RBI is used to reduce the extent or frequency of inspection.',
    },

    /* ── Team (§7, §16.5) ───────────────────────────────────────────────────── */
    {
      id: 'team-recorded',
      section: '§16.5',
      requirement: 'The team members and the skill set each brought are recorded.',
      level: 'should',
      step: 'team',
      satisfied: record.team.length > 0 && record.team.every((member) => filled(member.name)
        && filled(member.role)),
      remedy: 'Record who performed the assessment. §16.5 wants this understood when the analysis is '
        + 'repeated or updated by someone else.',
    },
    {
      id: 'corrosion-specialist',
      section: '§9.1',
      requirement: 'A corrosion specialist was consulted to define the damage mechanisms.',
      level: 'shall',
      step: 'team',
      satisfied: record.team.some((member) => member.role === CORROSION_SPECIALIST_ROLE
        && filled(member.name)),
      remedy: 'This is one of Appendix A\'s explicit "shall" items: "The RBI team shall consult with a '
        + 'corrosion specialist to define the equipment damage mechanisms."',
    },

    /* ── Data (§8) ──────────────────────────────────────────────────────────── */
    {
      id: 'data-sources',
      section: '§8.5',
      requirement: 'The sources of site-specific data are identified.',
      level: 'should',
      step: 'data',
      satisfied: record.data.sources.length > 0,
      remedy: 'Record which records were consulted and what state they were in.',
    },
    {
      id: 'data-validated',
      section: '§8.3',
      requirement: 'Data inputs and assumptions were validated by qualified personnel.',
      level: 'shall',
      step: 'data',
      satisfied: filled(record.data.validatedBy) && filled(record.data.validatedOnIso),
      remedy: '§8.3 names this a "shall" and names the reviewer: a process engineer or operator who has '
        + 'checked the operating parameters used.',
    },
    {
      id: 'equipment-data',
      section: '§8.2.1 · §9.1 a',
      requirement: 'Equipment design data and materials of construction are recorded.',
      level: 'shall',
      step: 'data',
      satisfied: present(record.data.equipment.outerDiameterMm)
        && present(record.data.equipment.nominalWallMm)
        && filled(record.data.equipment.material),
      remedy: 'Diameter, wall and material at minimum — the damage mechanism review cannot be done without '
        + 'them.',
    },
    {
      id: 'process-conditions',
      section: '§9.1 b',
      requirement: 'Process conditions are recorded, including trace constituents in ppm.',
      level: 'shall',
      step: 'data',
      satisfied: filled(record.data.process.composition)
        || present(record.data.process.h2sPpm)
        || present(record.data.process.co2Pct)
        || present(record.data.process.chloridesPpm),
      remedy: '§9.1 b singles trace species out: they "can have a significant effect on the damage '
        + 'mechanisms". Record H₂S, CO₂ or chlorides — or state in the composition note that none are present.',
    },

    /* ── Damage mechanism review (§9) ───────────────────────────────────────── */
    {
      id: 'dmr-exists',
      section: '§9.1',
      requirement: 'A list of credible damage mechanisms has been developed.',
      level: 'shall',
      step: 'dmr',
      satisfied: credible.length > 0,
      remedy: 'Add the mechanisms the corrosion specialist considers credible for this line.',
    },
    {
      id: 'dmr-evidence',
      section: '§9.3 · §16.7',
      requirement: 'Each credible mechanism carries the evidence and the rate or susceptibility behind it.',
      level: 'shall',
      step: 'dmr',
      satisfied: credible.length > 0 && credible.every((row) => filled(row.basis)
        && (row.rateBasis === 'measured-ili'
          || row.rateBasis === 'susceptibility'
          || present(row.rateMmPerYear))),
      remedy: '§9.3 asks for the rate where it can be determined and the susceptibility where it cannot, '
        + 'and §16.7 c asks for the criteria used to judge severity. A category with no stated basis cannot '
        + 'be checked by anyone else.',
    },
    {
      id: 'dmr-ruled-out',
      section: '§9.5 b',
      requirement: 'Mechanisms ruled out carry the reason they were ruled out.',
      level: 'shall',
      step: 'dmr',
      satisfied: ruledOut.every((row) => filled(row.ruledOutReason)),
      remedy: 'Ruling out a mechanism is a finding. Record why, so the next reassessment can re-test it.',
    },
    {
      id: 'dmr-failure-modes',
      section: '§9.5 f · §16.7 d',
      requirement: 'A failure mode is defined for each damage mechanism.',
      level: 'shall',
      step: 'dmr',
      satisfied: credible.length > 0 && credible.every((row) => filled(row.damageMode)),
      remedy: 'The anticipated failure mode — leak, crack, rupture — decides which consequence is credible.',
    },
    {
      id: 'iows',
      section: '§9.4 · §14.8',
      requirement: 'Integrity operating windows are identified, with the action on exceedance.',
      level: 'should',
      step: 'dmr',
      satisfied: record.dmr.iows.length > 0
        && record.dmr.iows.every((row) => filled(row.parameter) && filled(row.actionOnExceedance)),
      remedy: 'An IOW with no action is an alarm with nobody assigned to it — and §16.1 i makes an exceedance '
        + 'a reassessment trigger.',
    },
    {
      id: 'other-causes',
      section: '§10.1',
      requirement: 'Causes of loss of containment outside the damage mechanisms were considered.',
      level: 'should',
      step: 'dmr',
      satisfied: record.dmr.otherCauses.length > 0 || filled(record.dmr.otherCausesNote),
      remedy: 'Seismic, weather, overpressure, operator error, wrong material, design error, sabotage. '
        + 'Recording them as considered is what stops the assessment implying it covered them.',
    },

    /* ── POF (§10) ──────────────────────────────────────────────────────────── */
    {
      id: 'pof-effectiveness',
      section: '§10.4.2',
      requirement: 'Past inspections were evaluated for their effectiveness against each mechanism.',
      level: 'shall',
      step: 'pof',
      satisfied: credible.length > 0 && credible.every((row) => row.rateBasis === 'measured-ili'
        || row.effectiveness !== 'none'
        || filled(row.basis)),
      remedy: 'Appendix A: "Inspections shall be evaluated to determine the effectiveness in finding the '
        + 'identified mechanisms." Where there has been no inspection, say so — that is an answer, and it '
        + 'raises the probability rather than leaving it blank.',
    },
    {
      id: 'pof-methods',
      section: '§10.4.2 d',
      requirement: 'The NDE method and coverage behind each effectiveness rating are recorded.',
      level: 'should',
      step: 'pof',
      satisfied: credible.filter((row) => row.effectiveness !== 'none')
        .every((row) => filled(row.inspectionMethod)),
      remedy: 'Effectiveness is a function of the technique and the extent of coverage; a letter grade '
        + 'without either cannot be reviewed.',
    },

    /* ── COF (§11) ──────────────────────────────────────────────────────────── */
    {
      id: 'cof-safety',
      section: '§11.5',
      requirement: 'Flammable, toxic and other hazardous release effects were considered.',
      level: 'shall',
      step: 'cof',
      satisfied: record.consequence.flammable || record.consequence.toxicRelease
        || filled(record.consequence.basisNote),
      remedy: '§11.5.1 makes flammable events, toxic releases and other hazardous fluids the major factors '
        + 'that "shall" be considered. Where none applies, say so in the basis note.',
    },
    {
      id: 'cof-environmental',
      section: '§11.5.5',
      requirement: 'The environmental consequence and its containment are assessed.',
      level: 'should',
      step: 'cof',
      satisfied: record.consequence.environmentReceptor !== 'none'
        || filled(record.consequence.basisNote),
      remedy: 'Name the receptor at risk, or state that there is none.',
    },
    {
      id: 'cof-production',
      section: '§11.5.6',
      requirement: 'The production (business interruption) consequence is estimated.',
      level: 'should',
      step: 'cof',
      satisfied: present(record.consequence.dailyUnitValueUsd)
        && present(record.consequence.downtimeDays),
      remedy: 'Daily unit value × downtime days. Without it this component is scored from redundancy alone, '
        + 'which the assessment reports as the weaker basis it is.',
    },
    {
      id: 'cof-inventory',
      section: '§11.4',
      requirement: 'The volume available for release, and the detection and isolation that bound it, are '
        + 'recorded.',
      level: 'should',
      step: 'data',
      satisfied: present(record.data.inventory.volumeM3)
        && filled(record.data.inventory.isolationDescription),
      remedy: '§11.4: the released volume is the fluid between isolation valves that can be quickly closed.',
    },

    /* ── Risk (§12) ─────────────────────────────────────────────────────────── */
    {
      id: 'risk-criteria',
      section: '§12.3.1 · §12.7',
      requirement: 'Risk acceptance criteria are set.',
      level: 'shall',
      step: 'risk',
      satisfied: Object.values(record.risk.acceptance).some((value) => value === 'unacceptable'),
      remedy: 'A threshold that accepts everything is not a threshold. §12.7 asks for the plot to be divided '
        + 'into acceptable and unacceptable regions.',
    },
    {
      id: 'risk-assumptions',
      section: '§12.6 · §16.7',
      requirement: 'The assumptions made to assess risk are documented.',
      level: 'shall',
      step: 'risk',
      satisfied: record.risk.assumptions.length > 0
        && record.risk.assumptions.every((row) => filled(row.assumption) && filled(row.basis)),
      remedy: '§16.7 makes this a "shall": "these assumptions shall be documented in the final report". '
        + 'Every assessment has them; an empty register means they were not written down, not that there '
        + 'were none.',
    },
    {
      id: 'risk-sensitivity',
      section: '§12.4',
      requirement: 'A sensitivity review identifies which inputs the result actually turns on.',
      level: 'should',
      step: 'risk',
      satisfied: filled(record.risk.sensitivityNote),
      remedy: 'Name the inputs that would change the answer, so the next data-gathering effort goes there.',
    },

    /* ── Inspection planning and mitigation (§13, §14, §16.8) ───────────────── */
    {
      id: 'plan-technique',
      section: '§12.3.2 · §13.2.2',
      requirement: 'The plan states what to inspect, how, where and how much — not only when.',
      level: 'shall',
      step: 'plan',
      satisfied: record.unitPlans.length > 0
        && record.unitPlans.some((row) => filled(row.technique)),
      remedy: 'An interval on its own is not an inspection plan. §13.4 is blunt about the failure mode: '
        + 'spot thickness readings against localised corrosion "would be considered to have little or no '
        + 'benefit".',
    },
    {
      id: 'plan-mitigation',
      section: '§13.1 · §16.9',
      requirement: 'Units at unacceptable risk carry a mitigation strategy and an owner.',
      level: 'shall',
      step: 'plan',
      satisfied: record.unitPlans.filter((row) => row.strategy !== 'none')
        .every((row) => filled(row.owner) && filled(row.targetDateIso)),
      remedy: '§16.9 asks for the mitigation, the credit assigned to it, and the person responsible for '
        + 'implementing it.',
    },
    {
      id: 'plan-residual',
      section: '§16.2 i',
      requirement: 'Residual risk after mitigation is recorded where mitigation is planned.',
      level: 'should',
      step: 'plan',
      satisfied: record.unitPlans.filter((row) => row.strategy !== 'none')
        .every((row) => row.residualRiskLevel !== null),
      remedy: 'The point of a mitigation is the risk it leaves behind. State it; this product will not '
        + 'calculate it for you.',
    },
    {
      id: 'plan-override-reason',
      section: '§16.7',
      requirement: 'An interval set against the derived one carries its reason.',
      level: 'shall',
      step: 'plan',
      satisfied: record.unitPlans.filter((row) => row.overrideIntervalYears !== null)
        .every((row) => filled(row.overrideReason)),
      remedy: 'Overriding a derived interval is an engineering decision. §16.7 requires the deviation and '
        + 'its basis to be documented.',
    },

    /* ── Evergreening (§15) ─────────────────────────────────────────────────── */
    {
      id: 'reassessment-triggers',
      section: '§15.2 · §16.1 i',
      requirement: 'The events that trigger a reassessment are defined.',
      level: 'shall',
      step: 'evergreen',
      satisfied: record.evergreening.triggers.length > 0,
      remedy: '§15.2.1: "The facility shall have an effective work process that identifies when a '
        + 'reassessment is necessary."',
    },
    {
      id: 'reassessment-date',
      section: '§15.3.2 · §16.1 j',
      requirement: 'A maximum period between reassessments is set.',
      level: 'shall',
      step: 'evergreen',
      satisfied: present(record.evergreening.reassessmentIntervalYears)
        && filled(record.evergreening.nextReassessmentIso),
      remedy: 'API 510 and API 570 cap reassessment at ten years; a stricter jurisdictional requirement '
        + 'takes precedence.',
    },
    {
      id: 'evergreen-owner',
      section: '§15.1.1',
      requirement: 'Someone owns keeping the assessment current between reassessments.',
      level: 'should',
      step: 'evergreen',
      satisfied: filled(record.evergreening.evergreenOwner),
      remedy: 'Evergreening is continuous. Without a named owner it does not happen.',
    },

    /* ── Documentation (§16) ────────────────────────────────────────────────── */
    {
      id: 'doc-methodology',
      section: '§16.3',
      requirement: 'How the methodology was applied at this site is documented.',
      level: 'shall',
      step: 'documentation',
      satisfied: filled(record.documentation.methodologyNote),
      remedy: '§16.3 asks for enough that "the basis and the logic for the decision-making process can be '
        + 'checked or replicated at a later time".',
    },
    {
      id: 'doc-signoff',
      section: '§16.5 · §16.8',
      requirement: 'The assessment is signed off by the person who made it and the person who reviewed it.',
      level: 'shall',
      step: 'documentation',
      satisfied: filled(record.documentation.assessedBy) && filled(record.documentation.assessedOnIso)
        && filled(record.documentation.reviewedBy) && filled(record.documentation.reviewedOnIso),
      remedy: 'An unsigned risk assessment is a draft, whatever it says on the cover.',
    },
    {
      id: 'doc-evidence',
      section: '§16.2 e',
      requirement: 'The assessment cites the inspection evidence its probability rests on.',
      level: 'shall',
      step: 'planning',
      satisfied: record.ffsSessionId !== null,
      remedy: 'Attach the filed FFS assessment. Without it the probability side is opinion, which is exactly '
        + 'what this product exists not to produce.',
    },
  ];

  const shall = items.filter((item) => item.level === 'shall');
  const should = items.filter((item) => item.level === 'should');

  return {
    items,
    shallTotal: shall.length,
    shallMet: shall.filter((item) => item.satisfied).length,
    shouldTotal: should.length,
    shouldMet: should.filter((item) => item.satisfied).length,
    blockers: shall.filter((item) => !item.satisfied),
  };
}

/** Unmet items belonging to one step, for the badge on the stepper. */
export function unmetForStep(result: ChecklistResult, step: RbiStepId): ChecklistItem[] {
  return result.items.filter((item) => item.step === step && !item.satisfied);
}
