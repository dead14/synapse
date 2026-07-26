type ExportRow = Record<string, unknown>;

const REPORT_FIELD_MAPPINGS = [
  ['Log Dist NEW (m)', ['Log Dist NEW (m)', 'Abs. Dist NEW (m)']],
  ['Feature Type NEW', ['Feature Type NEW']],
  ['Identif. NEW', ['Identif. NEW', 'feature_new_id']],
  ['Joint No. NEW', ['Joint No. NEW', 'Joint Number NEW']],
  ['Joint Len NEW (m)', ['Joint Len NEW (m)', 'Joint Length NEW (m)']],
  ['Dist GW NEW (m)', ['Dist GW NEW (m)', 'Dist to US GW NEW (m)']],
  ['Wall WT NEW (mm)', ['Wall WT NEW (mm)', 'Wall Thickness NEW (mm)']],
  ["O'Clock NEW", ["O'Clock NEW"]],
  ['Length NEW (mm)', ['Length NEW (mm)']],
  ['Width NEW (mm)', ['Width NEW (mm)']],
  ['Depth NEW (%WT)', ['Depth NEW (%WT)']],
  ['Surface NEW', ['Surface NEW']],
  ['ERF ASME NEW', ['ERF ASME NEW']],
  ['Psafe NEW (bar)', ['Psafe NEW (bar)']],
  ['Comment NEW', ['Comment NEW']],
  ['Log Dist OLD (m)', ['Log Dist OLD (m)', 'Abs. Dist OLD (m)']],
  ['Feature Type OLD', ['Feature Type OLD']],
  ['Identif. OLD', ['Identif. OLD', 'feature_old_id']],
  ['Joint No. OLD', ['Joint No. OLD', 'Joint Number OLD']],
  ['Joint Len OLD (m)', ['Joint Len OLD (m)', 'Joint Length OLD (m)']],
  ['Dist GW OLD (m)', ['Dist GW OLD (m)', 'Dist to US GW OLD (m)']],
  ['Wall WT OLD (mm)', ['Wall WT OLD (mm)', 'Wall Thickness OLD (mm)']],
  ["O'Clock OLD", ["O'Clock OLD"]],
  ['Length OLD (mm)', ['Length OLD (mm)']],
  ['Width OLD (mm)', ['Width OLD (mm)']],
  ['Depth OLD (%WT)', ['Depth OLD (%WT)']],
  ['Surface OLD', ['Surface OLD']],
  ['ERF ASME OLD', ['ERF ASME OLD']],
  ['Psafe OLD (bar)', ['Psafe OLD (bar)']],
  ['Comment OLD', ['Comment OLD']],
  ['Match/Unmatch', ['Match/Unmatch', 'match_status']],
] as const;

function firstReportValue(row: ExportRow, sourceKeys: readonly string[]): unknown {
  for (const sourceKey of sourceKeys) {
    const value = row[sourceKey];
    if (value !== undefined && value !== null && value !== '' && value !== '-') {
      return value;
    }
  }
  return undefined;
}

/**
 * Keep the browser request small by sending only the canonical fields consumed
 * by the server-side workbook generator. The generator already applies the
 * report's NEW / comparison / OLD layout and formula escaping.
 */
export function createExcelExportRows(data: ExportRow[]): ExportRow[] {
  return data.map((sourceRow) => {
    const exportRow: ExportRow = {};
    for (const [reportKey, sourceKeys] of REPORT_FIELD_MAPPINGS) {
      const value = firstReportValue(sourceRow, sourceKeys);
      if (value !== undefined) {
        exportRow[reportKey] = value;
      }
    }
    return exportRow;
  });
}
