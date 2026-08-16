/**
 * What every step is handed.
 *
 * `update` takes a function rather than a patch object so a nested change cannot
 * quietly drop its siblings. `assessment` is null until a filed assessment has
 * been attached and read — the probability has no evidence before that, and a
 * step that needs sections says so rather than rendering an empty table that
 * looks like a result.
 */

import type { RbiAssessment, RbiRecord } from '../../lib/rbi/types';

export interface StepProps {
  record: RbiRecord;
  update: (mutate: (record: RbiRecord) => RbiRecord) => void;
  assessment: RbiAssessment | null;
}
