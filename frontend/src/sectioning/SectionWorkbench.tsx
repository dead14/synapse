import { FiCheck, FiEdit3, FiMove, FiX } from 'react-icons/fi';

import { Badge, Button, Field, Input, Panel, PanelBody, PanelHeader, Select } from '../components/ds';
import type { LockedGwPair, MatchingSection, SectionBoundary, SectionPolicy } from '../wizard/matchingSections';
import AutoSectionPresets from './AutoSectionPresets';
import SectionBoundaryInputs, { type BoundaryEdge } from './SectionBoundaryInputs';
import SectionRangeBrush, { type BrushMarker } from './SectionRangeBrush';
import { formatKm } from './sectionBuilder';
import type { SectionDraft } from './SectionComposer';
import type { SpatialFeature } from './types';

interface Props {
  lockedGws: LockedGwPair[];
  boundaries: SectionBoundary[];
  sections: MatchingSection[];
  markers: BrushMarker[];
  masterFeatures: SpatialFeature[];
  sectionTypes: Array<[string, string]>;

  startIndex: number | null;
  endIndex: number | null;
  onSetBoundary: (edge: BoundaryEdge, index: number) => void;
  onSelectRange: (startIndex: number, endIndex: number) => void;
  onClear: () => void;

  draft: SectionDraft;
  onDraftChange: (patch: Partial<SectionDraft>) => void;
  isEditing: boolean;
  onSave: () => void;
  onEditSection: (sectionId: string) => void;
  onApplyPresets: (sections: MatchingSection[]) => void;
}

/**
 * The sectioning entry point.
 *
 * Four routes to the same result, because the single canvas-click route the
 * step used to offer was the thing engineers could not work with: drag the rail,
 * type a KP, pick a weld from the list, or generate a layout wholesale.
 */
export default function SectionWorkbench({
  lockedGws,
  boundaries,
  sections,
  markers,
  masterFeatures,
  sectionTypes,
  startIndex,
  endIndex,
  onSetBoundary,
  onSelectRange,
  onClear,
  draft,
  onDraftChange,
  isEditing,
  onSave,
  onEditSection,
  onApplyPresets,
}: Props) {
  const hasRange = startIndex !== null && endIndex !== null && endIndex > startIndex;
  const readyToSave = hasRange && draft.name.trim().length > 0;
  const start = startIndex !== null ? boundaries[startIndex] : null;
  const end = endIndex !== null ? boundaries[endIndex] : null;

  return (
    <div className="ds-stack">
      <Panel>
        <PanelHeader
          icon={<FiMove aria-hidden="true" />}
          eyebrow="Section builder"
          title={isEditing ? 'Edit section boundaries' : 'Bound a new section'}
          subtitle="Drag the rail, type a position, or pick a weld — every route snaps to locked girth welds."
          actions={
            hasRange || isEditing ? (
              <Button variant="ghost" size="sm" startIcon={<FiX aria-hidden="true" />} onClick={onClear}>
                Clear
              </Button>
            ) : undefined
          }
        />

        <PanelBody className="ds-stack">
          <SectionRangeBrush
            boundaries={boundaries}
            sections={sections}
            markers={markers}
            selection={hasRange ? { startIndex: startIndex!, endIndex: endIndex! } : null}
            onSelect={onSelectRange}
            onEditSection={onEditSection}
          />

          {/* Boundary summary — the same three facts wherever the range came from. */}
          <div className="sec-summary">
            <div className="sec-summary__cell">
              <span className="ds-stat__label">Start GW</span>
              <span className="sec-summary__value">{start ? `${start.side} ${start.label}` : '—'}</span>
              <span className="ds-stat__hint">{start ? formatKm(start.newDistance) : 'Not set'}</span>
            </div>
            <div className="sec-summary__cell">
              <span className="ds-stat__label">End GW</span>
              <span className="sec-summary__value">{end ? `${end.side} ${end.label}` : '—'}</span>
              <span className="ds-stat__hint">{end ? formatKm(end.newDistance) : 'Not set'}</span>
            </div>
            <div className="sec-summary__cell">
              <span className="ds-stat__label">Length</span>
              <span className="sec-summary__value">
                {hasRange ? formatKm(end!.newDistance - start!.newDistance) : '—'}
              </span>
              <span className="ds-stat__hint">
                {hasRange ? `${endIndex! - startIndex!} joints` : 'Set both boundaries'}
              </span>
            </div>
            <div className="sec-summary__cell">
              <span className="ds-stat__label">Status</span>
              <span className="sec-summary__value" style={{ fontSize: 'var(--ds-t-sm)' }}>
                {hasRange ? (
                  <Badge tone="success">Ready</Badge>
                ) : startIndex !== null && endIndex !== null ? (
                  <Badge tone="danger">End before start</Badge>
                ) : (
                  <Badge tone="neutral">Incomplete</Badge>
                )}
              </span>
              <span className="ds-stat__hint">{isEditing ? 'Editing an existing section' : 'New section'}</span>
            </div>
          </div>

          <SectionBoundaryInputs
            boundaries={boundaries}
            startIndex={startIndex}
            endIndex={endIndex}
            onSetBoundary={onSetBoundary}
          />

          <div className="sec-draft">
            <Field label="Section name">
              {({ id }) => (
                <Input
                  id={id}
                  value={draft.name}
                  onChange={(event) => onDraftChange({ name: event.target.value })}
                  placeholder="e.g. River crossing 01"
                />
              )}
            </Field>

            <Field label="Physical type">
              {({ id }) => (
                <Select
                  id={id}
                  value={draft.sectionType}
                  onChange={(event) => onDraftChange({ sectionType: event.target.value })}
                >
                  {sectionTypes.map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </Select>
              )}
            </Field>

            <Field label="Policy">
              {({ id }) => (
                <Select
                  id={id}
                  value={draft.policy}
                  onChange={(event) => onDraftChange({ policy: event.target.value as SectionPolicy })}
                >
                  <option value="MATCH">Match</option>
                  <option value="REVIEW">Review</option>
                  <option value="BYPASS">Exclude</option>
                </Select>
              )}
            </Field>

            <Button
              disabled={!readyToSave}
              startIcon={isEditing ? <FiEdit3 aria-hidden="true" /> : <FiCheck aria-hidden="true" />}
              onClick={onSave}
            >
              {isEditing ? 'Save changes' : 'Create section'}
            </Button>
          </div>
        </PanelBody>
      </Panel>

      <AutoSectionPresets
        lockedGws={lockedGws}
        sections={sections}
        features={masterFeatures}
        onApply={onApplyPresets}
      />
    </div>
  );
}
