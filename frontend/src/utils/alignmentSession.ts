/**
 * Which alignment session a results screen is looking at.
 *
 * The id reaches the page from three places — a public share's server-authored
 * reference, the URL, and the last session this browser touched — and only the
 * first two are things the user just asked for. The stored fallback is a
 * convenience, so a stored value that could not possibly be a session is
 * dropped rather than sent to the API: a leftover key used to put a raw
 * "Invalid session ID" from the backend on screen, which tells the engineer
 * nothing about what to do next.
 */

export const LAST_SESSION_STORAGE_KEY = 'synapse_last_session_id';

interface ResolveAlignmentSessionOptions {
  sharedSessionId?: string;
  search?: string;
  storedSessionId?: string | null;
}

/**
 * True when this could address a session at all: the API keys sessions by a
 * positive integer, so anything else is a dead request before it is sent.
 */
export function isAlignmentSessionId(value: string | null | undefined): boolean {
  if (typeof value !== 'string' || value.trim() === '') return false;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0;
}

/**
 * What a published link points at.
 *
 * A share carries the server-authored reference it was created with — a run
 * (`alignment-job:<id>`) or a session (`alignment-session:<id>`) — never a bare
 * session id. Handing that string to the session resolver made every published
 * alignment link open on "…is not an alignment session reference", because the
 * prefix cannot be a positive integer. Rows for a share are read through the
 * share's own endpoint, so a job reference needs no session at all.
 */
export function parseAlignmentShareReference(
  sourceRef: string | null | undefined,
): { kind: 'job' | 'session'; id: string } | null {
  if (typeof sourceRef !== 'string') return null;
  const reference = sourceRef.trim();
  if (reference === '') return null;
  const job = reference.match(/^alignment-job:(.+)$/);
  if (job) return { kind: 'job', id: job[1] };
  const session = reference.match(/^alignment-session:(.+)$/);
  if (session) return { kind: 'session', id: session[1] };
  // Links published before references were prefixed carry the bare session id.
  return isAlignmentSessionId(reference) ? { kind: 'session', id: reference } : null;
}

export function resolveAlignmentSessionId({
  sharedSessionId = '',
  search = '',
  storedSessionId = '',
}: ResolveAlignmentSessionOptions): string {
  // A share reference and a URL id are explicit requests: they are returned
  // even when malformed, so the page can say that *this* session is bad rather
  // than quietly showing a different one.
  const requested = sharedSessionId || new URLSearchParams(search).get('sessionId');
  if (requested) return requested;
  return isAlignmentSessionId(storedSessionId) ? (storedSessionId as string) : '';
}

/** Drop a remembered session that can no longer address anything. */
export function forgetUnusableStoredSession(): void {
  if (typeof window === 'undefined') return;
  try {
    const stored = window.localStorage.getItem(LAST_SESSION_STORAGE_KEY);
    if (stored !== null && !isAlignmentSessionId(stored)) {
      window.localStorage.removeItem(LAST_SESSION_STORAGE_KEY);
    }
  } catch {
    // A browser refusing storage is not a reason to fail the page.
  }
}
