import { useState } from 'react';
import { FiRotateCcw, FiTrash2 } from 'react-icons/fi';
import type { ComparisonRow } from '../../utils/alignment';
import { exclusionSide, isExcludedRow } from '../../utils/interventions';

interface ExclusionControlsProps {
  activeTab: string;
  selectedRow: ComparisonRow | null;
  selectedRowIdx: number | null;
  onExcludeSingle?: (rowIdx: number) => Promise<void> | void;
  onExcludeRange?: (startRowIdx: number, endRowIdx: number) => Promise<void> | void;
  onRestoreExclusion?: (rowIdx: number) => Promise<void> | void;
}

export default function ExclusionControls({
  activeTab,
  selectedRow,
  selectedRowIdx,
  onExcludeSingle,
  onExcludeRange,
  onRestoreExclusion,
}: ExclusionControlsProps) {
  const [rangeStart, setRangeStart] = useState<{ row: ComparisonRow; index: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const selectedSide = selectedRow ? exclusionSide(selectedRow) : null;
  const rangeSide = rangeStart ? exclusionSide(rangeStart.row) : null;
  const canFinishRange = Boolean(
    rangeStart
    && selectedRow
    && selectedRowIdx !== null
    && selectedRowIdx !== rangeStart.index
    && selectedSide
    && selectedSide === rangeSide
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

  if (activeTab === 'Excluded') {
    if (!selectedRow || !isExcludedRow(selectedRow) || !onRestoreExclusion) return null;
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() => void run(() => onRestoreExclusion(Number(selectedRow.__origIdx)))}
        className="syn-btn syn-btn--sm syn-btn--outline"
      >
        <FiRotateCcw size={14} />
        {busy ? 'Restoring...' : 'Restore exclusion'}
      </button>
    );
  }

  if (!selectedRow || !selectedSide || isExcludedRow(selectedRow) || !onExcludeSingle) return null;
  const selectedIndex = Number(selectedRow.__origIdx);

  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={() => void run(() => onExcludeSingle(selectedIndex))}
        className="syn-btn syn-btn--sm syn-btn--outline"
        title={`Remove this unmatched ${selectedSide} feature from final outputs`}
      >
        <FiTrash2 size={14} />
        Exclude item
      </button>
      {rangeStart === null ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => setRangeStart({ row: selectedRow, index: selectedIndex })}
          className="syn-btn syn-btn--sm syn-btn--outline"
          title={`Use this unmatched ${selectedSide} feature as the first range endpoint`}
        >
          Start range
        </button>
      ) : (
        <>
          <span className="text-xs" style={{ color: 'var(--syn-muted)' }}>
            Range {rangeSide}: {String(
              rangeStart.row[`Identif. ${rangeSide}`]
              ?? rangeStart.row[`Source Key ${rangeSide}`]
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
                ? 'Exclude all unmatched features on this side between both endpoints'
                : 'Select a different unmatched endpoint on the same side and run pair'}
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
  );
}
