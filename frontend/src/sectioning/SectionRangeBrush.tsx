import { useCallback, useMemo, useRef, useState } from 'react';

import type { LockedGwPair, MatchingSection, SectionBoundary } from '../wizard/matchingSections';
import { coverageGaps, formatKm, lockedIndexOf, snapToLockedGw } from './sectionBuilder';

export interface BrushMarker {
  id: string;
  distM: number;
  kind: 'bend' | 'valve' | 'tee';
  label: string;
}

interface Props {
  boundaries?: SectionBoundary[];
  /** Compatibility input for previews and callers that only expose matched pairs. */
  lockedGws?: LockedGwPair[];
  sections: MatchingSection[];
  markers?: BrushMarker[];
  /** Locked-GW indexes of the boundary currently being composed. */
  selection: { startIndex: number; endIndex: number } | null;
  onSelect: (startIndex: number, endIndex: number) => void;
  onEditSection?: (sectionId: string) => void;
}

const MARKER_GLYPH: Record<BrushMarker['kind'], string> = { bend: '◆', valve: '▮', tee: '⊥' };

/**
 * Full-line rail the operator drags across to bound a section.
 *
 * This is the answer to the "sectioning is hard" feedback: the whole pipeline is
 * always on screen at once, so no zooming is involved, and the drag snaps to the
 * nearest locked GW instead of demanding a pixel-accurate hit on a marker.
 */
