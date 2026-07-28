interface ResolveAlignmentSessionOptions {
  sharedSessionId?: string;
  search?: string;
  storedSessionId?: string | null;
}

export function resolveAlignmentSessionId({
  sharedSessionId = '',
  search = '',
  storedSessionId = '',
}: ResolveAlignmentSessionOptions): string {
  return sharedSessionId
    || new URLSearchParams(search).get('sessionId')
    || storedSessionId
    || '';
}
