type UnknownRecord = Record<string, any>;

function numeric(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function runRows(run: UnknownRecord | undefined): number {
  return numeric(
    run?.totalRecords
      ?? run?.total
      ?? run?.rowCount
      ?? run?.records?.length
      ?? run?.data?.length,
  );
}

export function executionContextLines(config: UnknownRecord): string[] {
  const summary = config?.summaryData || {};
  const master = summary.masterRun || summary.newRun;
  const historical = Array.isArray(summary.historicalRuns)
    ? summary.historicalRuns
    : summary.oldRun ? [summary.oldRun] : [];
  const runs = [master, ...historical].filter(Boolean);
  const totalRows = runs.reduce((total, run) => total + runRows(run), 0);
  const tolerances = config?.ToleranceConfig || {};
  const algorithm = config?.algorithm || summary?.algorithm || 'dtw_hungarian';

  return [
    `RUN  Session: ${config?.sessionName || master?.name || `#${config?.sessionId || 'pending'}`}`,
    `DATA ${runs.length || 0} inspection run(s), ${totalRows.toLocaleString()} source rows registered`,
    `MODE ${algorithm}; ${Math.max(runs.length - 1, 1)} comparison pair(s)`,
    `RULE Clock ${numeric(tolerances.clock_tolerance)}° | D/S GW ±${numeric(tolerances.ds_gw_distance_tolerance)} m | Length ±${numeric(tolerances.length_tolerance)} mm`,
    'SAFE Source-key conservation will be checked before results are released',
  ];
}

function auditLine(audit: UnknownRecord | undefined): string {
  if (!audit) return 'AUDIT Conservation evidence is available on the result dashboard';
  if (Array.isArray(audit.pairs)) {
    const conserved = audit.pairs.filter((pair: UnknownRecord) => pair?.isConserved).length;
    return `AUDIT ${conserved}/${audit.pairs.length} run-pair conservation checks passed`;
  }
  const oldAudit = audit.old || {};
  const newAudit = audit.new || {};
  const verdict = audit.isConserved ? 'PASS' : 'REVIEW';
  return `AUDIT ${verdict} · OLD ${numeric(oldAudit.outputReferences)}/${numeric(oldAudit.inputCount)} · NEW ${numeric(newAudit.outputReferences)}/${numeric(newAudit.inputCount)}`;
}

export function executionResultLines(result: UnknownRecord | undefined): string[] {
  const rows = Array.isArray(result?.comparison) ? result.comparison : [];
  const counts = new Map<string, number>();
  for (const row of rows) {
    const status = String(row?.['Match/Unmatch'] ?? row?.match_status ?? 'Unclassified');
    counts.set(status, (counts.get(status) || 0) + 1);
  }
  const summary = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([status, count]) => `${status} ${count.toLocaleString()}`)
    .join(' · ');

  return [
    `RESULT ${rows.length.toLocaleString()} result rows assembled from engine output`,
    `MATCH ${summary || 'No comparison rows returned'}`,
    auditLine(result?.groups?.audit),
    `ENGINE ${result?.engineVersion || 'version recorded by server'} · fingerprint ${result?.configFingerprint || 'available in session evidence'}`,
  ];
}
