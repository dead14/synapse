/**
 * A published link opens the real result screen, read-only.
 *
 * There is no separate "shared result" view. An alignment link mounts the
 * comparison workspace against the run it was published from; an FFS link
 * mounts the assessment workspace against the frozen state the author had on
 * screen. A recipient reading a different page from the author is a recipient
 * reading different evidence, which is the whole failure this page exists to
 * avoid.
 */

import { useEffect, useState } from 'react';
import { FiEye, FiHexagon, FiLock } from 'react-icons/fi';
import { useLocation, useParams } from 'react-router-dom';

import PageMeta from '../../components/common/PageMeta.tsx';
import IliComparisonPage from '../../IliComparisonPage.tsx';
import FfsResultsPage from '../FFS/FfsResultsPage.tsx';
import {
  fetchPublicShare,
  tokenFromLocationHash,
  type PublicShareView,
} from '../../lib/sharing/publicShareClient.ts';

const KIND_LABELS: Record<PublicShareView['kind'], string> = {
  ILI_ALIGNMENT: 'ILI Alignment',
  FFS: 'Fitness-for-service',
};

function SharedUnavailable() {
  return (
    <main className="min-h-screen bg-slate-100 px-4 py-12 dark:bg-slate-950">
      <section className="mx-auto max-w-lg rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          <FiLock size={22} aria-hidden="true" />
        </div>
        <p className="mt-5 text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
          Link unavailable
        </p>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">
          This shared result cannot be opened.
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
          The link may be incomplete, expired, or revoked. Ask the Synapse owner
          to create a new read-only link.
        </p>
      </section>
    </main>
  );
}

function SharedLoading() {
  return (
    <main className="min-h-screen bg-slate-100 px-4 py-12 dark:bg-slate-950" aria-busy="true">
      <section className="mx-auto max-w-4xl rounded-xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="h-3 w-36 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
        <div className="mt-4 h-8 w-3/5 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
        <div className="mt-8 h-72 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
        <p className="sr-only" role="status">Loading shared result</p>
      </section>
    </main>
  );
}

function PublicPreviewHeader({ share }: { share: PublicShareView }) {
  return (
    <header className="engine-header">
      <div className="engine-header__bar">
        <div className="engine-header__primary">
          <div className="engine-brand" aria-label="Synapse shared preview">
            <span className="engine-brand__mark">
              <FiHexagon aria-hidden="true" />
              <span>S</span>
            </span>
            <span className="engine-brand__copy">
              <strong>Synapse</strong>
              <small>Integrity OS</small>
            </span>
          </div>
        </div>
        <div className="engine-header__context" aria-label="Shared result">
          <span>{KIND_LABELS[share.kind]}</span>
          <strong className="max-w-72 truncate" title={share.title}>{share.title}</strong>
          <span className="engine-status"><i /> read only</span>
        </div>
        <div className="engine-header__actions">
          <span className="syn-btn syn-btn--sm syn-btn--outline" aria-label="Read only preview, no login required">
            <FiEye aria-hidden="true" />
            Preview / no login
          </span>
        </div>
      </div>
    </header>
  );
}

function SharedNotes({ share }: { share: PublicShareView }) {
  const notes = share.snapshot?.notes ?? [];
  return (
    <div className="app-page-shell pt-3">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Published {new Date(share.createdAt).toLocaleString()} · access expires{' '}
        {new Date(share.expiresAt).toLocaleString()}
      </p>
      {notes.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-500 dark:text-slate-400">
          {notes.map((note) => <li key={note}>{note}</li>)}
        </ul>
      )}
    </div>
  );
}

function PublicAlignmentPreview({
  share,
  accessToken,
}: {
  share: PublicShareView;
  accessToken: string;
}) {
  const state = share.snapshot?.state;
  const alignmentState = state?.kind === 'ILI_ALIGNMENT' ? state : null;
  if (!share.sourceRef) return <SharedUnavailable />;

  return (
    <div className="syn-app engine-app">
      <PageMeta
        title={`${share.title} - Shared Synapse preview`}
        description="Read-only ILI alignment preview shared from Synapse"
      />
      <a href="#main-content" className="syn-action syn-action--signal syn-skip-link">
        Skip to shared preview
      </a>
      <div className="min-w-0 flex-1">
        <PublicPreviewHeader share={share} />
        <main id="main-content" tabIndex={-1} className="engine-main">
          <SharedNotes share={share} />
          <IliComparisonPage
            readOnly
            sharedInterventions={alignmentState?.interventions}
            sharedSections={alignmentState?.sections}
            sharedHiddenFeatures={alignmentState?.hiddenFeatures}
            shareAccess={{
              id: share.id,
              accessToken,
              sourceRef: share.sourceRef,
            }}
          />
        </main>
      </div>
    </div>
  );
}

function PublicFfsPreview({ share }: { share: PublicShareView }) {
  const state = share.snapshot?.state;
  if (state?.kind !== 'FFS') return <SharedUnavailable />;

  return (
    <div className="syn-app engine-app">
      <PageMeta
        title={`${share.title} - Shared Synapse preview`}
        description="Read-only fitness-for-service assessment shared from Synapse"
      />
      <a href="#main-content" className="syn-action syn-action--signal syn-skip-link">
        Skip to shared preview
      </a>
      <div className="min-w-0 flex-1">
        <PublicPreviewHeader share={share} />
        <main id="main-content" tabIndex={-1} className="engine-main">
          <SharedNotes share={share} />
          <FfsResultsPage readOnly sharedState={state} />
        </main>
      </div>
    </div>
  );
}

export default function PublicSharePage() {
  const { id = '' } = useParams();
  const location = useLocation();
  const [share, setShare] = useState<PublicShareView | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUnavailable, setIsUnavailable] = useState(false);

  useEffect(() => {
    const accessToken = tokenFromLocationHash(location.hash);
    if (!id || !accessToken) {
      setIsLoading(false);
      setIsUnavailable(true);
      return;
    }

    const controller = new AbortController();
    let isCurrent = true;
    setShare(null);
    setIsLoading(true);
    setIsUnavailable(false);
    void fetchPublicShare(id, accessToken, controller.signal)
      .then((result) => {
        if (isCurrent) setShare(result);
      })
      .catch((error) => {
        if (isCurrent && error?.name !== 'AbortError') setIsUnavailable(true);
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false);
      });
    return () => {
      isCurrent = false;
      controller.abort();
    };
  }, [id, location.hash]);

  if (isLoading) return <SharedLoading />;
  if (isUnavailable || !share) return <SharedUnavailable />;

  if (share.kind === 'ILI_ALIGNMENT') {
    return (
      <PublicAlignmentPreview
        key={`${share.id}:${share.sourceRef ?? ''}`}
        share={share}
        accessToken={tokenFromLocationHash(location.hash)}
      />
    );
  }
  if (share.kind === 'FFS') {
    return <PublicFfsPreview key={share.id} share={share} />;
  }
  // Links published before sharing was narrowed to these two results.
  return <SharedUnavailable />;
}
