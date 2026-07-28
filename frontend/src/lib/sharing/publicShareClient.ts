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
  createdAt: string;
  expiresAt: string;
  snapshot: PublicShareSnapshot;
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
