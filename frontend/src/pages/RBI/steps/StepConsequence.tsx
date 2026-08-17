/**
 * Step 3 — Consequence.
 *
 * Three dropdowns for the line, and an override for the sections where the
 * surroundings change. The overrides are the part that matters on a pipeline: a
 * line runs remote for forty kilometres and then crosses a river, a road and a
 * village, and one category for the whole thing ranks none of them.
 */

import { FiPlus } from 'react-icons/fi';

import { Badge, Button, Callout, MathBlock } from '../../../components/ds';
import { RBI_TEX } from '../../../lib/rbi/notation';
import {
  BUSINESS_OPTIONS,
  ENVIRONMENT_OPTIONS,
  POPULATION_OPTIONS,
} from '../../../lib/rbi/catalogues';
import { emptyOverride } from '../../../lib/rbi/record';
import {
  DerivedValue,
  EmptyState,
  FieldGrid,
  NoteField,
  PickField,
  StepPanel,
} from '../RbiControls';
import type { StepProps } from '../stepProps';
import type { Option } from '../../../lib/rbi/catalogues';
import type {
  EnvironmentClass,
  PopulationClass,
  RiskCategory,
  SectionOverride,
} from '../../../lib/rbi/types';

const CATEGORY_TONE: Record<RiskCategory, 'success' | 'warning' | 'danger'> = {
  1: 'success',
  2: 'success',
  3: 'warning',
  4: 'danger',
  5: 'danger',
};

const POPULATION_OR_DEFAULT: readonly Option<PopulationClass | 'default'>[] = [
  { value: 'default', label: 'Line default' },
  ...POPULATION_OPTIONS.map((option) => ({ value: option.value, label: option.label })),
];

const ENVIRONMENT_OR_DEFAULT: readonly Option<EnvironmentClass | 'default'>[] = [
  { value: 'default', label: 'Line default' },
  ...ENVIRONMENT_OPTIONS.map((option) => ({ value: option.value, label: option.label })),
];

