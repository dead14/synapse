import { useEffect, useMemo, useState } from 'react';
import { FiChevronLeft, FiChevronRight, FiEye, FiHexagon, FiLock, FiSearch, FiX } from 'react-icons/fi';
import { useLocation, useParams } from 'react-router-dom';

import Modal from '../../components/common/Modal.tsx';
import PageMeta from '../../components/common/PageMeta.tsx';
import IliComparisonPage from '../../IliComparisonPage.tsx';
import {
  fetchPublicShare,
  tokenFromLocationHash,
  type PublicShareView,
} from '../../lib/sharing/publicShareClient.ts';
import type { PublicShareValue } from '../../lib/sharing/publicShareSnapshot.ts';

const PAGE_SIZE = 100;
const KIND_LABELS: Record<PublicShareView['kind'], string> = {
  GW_ALIGNMENT: 'GW Alignment',
  SECTIONING: 'Sectioning',
  ILI_ALIGNMENT: 'ILI Alignment',
  CORROSION: 'Corrosion Analysis',
  FFS: 'Fitness-for-service',
};

function formatValue(value: PublicShareValue): string {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return Number.isInteger(value)
    ? value.toLocaleString()
    : value.toLocaleString(undefined, { maximumFractionDigits: 4 });
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.every((item) => (
    item === null || ['string', 'number', 'boolean'].includes(typeof item)
  ))) {
    return value.map((item) => formatValue(item as PublicShareValue)).join(', ');
  }
  return JSON.stringify(value, null, 2);
}

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

