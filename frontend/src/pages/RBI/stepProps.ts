/**
 * What every step of the wizard is handed.
 *
 * One shape for all ten so a step can be moved, split, or reordered without
 * rewiring the shell. `update` takes a function rather than a patch object
 * because the record is nested five levels deep in places and a shallow merge at
 * the top would quietly drop siblings.
 *
 * `assessment` is null until a filed FFS case has been attached and read: the
 * probability side has no evidence before that, and a step that needs derived
 * units says so rather than rendering an empty table that looks like a result.
 */

import type { ChecklistResult } from '../../lib/rbi/checklist';
import type { RbiAssessment, RbiRecord } from '../../lib/rbi/types';

export interface StepProps {
  record: RbiRecord;
  update: (mutate: (record: RbiRecord) => RbiRecord) => void;
  assessment: RbiAssessment | null;
  checklist: ChecklistResult;
}