export default function SectionRangeBrush({
  lockedGws,
  boundaries = lockedGws?.map((pair) => ({
    ...pair,
    side: 'MATCHED' as const,
    label: pair.newId,
    sourceDistance: pair.newDistance,
  })) ?? [],
  sections,
  markers = [],
  selection,
  onSelect,
  onEditSection,
}: Props) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<{ anchorIndex: number; currentIndex: number } | null>(null);
  const [hoverM, setHoverM] = useState<number | null>(null);

  const lineStart = boundaries[0]?.newDistance ?? 0;
  const lineEnd = boundaries[boundaries.length - 1]?.newDistance ?? 0;
  const span = Math.max(1, lineEnd - lineStart);

  const toPercent = useCallback((metres: number) => ((metres - lineStart) / span) * 100, [lineStart, span]);

  /** Pointer position → nearest locked GW index. */
  const indexAtPointer = useCallback(
    (clientX: number): number | null => {
      const rail = railRef.current;
      if (!rail || boundaries.length === 0) return null;
      const bounds = rail.getBoundingClientRect();
      const fraction = Math.min(1, Math.max(0, (clientX - bounds.left) / Math.max(1, bounds.width)));
      const snapped = snapToLockedGw(boundaries, lineStart + fraction * span);
      return snapped?.index ?? null;
    },
    [boundaries, lineStart, span],
  );

  const drawnSections = useMemo(
    () =>
      sections
        .map((section) => {
          const startIndex = lockedIndexOf(boundaries, section.startGwKey);
          const endIndex = lockedIndexOf(boundaries, section.endGwKey);
          if (startIndex < 0 || endIndex <= startIndex) return null;
          return {
            id: section.id,
            name: section.name,
            policy: section.policy,
            left: toPercent(boundaries[startIndex].newDistance),
            width: toPercent(boundaries[endIndex].newDistance) - toPercent(boundaries[startIndex].newDistance),
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null),
    [boundaries, sections, toPercent],
  );

  const gaps = useMemo(() => coverageGaps(sections, boundaries), [boundaries, sections]);

  const active = drag
    ? { startIndex: Math.min(drag.anchorIndex, drag.currentIndex), endIndex: Math.max(drag.anchorIndex, drag.currentIndex) }
    : selection;

  const activeBand = active && active.endIndex > active.startIndex
    ? {
        left: toPercent(boundaries[active.startIndex].newDistance),
        width: toPercent(boundaries[active.endIndex].newDistance) - toPercent(boundaries[active.startIndex].newDistance),
      }
    : null;

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const index = indexAtPointer(event.clientX);
    if (index === null) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ anchorIndex: index, currentIndex: index });
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const rail = railRef.current;
    if (rail) {
      const bounds = rail.getBoundingClientRect();
      const fraction = Math.min(1, Math.max(0, (event.clientX - bounds.left) / Math.max(1, bounds.width)));
      setHoverM(lineStart + fraction * span);
    }
    if (!drag) return;
    const index = indexAtPointer(event.clientX);
    if (index !== null && index !== drag.currentIndex) setDrag({ ...drag, currentIndex: index });
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const startIndex = Math.min(drag.anchorIndex, drag.currentIndex);
    const endIndex = Math.max(drag.anchorIndex, drag.currentIndex);
    setDrag(null);
    // A click without movement is a boundary reset, not a zero-length section.
    if (endIndex > startIndex) onSelect(startIndex, endIndex);
  };

  /** Keyboard equivalent: arrows move the end boundary, shift+arrows the start. */
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!selection) return;
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const limit = boundaries.length - 1;
    if (event.shiftKey) {
      const startIndex = Math.min(Math.max(0, selection.startIndex + step), selection.endIndex - 1);
      onSelect(startIndex, selection.endIndex);
    } else {
      const endIndex = Math.max(Math.min(limit, selection.endIndex + step), selection.startIndex + 1);
      onSelect(selection.startIndex, endIndex);
    }
  };

  if (boundaries.length < 2) {
    return (
      <div className="ds-callout ds-callout--warning">
        <div className="ds-callout__body">
          Sectioning needs at least two locked girth welds. Complete GW matching first.
        </div>
      </div>
    );
  }

  return (
    <div className="sec-brush">
      <div className="sec-brush__scale" aria-hidden="true">
        {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
          <span key={fraction} style={{ left: `${fraction * 100}%` }}>
            {formatKm(lineStart + fraction * span)}
          </span>
        ))}
      </div>

      <div
        ref={railRef}
        className={`sec-brush__rail${drag ? ' is-dragging' : ''}`}
        role="slider"
        tabIndex={0}
        aria-label="Drag across the pipeline to bound a section"
        aria-valuemin={lineStart}
        aria-valuemax={lineEnd}
        aria-valuenow={active ? boundaries[active.endIndex].newDistance : lineStart}
        aria-valuetext={
          active
            ? `${formatKm(boundaries[active.startIndex].newDistance)} to ${formatKm(boundaries[active.endIndex].newDistance)}`
            : 'No range selected'
        }
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => setHoverM(null)}
        onKeyDown={handleKeyDown}
      >
        {/* Uncovered stretches, so the operator can see what is left to do. */}
        {gaps.map((gap) => (
          <span
            key={`gap-${gap.startM}`}
            className="sec-brush__gap"
            style={{ left: `${toPercent(gap.startM)}%`, width: `${toPercent(gap.endM) - toPercent(gap.startM)}%` }}
          />
        ))}

        {drawnSections.map((section) => (
          <button
            key={section.id}
            type="button"
            className={`sec-brush__section is-${section.policy.toLowerCase()}`}
            style={{ left: `${section.left}%`, width: `${section.width}%` }}
            title={`${section.name} — click to edit`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onEditSection?.(section.id)}
          >
            <span>{section.name}</span>
          </button>
        ))}

        {markers.map((marker) => (
          <span
            key={marker.id}
            className={`sec-brush__marker is-${marker.kind}`}
            style={{ left: `${toPercent(marker.distM)}%` }}
            title={marker.label}
          >
            {MARKER_GLYPH[marker.kind]}
          </span>
        ))}

        {activeBand && (
          <span className="sec-brush__band" style={{ left: `${activeBand.left}%`, width: `${activeBand.width}%` }}>
            <i className="sec-brush__handle" />
            <i className="sec-brush__handle sec-brush__handle--end" />
          </span>
        )}

        {hoverM !== null && !drag && (
          <span className="sec-brush__cursor" style={{ left: `${toPercent(hoverM)}%` }} aria-hidden="true" />
        )}
      </div>

      <p className="sec-brush__hint">
        {active && active.endIndex > active.startIndex ? (
          <>
            <strong>{boundaries[active.startIndex].label}</strong> → <strong>{boundaries[active.endIndex].label}</strong>
            {' · '}
            {formatKm(boundaries[active.endIndex].newDistance - boundaries[active.startIndex].newDistance)}
            {' · snapped to selectable GWs'}
          </>
        ) : (
          'Drag across the rail to bound a section. Release to snap both ends to the nearest locked GW.'
        )}
      </p>
    </div>
  );
}
