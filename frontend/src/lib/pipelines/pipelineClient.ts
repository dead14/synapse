import { apiFetch } from '../../utils/api';
import {
  normalizePipelineDossier,
  type PipelineDossier,
  type PipelineRegisterEntry,
  type PipelineSpecification,
} from '../../domain/pipelineSpecification';

function numberOrNull(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeRegisterEntry(value: unknown): PipelineRegisterEntry | null {
  const row = (value ?? {}) as Record<string, unknown>;
  const pipelineId = numberOrNull(row.pipelineId);
  if (pipelineId === null) return null;
  return {
    pipelineId,
    pipelineName: typeof row.pipelineName === 'string' ? row.pipelineName : '',
    recorded: Boolean(row.recorded),
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : null,
    createdAt: typeof row.createdAt === 'string' ? row.createdAt : null,
    runCount: numberOrNull(row.runCount) ?? 0,
    segmentCount: numberOrNull(row.segmentCount) ?? 0,
    lengthKm: numberOrNull(row.lengthKm),
    outerDiameterMm: numberOrNull(row.outerDiameterMm),
    nominalWallThicknessMm: numberOrNull(row.nominalWallThicknessMm),
    smysMpa: numberOrNull(row.smysMpa),
    designFactor: numberOrNull(row.designFactor),
    materialGrade: typeof row.materialGrade === 'string' ? row.materialGrade : null,
    segmentDiameters: Array.isArray(row.segmentDiameters)
      ? row.segmentDiameters.map(numberOrNull).filter((item): item is number => item !== null)
      : [],
  };
}

export async function fetchPipelineRegister(signal?: AbortSignal): Promise<PipelineRegisterEntry[]> {
  const payload = await apiFetch<{ items?: unknown[] }>('/api/pipelines', { signal });
  return (payload.items || [])
    .map(normalizeRegisterEntry)
    .filter((item): item is PipelineRegisterEntry => item !== null);
}

export async function fetchPipelineDossier(
  pipelineId: number,
  signal?: AbortSignal,
): Promise<PipelineDossier | null> {
  const payload = await apiFetch<unknown>(
    `/api/pipelines/${encodeURIComponent(String(pipelineId))}/specification`,
    { signal },
  );
  return normalizePipelineDossier(payload);
}

/**
 * Files the dossier. The whole record is sent, including the segment register,
 * because a half-applied register describes a line that steps from one diameter
 * to another and back to nothing.
 */
export async function savePipelineDossier(
  pipelineId: number,
  specification: PipelineSpecification,
  signal?: AbortSignal,
): Promise<PipelineDossier | null> {
  const payload = await apiFetch<unknown>(
    `/api/pipelines/${encodeURIComponent(String(pipelineId))}/specification`,
    {
      method: 'PUT',
      body: {
        ...specification,
        segments: specification.segments.map(({ id: _id, ...segment }) => segment),
      },
      signal,
    },
  );
  return normalizePipelineDossier(payload);
}