export default function StepConsequence({ record, update, assessment }: StepProps) {
  const set = <K extends keyof typeof record>(key: K, value: (typeof record)[K]) => {
    update((current) => ({ ...current, [key]: value }));
  };
  const setOverrides = (overrides: SectionOverride[]) => {
    update((current) => ({ ...current, overrides }));
  };
  const patchOverride = (sectionId: string, change: Partial<SectionOverride>) => {
    setOverrides(record.overrides.map((row) => (
      row.sectionId === sectionId ? { ...row, ...change } : row
    )));
  };

  const overridden = new Set(record.overrides.map((row) => row.sectionId));
  const available = (assessment?.sections ?? []).filter((section) => !overridden.has(section.id));

  return (
    <>
      <StepPanel
        title="Line default"
        blurb="What a release would reach along most of the line. Nothing in an inspection file knows this, so
          it is entered — and reported as entered."
      >
        <FieldGrid columns={3}>
          <PickField
            label="Population exposure"
            value={record.population}
            options={POPULATION_OPTIONS}
            onChange={(value) => set('population', value)}
          />
          <PickField
            label="Environmental receptor"
            value={record.environment}
            options={ENVIRONMENT_OPTIONS}
            onChange={(value) => set('environment', value)}
          />
          <PickField
            label="Business impact"
            value={record.businessImpact}
            options={BUSINESS_OPTIONS}
            onChange={(value) => set('businessImpact', value)}
          />
        </FieldGrid>

        <Callout tone="info" title="Safety needs both a hazardous fluid and somebody near it">
          The safety consequence is the fluid hazard bounded by the exposure, not the worse of the two — a
          water main under a city centre is not a catastrophic safety event, and crude oil forty kilometres
          from a road is not one either. Exposure never falls below the responder who has to walk up to it.
          {/* The distinction the paragraph above is making is a min against a
              max, and it is the one rule on this page a reviewer will want to
              check character by character before signing the ranking. */}
          <MathBlock tex={RBI_TEX.safety} label="safety is the lower of fluid hazard and exposure" />
          <MathBlock tex={RBI_TEX.exposure} label="exposure is the greater of population and responder" />
        </Callout>

        <MathBlock tex={RBI_TEX.consequence} label="consequence rule" />
        <MathBlock tex={RBI_TEX.releaseScale} label="release scale from diameter and pressure" />
        <p className="rbi-check__hint">
          The three components are scored separately because they are reduced by completely different
          actions: a safety consequence by moving people or shortening the release, a business one by
          building a spare. The last bracket is one where the stored energy reaches 3 and zero
          otherwise — a large high-pressure line empties faster into all three.
        </p>

        {assessment && assessment.sections[0] && (
          <FieldGrid columns={2}>
            {assessment.sections[0].consequence.drivers.map((driver) => (
              <DerivedValue
                key={driver.id}
                label={driver.label}
                value={driver.category}
                source={driver.basis}
              />
            ))}
          </FieldGrid>
        )}
      </StepPanel>

      <StepPanel
        title="Section overrides"
        blurb="Where a stretch differs from the default. Crossings, populated stretches, protected land."
        actions={available.length > 0 && (
          <Button
            variant="secondary"
            size="sm"
            startIcon={<FiPlus />}
            onClick={() => setOverrides([...record.overrides, emptyOverride(available[0].id)])}
          >
            Override a section
          </Button>
        )}
      >
        {!assessment && (
          <EmptyState>
            Sections come from the filed assessment. Attach one on the first step to override any of them.
          </EmptyState>
        )}

        {assessment && record.overrides.length === 0 && (
          <EmptyState>
            No overrides; the line default applies throughout. Correct for a line whose surroundings genuinely
            do not change — worth a second look for one that crosses anything.
          </EmptyState>
        )}

        {record.overrides.map((row) => {
          const section = assessment?.sections.find((item) => item.id === row.sectionId) ?? null;
          const sectionOptions: readonly Option[] = [
            section
              ? { value: section.id, label: section.label }
              : { value: row.sectionId, label: `${row.sectionId} (not in the current assessment)` },
            ...available.map((item) => ({ value: item.id, label: item.label })),
          ];

          return (
            <div key={row.sectionId} className="rbi-row-card">
              <div className="rbi-row-card__head">
                <div className="rbi-row-card__title">{section?.label ?? row.sectionId}</div>
                {section
                  ? (
                    <Badge tone={CATEGORY_TONE[section.consequence.category]} pill>
                      consequence {section.consequence.category}
                    </Badge>
                  )
                  : <Badge tone="warning" pill>orphaned</Badge>}
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setOverrides(
                    record.overrides.filter((item) => item.sectionId !== row.sectionId),
                  )}
                >
                  Remove
                </Button>
              </div>
              <div className="rbi-row-card__body">
                {!section && (
                  <Callout tone="warning" title="This section is not in the current assessment">
                    The override is kept — re-running the alignment may bring the section back — but it is
                    affecting nothing right now.
                  </Callout>
                )}
                <FieldGrid columns={3}>
                  <PickField
                    label="Section"
                    value={row.sectionId}
                    options={sectionOptions}
                    onChange={(value) => patchOverride(row.sectionId, { sectionId: value })}
                  />
                  <PickField
                    label="Population exposure"
                    value={row.population ?? 'default'}
                    options={POPULATION_OR_DEFAULT}
                    onChange={(value) => patchOverride(row.sectionId, {
                      population: value === 'default' ? null : value,
                    })}
                  />
                  <PickField
                    label="Environmental receptor"
                    value={row.environment ?? 'default'}
                    options={ENVIRONMENT_OR_DEFAULT}
                    onChange={(value) => patchOverride(row.sectionId, {
                      environment: value === 'default' ? null : value,
                    })}
                  />
                  <div className="rbi-grid__full">
                    <NoteField
                      label="Why this section differs"
                      value={row.note}
                      onChange={(value) => patchOverride(row.sectionId, { note: value })}
                      placeholder="e.g. Crosses the river and a village at KP 34.2."
                    />
                  </div>
                </FieldGrid>
              </div>
            </div>
          );
        })}
      </StepPanel>
    </>
  );
}
