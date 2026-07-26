export function reconcileFieldPackage(input: {
  packageId: string;
  baseRevision: number;
  localRevision: number;
  serverRevision: number;
  pendingEvidence: number;
}) {
  for (const [field, value] of Object.entries(input)) {
    if (field !== 'packageId' && (!Number.isSafeInteger(value) || Number(value) < 0)) throw new Error(`${field} must be a non-negative integer`);
  }
  if (!input.packageId) throw new Error('packageId is required');
  const localChanged = input.localRevision > input.baseRevision;
  const serverChanged = input.serverRevision > input.baseRevision;
  if (localChanged && serverChanged && input.localRevision !== input.serverRevision) {
    return { status: 'conflict' as const, canAutoMerge: false, pendingEvidence: input.pendingEvidence };
  }
  if (localChanged) return { status: 'upload-required' as const, canAutoMerge: true, pendingEvidence: input.pendingEvidence };
  if (serverChanged) return { status: 'download-required' as const, canAutoMerge: true, pendingEvidence: input.pendingEvidence };
  return { status: 'synchronized' as const, canAutoMerge: true, pendingEvidence: input.pendingEvidence };
}
