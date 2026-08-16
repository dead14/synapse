/**
 * The blank assessment, what the filed evidence fills in, and when it is ready.
 *
 * One rule governs the defaults: a blank field stays blank, and a threat starts
 * unreviewed. Pre-filling an unknown with a plausible value is the most damaging
 * thing a risk tool can do, because a silent default is an assumption nobody
 * knows was made. The exception is the geometry the release scale is computed
 * from, which is read from the filed assessment rather than typed — a number
 * transcribed by hand from another screen is a number with an extra way to be
 * wrong.
 */

import type { RevivedFfsShareState } from '../ffs/shareState.ts';
import type { FfsScreenedResult } from '../ffs/types.ts';
import { THREATS, threatLabel } from './catalogues.ts';
import type {
  RbiRecord,
  RbiStepId,
  SectionOverride,
  ThreatAssessment,
} from './types.ts';

export const RBI_STEPS: readonly { id: RbiStepId; label: string; blurb: string }[] = [
  {
    id: 'line',
    label: 'Line and evidence',
    blurb: 'Which line, what it carries, and the filed assessment the measured damage comes from.',
  },
  {
    id: 'threats',
    label: 'Threats',
    blurb: 'The eight pipeline threat categories. Two are measured for you; review the other six.',
  },
  {
    id: 'consequence',
    label: 'Consequence',
    blurb: 'Who and what a release would reach. Override the sections where that changes.',
  },
  {
    id: 'result',
    label: 'Result',
    blurb: 'The ranking, the intervals, and the report.',
  },
];

/** Today, as the calendar date the rest of the workspace uses. */
export function todayIso(): string {
  const now = new Date();
  return [
    String(now.getFullYear()).padStart(4, '0'),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
}

/** Every threat, unreviewed. The threat list is fixed, so rows are never added. */
function blankThreats(): ThreatAssessment[] {
  return THREATS.map((threat) => ({
    id: threat.id,
    // The two an in-line metal-loss run measures are answered by the evidence
    // itself, so they start active rather than unreviewed — features were found,
    // sized and assessed. Marking them merely credible would understate a threat
    // the operator has measurement of.
    relevance: threat.measured ? 'active' : 'unreviewed',
    coverage: threat.measured ? 'covered' : 'none',
    note: threat.measured
      ? 'Measured by the in-line inspection this assessment reads, and assessed to B31G.'
      : '',
  }));
}

export function emptyRbiRecord(): RbiRecord {
  return {
    version: 2,
    title: '',
    ffsSessionId: null,
    segment: '',
    fluid: 'crude-oil',
    toxic: false,
    threats: blankThreats(),
    population: 'rural',
    environment: 'soil',
    businessImpact: 'moderate',
    overrides: [],
    maxIntervalYears: null,
    assessedBy: '',
    assessedOnIso: '',
    notes: '',
  };
}

export function emptyOverride(sectionId: string): SectionOverride {
  return { sectionId, population: null, environment: null, note: '' };
}

/* ── Seeding from the filed assessment ─────────────────────────────────────── */

export interface FfsSeed {
  ffsSessionId: string;
  state: RevivedFfsShareState;
  screened: FfsScreenedResult[];
}

/**
 * Fill in what the filed assessment already knows.
 *
 * Only writes into fields the engineer left empty, so re-attaching a corrected
 * assessment cannot silently overwrite something typed deliberately.
 */
export function seedRecordFromFfs(record: RbiRecord, seed: FfsSeed): RbiRecord {
  return {
    ...record,
    ffsSessionId: seed.ffsSessionId,
    title: record.title.trim() || `${seed.state.config.lineName} — RBI screening`,
    segment: record.segment.trim() || seed.state.config.lineName,
  };
}

/**
 * Bring a stored assessment forward.
 *
 * A record saved before a field existed comes back missing it, and a missing
 * field renders as undefined in an input and throws on the first keystroke.
 * Merging over a blank record is what keeps an assessment written months ago
 * openable.
 */
export function reviveRbiRecord(stored: unknown): RbiRecord {
  const blank = emptyRbiRecord();
  if (typeof stored !== 'object' || stored === null) return blank;
  const input = stored as Partial<RbiRecord>;

  // The threat list is fixed by the code, not by the stored document: a threat
  // added to the catalogue must appear on an existing assessment as unreviewed
  // rather than silently missing from its probability.
  const storedThreats = Array.isArray(input.threats) ? input.threats : [];
  const threats = blank.threats.map((fallback) => {
    const match = storedThreats.find((item) => item?.id === fallback.id);
    return match ? { ...fallback, ...match } : fallback;
  });

  return {
    ...blank,
    ...input,
    version: 2,
    threats,
    overrides: Array.isArray(input.overrides) ? input.overrides : [],
  };
}

/* ── Readiness ─────────────────────────────────────────────────────────────── */

export interface ReadinessItem {
  id: string;
  requirement: string;
  satisfied: boolean;
  step: RbiStepId;
}

/**
 * The four things this assessment will not be issued without.
 *
 * Deliberately four. A screening assessment that demands twenty answers before
 * it will produce a number is not a screening assessment, and a checklist long
 * enough to be ignored is worse than none. These are the ones where proceeding
 * without an answer would make the output misleading rather than incomplete.
 */
export function readiness(record: RbiRecord): ReadinessItem[] {
  const unreviewed = record.threats.filter((threat) => threat.relevance === 'unreviewed');
  const ruledOutWithoutReason = record.threats.filter(
    (threat) => threat.relevance === 'not-credible' && threat.note.trim() === '',
  );

  return [
    {
      id: 'evidence',
      requirement: 'A filed fitness-for-service assessment is attached',
      satisfied: record.ffsSessionId !== null,
      step: 'line',
    },
    {
      id: 'threats-reviewed',
      requirement: unreviewed.length === 0
        ? 'Every threat has been reviewed'
        : `${unreviewed.length} threat(s) still unreviewed: ${unreviewed.map((threat) => threatLabel(threat.id)).join(', ')}`,
      satisfied: unreviewed.length === 0,
      step: 'threats',
    },
    {
      id: 'ruled-out-reason',
      requirement: ruledOutWithoutReason.length === 0
        ? 'Threats ruled out carry the reason why'
        : `${ruledOutWithoutReason.map((threat) => threatLabel(threat.id)).join(', ')} ruled out with no reason`,
      satisfied: ruledOutWithoutReason.length === 0,
      step: 'threats',
    },
    {
      id: 'signed',
      requirement: 'The assessment is signed and dated',
      satisfied: record.assessedBy.trim() !== '' && record.assessedOnIso.trim() !== '',
      step: 'result',
    },
  ];
}

export function outstandingFor(record: RbiRecord, step: RbiStepId): number {
  return readiness(record).filter((item) => !item.satisfied && item.step === step).length;
}
