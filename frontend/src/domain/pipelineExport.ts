/**
 * The pipeline dossier flattened for the alignment Excel export.
 *
 * The workbook's Data Pipeline sheet is a two-column field/value list, so the
 * register has to be flattened into numbered rows. Keys here are matched by
 * `python_engines/export_excel.py`; renaming one without renaming it there
 * leaves a blank cell rather than an error, so the two lists stay together.
 */

import type { PipelineSpecification } from './pipelineSpecification.ts';

export type PipelineExportFields = Record<string, string | number | null>;

function rounded(value: number | null, decimals: number): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(decimals));
}

export function pipelineExportFields(
  specification: PipelineSpecification,
): PipelineExportFields {
  const fields: PipelineExportFields = {
    environment: specification.environment,
    productMedium: specification.productMedium,
    lengthKm: specification.lengthKm,
    locationClass: specification.locationClass,
    installationYear: specification.installationYear,
    commissioningYear: specification.commissioningYear,
    designLifeYears: specification.designLifeYears,
    outerDiameterMm: rounded(specification.outerDiameterMm, 3),
    nominalWtMm: rounded(specification.nominalWallThicknessMm, 3),
    smysMpa: rounded(specification.smysMpa, 3),
    designFactor: specification.designFactor,
    materialGrade: specification.materialGrade,
    seamType: specification.seamType,
    externalCoating: specification.externalCoating,
    maopMpa: rounded(specification.maopMpa, 4),
    designPressureMpa: rounded(specification.designPressureMpa, 4),
    operatingPressureMpa: rounded(specification.operatingPressureMpa, 4),
    internalDesignPressureMpa: rounded(specification.internalDesignPressureMpa, 4),
    weldJointFactor: specification.weldJointFactor,
    yieldToTensileRatio: specification.yieldToTensileRatio,
    segmentCount: specification.segments.length,
  };

  specification.segments.forEach((segment, index) => {
    const position = index + 1;
    fields[`segment${position}Label`] = segment.label;
    fields[`segment${position}Range`] = [
      segment.startM === null ? 'start' : `${segment.startM} m`,
      segment.endM === null ? 'end' : `${segment.endM} m`,
    ].join(' – ');
    fields[`segment${position}OuterDiameterMm`] = rounded(segment.outerDiameterMm, 3);
    fields[`segment${position}NominalWtMm`] = rounded(segment.nominalWallThicknessMm, 3);
    fields[`segment${position}SmysMpa`] = rounded(segment.smysMpa, 3);
    fields[`segment${position}DesignFactor`] = segment.designFactor;
    fields[`segment${position}MaterialGrade`] = segment.materialGrade;
  });

  return fields;
}
