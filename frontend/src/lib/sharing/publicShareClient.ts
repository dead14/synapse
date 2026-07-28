import { apiFetch } from '../../utils/api.ts';
import type {
  PublicShareKind,
  PublicShareSnapshot,
} from './publicShareSnapshot.ts';

export { publicShareUrl, tokenFromLocationHash } from './publicShareLink.ts';

export interface PublicShareMetadata {
  id: string;
  kind: PublicShareKind;
  title: string;
  sourceRef: string | null;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  isActive: boolean;
}

export interface CreatedPublicShare extends PublicShareMetadata {
  accessToken: string;
}

export interface PublicShareView {
  id: string;
  kind: PublicShareKind;
  title: string;
  sourceRef: string | null;
  createdAt: string;
  expiresAt: string;
  snapshot: PublicShareSnapshot;
}

export async function fetchPublicShareResultPage(
  id: string,
  accessToken: string,
  options: { limit?: number; cursor?: string | null } = {},
  signal?: AbortSignal,
): Promise<{ items: Array<Record<string, unknown>>; nextCursor: string | null }> {
  const params = new URLSearchParams();
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  if (options.cursor) params.set('cursor', options.cursor);
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const response = await apiFetch<{ items?: unknown; nextCursor?: unknown }>(
    `/api/public-shares/${encodeURIComponent(id)}/results/page${suffix}`,
    {
      headers: { 'X-Share-Token': accessToken },
      signal,
    },
  );
  return {
    items: Array.isArray(response.items)
      ? response.items.filter((item): item is Record<string, unknown> => (
        typeof item === 'object' && item !== null && !Array.isArray(item)
      ))
      : [],
    nextCursor: typeof response.nextCursor === 'string' ? response.nextCursor : null,
  };
}

export async function createPublicShare(input: {
  kind: PublicShareKind;
  title: string;
  sourceRef?: string;
  expiresInDays: 7 | 30 | 90;
  snapshot: PublicShareSnapshot;
}): Promise<CreatedPublicShare> {
  const response = await apiFetch<{ share: CreatedPublicShare }>('/api/public-shares', {
    method: 'POST',
    body: input,
  });
  return response.share;
}

export async function revokePublicShare(id: string): Promise<void> {
  await apiFetch<void>(`/api/public-shares/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function fetchPublicShare(
  id: string,
  accessToken: string,
  signal?: AbortSignal,
): Promise<PublicShareView> {
  const response = await apiFetch<{ share: PublicShareView }>(
    `/api/public-shares/${encodeURIComponent(id)}`,
    {
      headers: { 'X-Share-Token': accessToken },
      signal,
    },
  );
  return response.share;
}
