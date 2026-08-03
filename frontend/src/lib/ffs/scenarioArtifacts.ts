import * as XLSX from 'xlsx';

import { pressureBasisLabel } from './assessmentProfile.ts';
import { evaluateFfsScenario, scenarioInputsForPreset, type FfsScenarioEvaluation, type FfsScenarioInputs } from './scenarioLab.ts';
import type { FfsConfig, FfsResult, FfsScreeningConfig, FfsSeverity } from './types.ts';

export interface FfsScenarioForecastPoint {
  yearOffset: number;
  erf: number;
  safePressureMpa: number;
  failurePressureMpa: number;
  depthPct: number;
  severity: FfsSeverity;
  valid: boolean;
}

export interface FfsScenarioForecastSeries {
  id: 'as-reported' | 'conservative' | 'draft';
  label: string;
  points: FfsScenarioForecastPoint[];
}

function comparisonYears(horizonYears: number): number[] {
  const years = Array.from({ length: Math.floor(horizonYears) + 1 }, (_, index) => index);
  if (years.at(-1) !== horizonYears) years.push(horizonYears);
  return years;
}

export function buildScenarioForecastComparison(
  nominal: FfsResult,
  config: FfsConfig,
  screening: FfsScreeningConfig,
  draftInputs: FfsScenarioInputs,
): FfsScenarioForecastSeries[] {
  const horizonYears = Math.min(
    nominal.analysisHorizonYears,
    Math.max(1, screening.forecastYears, draftInputs.forecastYears),
  );
  const years = comparisonYears(horizonYears);
  const definitions: Array<{
    id: FfsScenarioForecastSeries['id'];
    label: string;
    inputs: FfsScenarioInputs;
  }> = [
    {
      id: 'as-reported',
      label: 'As reported',
      inputs: scenarioInputsForPreset('as-reported', nominal, screening),
    },
    {
      id: 'conservative',
      label: 'Conservative',
      inputs: scenarioInputsForPreset('conservative', nominal, screening),
    },
    { id: 'draft', label: 'Draft scenario', inputs: draftInputs },
  ];

  return definitions.map((definition) => ({
    id: definition.id,
    label: definition.label,
    points: years.map((yearOffset) => {
      const result = evaluateFfsScenario(nominal, config, screening, {
        ...definition.inputs,
        forecastYears: yearOffset,
      });
      return {
        yearOffset,
        erf: result.erf,
        safePressureMpa: result.safePressureMpa,
        failurePressureMpa: result.failurePressureMpa,
        depthPct: result.depthPct,
        severity: result.severity,
        valid: result.valid && !result.beyondDepthLimit,
      };
    }),
  }));
}

export interface FfsScenarioSnapshot {
  version: 1;
  id: string;
  featureKey: string;
  featureId: string | null;
  author: string;
  reason: string;
  createdAtIso: string;
  method: string;
  pressureBasis: string;
  inputs: FfsScenarioInputs;
  official: {
    requiredPressureMpa: number;
    failurePressureMpa: number;
    safePressureMpa: number;
    erf: number;
  };
  outcome: Pick<
    FfsScenarioEvaluation,
    | 'depthPct'
    | 'lengthMm'
    | 'failurePressureMpa'
    | 'safePressureMpa'
    | 'erf'
    | 'capacityMarginMpa'
    | 'severity'
    | 'limitYears'
    | 'limitStatus'
    | 'limitCriterion'
    | 'valid'
    | 'beyondDepthLimit'
  >;
}

interface ScenarioSnapshotInput {
  id: string;
  featureKey: string;
  featureId: string | null;
  author: string;
  reason: string;
  createdAtIso: string;
  inputs: FfsScenarioInputs;
  evaluation: FfsScenarioEvaluation;
  nominal: FfsResult;
  config: FfsConfig;
}

