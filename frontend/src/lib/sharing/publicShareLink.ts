import type { PublicShareKind } from './publicShareSnapshot.ts';

export function publicShareScopeKey(
  kind: PublicShareKind,
  title: string,
  sourceRef?: string,
): string {
  return JSON.stringify([kind, title, sourceRef ?? '']);
}

export function publicShareUrl(
  id: string,
  accessToken: string,
  origin = window.location.origin,
): string {
  return `${origin}/share/${encodeURIComponent(id)}#${encodeURIComponent(accessToken)}`;
}

export function tokenFromLocationHash(hash: string): string {
  const encoded = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!encoded) return '';
  try {
    return decodeURIComponent(encoded);
  } catch {
    return '';
  }
}
