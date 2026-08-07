import { useState } from 'react';
import { FiLink2, FiRotateCcw, FiTrash2 } from 'react-icons/fi';
import type { ComparisonRow } from '../../utils/alignment';
import { exclusionTarget, isExcludedRow, isMatchedRow } from '../../utils/interventions';

interface ExclusionControlsProps {
  activeTab: string;
  selectedRow: ComparisonRow | null;
  selectedRowIdx: number | null;
  /** Rows ticked for a bulk action, by their stable `__origIdx`. */
  markedRowIdxs: number[];
  markedRows: ComparisonRow[];
  onClearMarks: () => void;
  onExcludeSingle?: (rowIdx: number) => Promise<void> | void;
  onExcludeMany?: (rowIdxs: number[]) => Promise<void> | void;
  onExcludeRange?: (startRowIdx: number, endRowIdx: number) => Promise<void> | void;
  onRestoreExclusion?: (rowIdxs: number | number[]) => Promise<void> | void;
  onUnassign?: (rowIdxs: number[]) => Promise<void> | void;
}

/**
 * The reviewer's edit bar for the comparison table.
 *
 * Everything here is addressed by row: one selected row, or every marked row.
 * Nothing is restricted by what the engine decided a row is — a valve, a tee
 * and a matched pair are all excludable, because "this must not reach the
 * report" is the reviewer's call to make, not the matcher's.
 */
export default function ExclusionControls({
  activeTab,
  selectedRow,
  selectedRowIdx,
  markedRowIdxs,
  markedRows,
  onClearMarks,
  onExcludeSingle,
  onExcludeMany,
  onExcludeRange,
  onRestoreExclusion,
  onUnassign,
}: ExclusionControlsProps) {
  const [rangeStart, setRangeStart] = useState<{ row: ComparisonRow; index: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const selectedTarget = selectedRow ? exclusionTarget(selectedRow) : null;
  const rangeTarget = rangeStart ? exclusionTarget(rangeStart.row) : null;
  const canFinishRange = Boolean(
    rangeStart
    && selectedRow
    && selectedRowIdx !== null
    && selectedRowIdx !== rangeStart.index
    && selectedTarget
    && selectedTarget.side === rangeTarget?.side
    && Number(selectedRow.pair_index ?? 0) === Number(rangeStart.row.pair_index ?? 0),
  );

  const run = async (action: () => Promise<void> | void) => {
    setBusy(true);
    try {
      await action();
    } catch {
      // The parent owns the user-facing error banner. Keep the range endpoint
      // intact so the reviewer can retry after a persistence failure.
    } finally {
      setBusy(false);
    }
  };

  const markedCount = markedRowIdxs.length;
  const markedExcluded = markedRows.filter(isExcludedRow).length;
  const markedMatches = markedRows.filter((row) => !isExcludedRow(row) && isMatchedRow(row)).length;
  const markedIncluded = markedCount - markedExcluded;

  const bulkBar = markedCount > 0 && (
    <>
      <span className="text-xs font-bold" style={{ color: 'var(--syn-ink)' }}>
        {markedCount} marked
      </span>
      {onExcludeMany && markedIncluded > 0 && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(async () => {
            await onExcludeMany(markedRowIdxs);
            onClearMarks();
          })}
          className="syn-btn syn-btn--sm syn-btn--outline"
          title="Remove every marked row from the released outputs"
        >
          <FiTrash2 size={14} />
          Exclude {markedIncluded}
        </button>
      )}
      {onUnassign && markedMatches > 0 && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(async () => {
            await onUnassign(markedRowIdxs);
            onClearMarks();
          })}
          className="syn-btn syn-btn--sm syn-btn--outline"
          title="Break every marked match back into its OLD-only and NEW-only rows"
        >
          <FiLink2 size={14} />
          Unassign {markedMatches}
        </button>
      )}
      {onRestoreExclusion && markedExcluded > 0 && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(async () => {
            await onRestoreExclusion(markedRowIdxs);
            onClearMarks();
          })}
          className="syn-btn syn-btn--sm syn-btn--outline"
          title="Put every marked row back into the released outputs"
        >
          <FiRotateCcw size={14} />
          Restore {markedExcluded}
        </button>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={onClearMarks}
        className="syn-btn syn-btn--sm syn-btn--outline"
      >
        Clear marks
      </button>
    </>
  );

  if (activeTab === 'Excluded') {
    const canRestoreSelected = selectedRow && isExcludedRow(selectedRow) && onRestoreExclusion;
    if (!bulkBar && !canRestoreSelected) return null;
    return (
      <>
        {bulkBar}
        {canRestoreSelected && markedCount === 0 && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => onRestoreExclusion(Number(selectedRow.__origIdx)))}
            className="syn-btn syn-btn--sm syn-btn--outline"
          >
            <FiRotateCcw size={14} />
            {busy ? 'Restoring...' : 'Restore exclusion'}
          </button>
        )}
      </>
    );
  }

  const canActOnSelection = Boolean(
    selectedRow && selectedTarget && !isExcludedRow(selectedRow) && onExcludeSingle,
  );
  if (!bulkBar && !canActOnSelection) return null;
  const selectedIndex = selectedRow ? Number(selectedRow.__origIdx) : -1;
  const scopeLabel = selectedTarget?.side === 'PAIR' ? 'matched' : `unmatched ${selectedTarget?.side}`;

  return (
    <>
      {bulkBar}
      {canActOnSelection && onExcludeSingle && (
        <>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => onExcludeSingle(selectedIndex))}
            className="syn-btn syn-btn--sm syn-btn--outline"
            title={`Remove this ${scopeLabel} row from final outputs`}
          >
            <FiTrash2 size={14} />
            Exclude item
          </button>
          {selectedRow && isMatchedRow(selectedRow) && onUnassign && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => onUnassign([selectedIndex]))}
              className="syn-btn syn-btn--sm syn-btn--outline"
              title="Break this match so both halves can be paired with something else"
            >
              <FiLink2 size={14} />
              Unassign match
            </button>
          )}
          {rangeStart === null ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => selectedRow && setRangeStart({ row: selectedRow, index: selectedIndex })}
              className="syn-btn syn-btn--sm syn-btn--outline"
              title={`Use this ${scopeLabel} row as the first range endpoint`}
            >
              Start range
            </button>
          ) : (
            <>
              <span className="text-xs" style={{ color: 'var(--syn-muted)' }}>
                Range {rangeTarget?.side}: {String(
                  rangeStart.row[`Identif. ${rangeTarget?.side === 'PAIR' ? 'OLD' : rangeTarget?.side}`]
                  ?? rangeTarget?.sourceKey
                  ?? '-',
                )}
              </span>
              {onExcludeRange && (
                <button
                  type="button"
                  disabled={busy || !canFinishRange}
                  onClick={() => {
                    if (!canFinishRange || selectedRowIdx === null) return;
                    void run(async () => {
                      await onExcludeRange(rangeStart.index, selectedRowIdx);
                      setRangeStart(null);
                    });
                  }}
                  className="syn-btn syn-btn--sm syn-btn--lime"
                  title={canFinishRange
                    ? 'Exclude every row on this side between both endpoints'
                    : 'Select a different endpoint on the same side and run pair'}
                >
                  Exclude through selected
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => setRangeStart(null)}
                className="syn-btn syn-btn--sm syn-btn--outline"
              >
                Cancel range
              </button>
            </>
          )}
        </>
      )}
    </>
  );
}