function PublicPreviewHeader({ title }: { title: string }) {
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
        <div className="engine-header__context" aria-label="Current workspace">
          <span>workspace</span>
          <strong className="max-w-72 truncate" title={title}>Shared preview</strong>
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

function PublicIliAlignmentPreview({
  share,
  accessToken,
}: {
  share: PublicShareView;
  accessToken: string;
}) {
  const sessionMatch = share.sourceRef?.match(/^alignment-session:(\d+)$/);
  if (!sessionMatch) return <SharedUnavailable />;

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
        <PublicPreviewHeader title={share.title} />
        <main id="main-content" tabIndex={-1} className="engine-main">
          <IliComparisonPage
            readOnly
            shareAccess={{
              id: share.id,
              accessToken,
              sessionId: sessionMatch[1],
            }}
          />
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
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [selectedRow, setSelectedRow] = useState<Record<string, PublicShareValue> | null>(null);

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
    setQuery('');
    setPage(1);
    setSelectedRow(null);
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

  const filteredRows = useMemo(() => {
    const rows = share?.snapshot.rows ?? [];
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => Object.values(row)
      .some((value) => formatValue(value).toLowerCase().includes(needle)));
  }, [query, share?.snapshot.rows]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const visibleRows = filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [query]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  if (isLoading) return <SharedLoading />;
  if (isUnavailable || !share) return <SharedUnavailable />;

  const kindLabel = KIND_LABELS[share.kind];
  if (share.kind === 'ILI_ALIGNMENT') {
    return (
      <PublicIliAlignmentPreview
        key={`${share.id}:${share.sourceRef ?? ''}`}
        share={share}
        accessToken={tokenFromLocationHash(location.hash)}
      />
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <PageMeta
        title={`${share.title} - Shared Synapse result`}
        description={`Read-only ${kindLabel} snapshot shared from Synapse`}
      />

      <header className="border-b border-slate-200 bg-slate-950 text-white">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded bg-lime-300 font-black text-slate-950">
              S
            </span>
            <div>
              <p className="text-sm font-bold tracking-wide">SYNAPSE</p>
              <p className="text-[10px] uppercase tracking-[0.16em] text-slate-400">Shared result</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-2 rounded-full border border-slate-700 px-3 py-1 text-xs font-semibold text-slate-200">
            <FiEye aria-hidden="true" /> Read only / No login
          </span>
        </div>
      </header>

      <div className="mx-auto max-w-[1600px] space-y-5 px-4 py-6 sm:px-6">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-lime-700 dark:text-lime-300">
                {kindLabel}
              </p>
              <h1 className="mt-1 break-words text-2xl font-bold sm:text-3xl">{share.title}</h1>
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                Snapshot created {new Date(share.createdAt).toLocaleString()} / access expires{' '}
                {new Date(share.expiresAt).toLocaleString()}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
              Frozen snapshot / source data will not change here
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {share.snapshot.summary.map((item) => (
              <div key={item.label} className="rounded-lg border border-slate-200 px-3 py-2.5 dark:border-slate-700">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{item.label}</p>
                <p className="mt-1 text-lg font-bold">{formatValue(item.value)}</p>
              </div>
            ))}
          </div>
        </section>

        {share.snapshot.notes.length > 0 && (
          <section aria-label="Snapshot notes" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
            <ul className="list-disc space-y-1 pl-5">
              {share.snapshot.notes.map((note) => <li key={note}>{note}</li>)}
            </ul>
          </section>
        )}

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900" aria-labelledby="shared-table-title">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
            <div>
              <h2 id="shared-table-title" className="text-sm font-bold">Snapshot rows</h2>
              <p className="text-xs text-slate-500">
                {filteredRows.length.toLocaleString()} of {share.snapshot.rows.length.toLocaleString()} rows
              </p>
            </div>
            <label className="relative w-full sm:w-72">
              <span className="sr-only">Search shared rows</span>
              <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search this snapshot"
                className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-lime-500 focus:ring-2 focus:ring-lime-200 dark:border-slate-700 dark:bg-slate-950"
              />
            </label>
          </div>

          <div className="max-h-[65vh] overflow-auto">
            <table className="min-w-full border-collapse text-left text-xs">
              <thead className="sticky top-0 z-10 bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-200">
                <tr>
                  <th scope="col" className="w-16 border-b border-slate-200 px-3 py-2.5 dark:border-slate-700">
                    Detail
                  </th>
                  {share.snapshot.columns.map((column) => (
                    <th key={column.key} scope="col" className="min-w-36 whitespace-nowrap border-b border-slate-200 px-3 py-2.5 font-bold dark:border-slate-700">
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {visibleRows.map((row, index) => (
                  <tr key={`${page}-${index}`} className="hover:bg-lime-50/50 dark:hover:bg-lime-950/10">
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => setSelectedRow(row)}
                        className="rounded border border-slate-300 px-2 py-1 font-semibold text-slate-700 hover:border-lime-500 hover:bg-lime-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-lime-950/30"
                        aria-label={`Open detail for row ${(page - 1) * PAGE_SIZE + index + 1}`}
                      >
                        Open
                      </button>
                    </td>
                    {share.snapshot.columns.map((column) => (
                      <td key={column.key} className="max-w-72 truncate px-3 py-2 text-slate-700 dark:text-slate-300" title={formatValue(row[column.key])}>
                        {formatValue(row[column.key])}
                      </td>
                    ))}
                  </tr>
                ))}
                {visibleRows.length === 0 && (
                  <tr>
                    <td colSpan={share.snapshot.columns.length + 1} className="px-4 py-12 text-center text-sm text-slate-500">
                      No row matches this search.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-xs dark:border-slate-800">
            <span>Page {page} of {totalPages}</span>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page === 1}
                className="rounded border border-slate-300 p-2 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700"
                aria-label="Previous page"
              >
                <FiChevronLeft aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                disabled={page === totalPages}
                className="rounded border border-slate-300 p-2 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700"
                aria-label="Next page"
              >
                <FiChevronRight aria-hidden="true" />
              </button>
            </div>
          </div>
        </section>

        <p className="pb-6 text-center text-xs leading-relaxed text-slate-500">
          This snapshot is decision-support evidence, not an engineering approval.
          Qualified engineers remain responsible for validating inputs, assumptions, and conclusions.
        </p>
      </div>

      {selectedRow && (
        <Modal
          onClose={() => setSelectedRow(null)}
          ariaLabel="Shared result row detail"
          panelClassName="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-xl border border-slate-200 bg-white p-0 shadow-xl dark:border-slate-700 dark:bg-slate-900"
        >
          <div className="sticky top-0 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4 dark:border-slate-700 dark:bg-slate-900">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Read-only row</p>
              <h2 className="mt-1 text-lg font-bold">Engineering detail</h2>
            </div>
            <button
              type="button"
              onClick={() => setSelectedRow(null)}
              aria-label="Close row detail"
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <FiX aria-hidden="true" />
            </button>
          </div>
          <dl className="divide-y divide-slate-100 px-5 dark:divide-slate-800">
            {share.snapshot.columns.map((column) => (
              <div key={column.key} className="grid gap-1 py-3 sm:grid-cols-[12rem_1fr] sm:gap-4">
                <dt className="text-xs font-bold text-slate-500">{column.label}</dt>
                <dd className="whitespace-pre-wrap break-words text-sm text-slate-800 dark:text-slate-200">
                  {formatValue(selectedRow[column.key])}
                </dd>
              </div>
            ))}
          </dl>
        </Modal>
      )}
    </main>
  );
}