function requiredText(label: string, value: string, maximum: number): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${label} is required.`);
  if (normalized.length > maximum) throw new TypeError(`${label} cannot exceed ${maximum} characters.`);
  return normalized;
}

export function createScenarioSnapshot(input: ScenarioSnapshotInput): FfsScenarioSnapshot {
  const author = requiredText('Author', input.author, 160);
  const reason = requiredText('Reason', input.reason, 500);
  const id = requiredText('Snapshot id', input.id, 160);
  const featureKey = requiredText('Feature key', input.featureKey, 160);
  const createdAt = new Date(input.createdAtIso);
  if (!Number.isFinite(createdAt.getTime())) throw new TypeError('Created time must be a valid ISO timestamp.');

  return {
    version: 1,
    id,
    featureKey,
    featureId: input.featureId?.trim() || null,
    author,
    reason,
    createdAtIso: createdAt.toISOString(),
    method: input.config.method === 'original' ? 'Original B31G' : 'Modified B31G',
    pressureBasis: pressureBasisLabel(input.config),
    inputs: { ...input.inputs },
    official: {
      requiredPressureMpa: input.nominal.p0,
      failurePressureMpa: input.nominal.Pf,
      safePressureMpa: input.nominal.safePressure,
      erf: input.nominal.ERF,
    },
    outcome: {
      depthPct: input.evaluation.depthPct,
      lengthMm: input.evaluation.lengthMm,
      failurePressureMpa: input.evaluation.failurePressureMpa,
      safePressureMpa: input.evaluation.safePressureMpa,
      erf: input.evaluation.erf,
      capacityMarginMpa: input.evaluation.capacityMarginMpa,
      severity: input.evaluation.severity,
      limitYears: input.evaluation.limitYears,
      limitStatus: input.evaluation.limitStatus,
      limitCriterion: input.evaluation.limitCriterion,
      valid: input.evaluation.valid,
      beyondDepthLimit: input.evaluation.beyondDepthLimit,
    },
  };
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function storageKey(featureKey: string): string {
  return `synapse.ffs.scenarios.${featureKey}`;
}

function isScenarioSnapshot(value: unknown, featureKey: string): value is FfsScenarioSnapshot {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<FfsScenarioSnapshot>;
  return candidate.version === 1
    && candidate.featureKey === featureKey
    && typeof candidate.id === 'string'
    && typeof candidate.author === 'string'
    && typeof candidate.reason === 'string'
    && typeof candidate.createdAtIso === 'string'
    && !!candidate.inputs
    && !!candidate.official
    && !!candidate.outcome;
}

export function loadScenarioSnapshots(storage: StorageLike, featureKey: string): FfsScenarioSnapshot[] {
  try {
    const raw = storage.getItem(storageKey(featureKey));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is FfsScenarioSnapshot => isScenarioSnapshot(entry, featureKey));
  } catch {
    return [];
  }
}

export function saveScenarioSnapshots(
  storage: StorageLike,
  featureKey: string,
  snapshots: FfsScenarioSnapshot[],
): void {
  const valid = snapshots.filter((snapshot) => isScenarioSnapshot(snapshot, featureKey)).slice(0, 20);
  storage.setItem(storageKey(featureKey), JSON.stringify(valid));
}

export function scenarioSnapshotsWorkbook(snapshots: FfsScenarioSnapshot[]): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  const rows = snapshots.map((snapshot) => ({
    'Snapshot ID': snapshot.id,
    'Feature key': snapshot.featureKey,
    'Feature ID': snapshot.featureId ?? '',
    Author: snapshot.author,
    'Created at UTC': snapshot.createdAtIso,
    Reason: snapshot.reason,
    Method: snapshot.method,
    'Pressure basis': snapshot.pressureBasis,
    'Required pressure scenario [MPa]': snapshot.inputs.requiredPressureMpa,
    'Depth CGR [mm/y]': snapshot.inputs.depthGrowthRateMmPerYear,
    'Axial CGR [mm/y]': snapshot.inputs.lengthGrowthRateMmPerYear,
    'Projection [years]': snapshot.inputs.forecastYears,
    'ILI tolerance applied': snapshot.inputs.applyConfiguredTolerance ? 'Yes' : 'No',
    'Official ERF': snapshot.official.erf,
    'Scenario ERF': snapshot.outcome.erf,
    'Scenario safe pressure [MPa]': snapshot.outcome.safePressureMpa,
    'Scenario failure pressure [MPa]': snapshot.outcome.failurePressureMpa,
    'Scenario depth [% WT]': snapshot.outcome.depthPct,
    'Scenario status': snapshot.outcome.severity,
    'First limit [years]': snapshot.outcome.limitYears ?? '',
    'Limit criterion': snapshot.outcome.limitCriterion ?? snapshot.outcome.limitStatus,
    'B31G result valid': snapshot.outcome.valid && !snapshot.outcome.beyondDepthLimit ? 'Yes' : 'No',
  }));
  const sheet = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, 'Scenario snapshots');
  return workbook;
}

export function downloadScenarioSnapshots(
  snapshots: FfsScenarioSnapshot[],
  filename: string,
): void {
  const workbook = scenarioSnapshotsWorkbook(snapshots);
  const blob = new Blob([XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${filename.replace(/[^\w.-]+/g, '_').slice(0, 80) || 'ffs'}_scenario_snapshots.xlsx`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
