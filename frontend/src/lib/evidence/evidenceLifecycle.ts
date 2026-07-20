export type EvidenceStatus = 'required' | 'requested' | 'submitted' | 'reviewed' | 'accepted' | 'rejected' | 'superseded';
export interface EvidenceRecord {
  id: string;
  status: EvidenceStatus;
  history: { from: EvidenceStatus; to: EvidenceStatus; actorId: string; at: string }[];
}

const transitions: Record<EvidenceStatus, EvidenceStatus[]> = {
  required: ['requested', 'superseded'],
  requested: ['submitted', 'superseded'],
  submitted: ['reviewed', 'rejected', 'superseded'],
  reviewed: ['accepted', 'rejected', 'superseded'],
  accepted: ['superseded'],
  rejected: ['requested', 'superseded'],
  superseded: [],
};

export function transitionEvidence(record: EvidenceRecord, next: EvidenceStatus, actorId: string, at = new Date().toISOString()): EvidenceRecord {
  if (!record.id || !actorId) throw new Error('evidence id and actor are required');
  if (record.status === 'superseded') throw new Error('superseded evidence is final');
  if (next === 'accepted' && record.status !== 'reviewed') {
    throw new Error(`invalid evidence transition ${record.status} → accepted: evidence must be reviewed first`);
  }
  if (!transitions[record.status].includes(next)) throw new Error(`invalid evidence transition ${record.status} → ${next}`);
  if (!Number.isFinite(Date.parse(at))) throw new Error('evidence event date is invalid');
  return { ...record, status: next, history: [...record.history, { from: record.status, to: next, actorId, at }] };
}
