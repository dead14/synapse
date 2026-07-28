import { useEffect, useId, useState } from 'react';
import { FiCheck, FiCopy, FiLink, FiTrash2, FiX } from 'react-icons/fi';

import Modal from '../common/Modal.tsx';
import { useToast } from '../common/ToastProvider.tsx';
import SynButton from '../ui/SynButton.tsx';
import { useAuth } from '../../context/AuthContext.tsx';
import {
  createPublicShare,
  publicShareUrl,
  revokePublicShare,
  type CreatedPublicShare,
} from '../../lib/sharing/publicShareClient.ts';
import { publicShareScopeKey } from '../../lib/sharing/publicShareLink.ts';
import {
  buildPublicShareSnapshot,
  type PublicShareKind,
  type PublicShareSummaryItem,
} from '../../lib/sharing/publicShareSnapshot.ts';

type ExpiryDays = 7 | 30 | 90;

interface ShareSnapshotButtonProps {
  kind: PublicShareKind;
  title: string;
  sourceRef?: string;
  rows: object[];
  referenceOnly?: boolean;
  summary?: PublicShareSummaryItem[];
  notes?: string[];
  disabled?: boolean;
  className?: string;
  label?: string;
}

interface CreatedLink {
  share: CreatedPublicShare;
  url: string;
  isRevoked: boolean;
}

const PUBLISHER_ROLES = new Set(['engineer', 'admin', 'super_admin']);

async function copyText(value: string): Promise<void> {
  if (!navigator.clipboard?.writeText) throw new Error('Clipboard is not available');
  await navigator.clipboard.writeText(value);
}

export default function ShareSnapshotButton({
  kind,
  title,
  sourceRef,
  rows,
  referenceOnly = false,
  summary,
  notes,
  disabled = false,
  className = '',
  label = 'Share',
}: ShareSnapshotButtonProps) {
  const { user } = useAuth();
  const toast = useToast();
  const titleId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [expiryDays, setExpiryDays] = useState<ExpiryDays>(30);
  const [isCreating, setIsCreating] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);
  const [created, setCreated] = useState<CreatedLink | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const shareScope = publicShareScopeKey(kind, title, sourceRef);

  useEffect(() => {
    setIsOpen(false);
    setCreated(null);
    setError('');
    setCopied(false);
  }, [shareScope]);

  if (!user || !PUBLISHER_ROLES.has(user.role) || !user.orgId) return null;

  const close = () => {
    if (isCreating || isRevoking) return;
    setIsOpen(false);
    setError('');
    setCopied(false);
  };

  const createLink = async () => {
    setError('');
    setCopied(false);
    setIsCreating(true);
    try {
      const snapshot = buildPublicShareSnapshot(
        kind,
        referenceOnly ? [] : rows,
        { summary, notes },
      );
      const share = await createPublicShare({
        kind,
        title,
        sourceRef,
        expiresInDays: expiryDays,
        snapshot,
      });
      const url = publicShareUrl(share.id, share.accessToken);
      setCreated({ share, url, isRevoked: false });
      try {
        await copyText(url);
        setCopied(true);
        toast.success('Read-only link created and copied.');
      } catch {
        toast.success('Read-only link created. Copy it from the dialog.');
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Failed to create the link.';
      setError(message);
    } finally {
      setIsCreating(false);
    }
  };

  const copyLink = async () => {
    if (!created || created.isRevoked) return;
    try {
      await copyText(created.url);
      setCopied(true);
      toast.success('Link copied.');
    } catch {
      setError('Clipboard access was blocked. Select and copy the link manually.');
    }
  };

  const revokeLink = async () => {
    if (!created || created.isRevoked) return;
    setError('');
    setIsRevoking(true);
    try {
      await revokePublicShare(created.share.id);
      setCreated((current) => current ? { ...current, isRevoked: true } : current);
      toast.success('Public link revoked.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to revoke the link.');
    } finally {
      setIsRevoking(false);
    }
  };

  return (
    <>
      <SynButton
        type="button"
        variant="outline"
        size="sm"
        className={className}
        disabled={disabled || rows.length === 0}
        onClick={() => setIsOpen(true)}
        title={rows.length === 0 ? 'No result rows are available to share.' : undefined}
      >
        <span className="inline-flex items-center gap-2">
          <FiLink aria-hidden="true" /> {label}
        </span>
      </SynButton>

      {isOpen && (
        <Modal
          onClose={close}
          labelledBy={titleId}
          panelClassName="w-full max-w-xl rounded-xl border border-slate-200 bg-white p-0 shadow-xl dark:border-slate-700 dark:bg-slate-900"
        >
          <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-700">
            <div>
              <p className="syn-eyebrow">External read-only access</p>
              <h2 id={titleId} className="mt-1 text-lg font-bold text-slate-900 dark:text-white">
                {referenceOnly ? 'Share this view' : 'Share this snapshot'}
              </h2>
            </div>
            <button
              type="button"
              onClick={close}
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-white"
              aria-label="Close share dialog"
            >
              <FiX aria-hidden="true" />
            </button>
          </div>

          <div className="space-y-4 px-5 py-5">
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200">
              Anyone with the complete link can view this {referenceOnly ? 'read-only result' : 'frozen result'} without logging in.
              They cannot edit the source analysis. Do not share it beyond the intended audience.
            </div>

            {!created && (
              <label className="block">
                <span className="text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                  Link expires after
                </span>
                <select
                  value={expiryDays}
                  onChange={(event) => setExpiryDays(Number(event.target.value) as ExpiryDays)}
                  className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  <option value={7}>7 days</option>
                  <option value={30}>30 days</option>
                  <option value={90}>90 days</option>
                </select>
              </label>
            )}

            {created && (
              <div className="space-y-3">
                <label className="block">
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                    Public link
                  </span>
                  <input
                    type="text"
                    readOnly
                    value={created.url}
                    onFocus={(event) => event.currentTarget.select()}
                    className="mt-1.5 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                    aria-label="Created public link"
                  />
                </label>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Expires {new Date(created.share.expiresAt).toLocaleString()}.
                  The secret is shown only in this dialog; create a new link if it is lost.
                </p>
                {created.isRevoked && (
                  <p role="status" className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">
                    This link has been revoked and no longer opens the shared result.
                  </p>
                )}
              </div>
            )}

            {error && (
              <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
                {error}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 px-5 py-4 dark:border-slate-700">
            {!created ? (
              <SynButton
                type="button"
                variant="solid"
                size="sm"
                disabled={isCreating}
                onClick={() => void createLink()}
              >
                <span className="inline-flex items-center gap-2">
                  <FiLink aria-hidden="true" />
                  {isCreating ? 'Creating...' : 'Create read-only link'}
                </span>
              </SynButton>
            ) : (
              <>
                <SynButton
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={created.isRevoked || isRevoking}
                  onClick={() => void revokeLink()}
                >
                  <span className="inline-flex items-center gap-2 text-rose-600">
                    <FiTrash2 aria-hidden="true" />
                    {isRevoking ? 'Revoking…' : 'Revoke'}
                  </span>
                </SynButton>
                <SynButton
                  type="button"
                  variant="solid"
                  size="sm"
                  disabled={created.isRevoked}
                  onClick={() => void copyLink()}
                >
                  <span className="inline-flex items-center gap-2">
                    {copied ? <FiCheck aria-hidden="true" /> : <FiCopy aria-hidden="true" />}
                    {copied ? 'Copied' : 'Copy link'}
                  </span>
                </SynButton>
              </>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
