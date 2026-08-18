import { FiCompass } from 'react-icons/fi';
import { Callout } from '../components/ds';

/**
 * What AURORA does with each wizard step's input.
 *
 * The wizard is deliberately the same for every strategy, but AURORA does not
 * read some of these steps the way the ordered matcher does — it registers its
 * own structure and derives its gates from tool uncertainty rather than from a
 * tolerance slider.  Leaving that unsaid would let an engineer tune a control
 * that has no effect and then trust the result because of it.
 */
const STEP_NOTES: Record<string, string> = {
  upload:
    'AURORA reads both runs as canonical evidence. Missing columns remove evidence rather '
    + 'than adding a penalty, so a run with no clock or no wall thickness still aligns on '
    + 'what it does report.',
  tiein:
    'A tie-in offset is applied before registration, but AURORA does not depend on it: local '
    + 'odometer drift is estimated joint by joint from the structural map.',
  summary:
    'The capability profile is computed from exactly these records — anchor coverage, clock '
    + 'coverage, reporting density and tool comparability — and it is what selects the '
    + 'operating mode.',
  gw:
    'AURORA registers girth welds itself, as an order-preserving sequence with explicit gaps '
    + 'and insertions. Locks you confirm here are carried as operator-defined anchors; they do '
    + 'not replace the structural map, and a missing weld becomes a gap rather than shifting '
    + 'every joint number after it.',
  sections:
    'Sections scope the report. AURORA’s own matching corridor is the persistent physical '
    + 'joint, which is derived from the structural map rather than from these boundaries.',
  features:
    'Visibility rules apply to the report. Whether clustered metal loss is matched at all is set '
    + 'on the Tolerances step, and AURORA honours that decision like every other strategy.',
  scenario:
    'These tolerances are recorded with the session but do not gate AURORA. Its candidate gate '
    + 'is a Mahalanobis distance built from each tool’s stated or default uncertainty, applied '
    + 'to residuals measured after the local transform. The clustered metal loss setting below '
    + 'is not a gate and does apply: it decides what AURORA is given to match.',
  exec:
    'Structure first, then coordinates, then correspondence. Where direct matching collapses '
    + 'inside a well-registered corridor, Pattern Rescue estimates the local transform instead '
    + 'of widening the tolerance.',
};

interface AuroraStepNoteProps {
  stepId: string | undefined;
}

export default function AuroraStepNote({ stepId }: AuroraStepNoteProps) {
  const note = stepId ? STEP_NOTES[stepId] : undefined;
  if (!note) return null;
  return (
    <Callout
      tone="info"
      icon={<FiCompass aria-hidden="true" />}
      title="AURORA-ILI universal registration"
    >
      {note}
    </Callout>
  );
}
