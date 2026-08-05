/**
 * The spool review as a workbook an engineer can hand to someone else.
 *
 * The assessment export answers "what did the calculation produce". This one
 * answers "what are we going to do about it, and why" — the document that goes
 * to an operations meeting. So it leads with the decisions, keeps the reasoning
 * in the reader's own words rather than as a code, and carries the full feature
 * detail behind it so nothing has to be taken on trust.
 *
 * Every figure is copied from the spool aggregates, which are themselves copied
 * from the governing member. Nothing is recalculated on the way out: an export
 * that does its own arithmetic is an export that can disagree with the screen.
 */

import * as XLSX from 'xlsx';
import type { FfsConfig, FfsScreenedResult, FfsScreeningConfig } from './types.ts';
import type { FfsReportContext } from './reportCase.ts';
import { formatRemnantLife, remnantLimitLabel } from './lifeProjection.ts';
import { methodProfileLabel, pressureBasisLabel } from './assessmentProfile.ts';
import { safeFilename, triggerDownload } from './exports.ts';
import {
  FFS_REPAIR_OPTIONS,
  repairOptionById,
  suggestSpoolDisposition,
  type FfsSpool,
  type FfsSpoolDisposition,
} from './spoolReview.ts';

const MODE_LABEL: Record<FfsSpoolDisposition['mode'], string> = {
  recommendation: 'Recommended',
  repaired: 'Repaired',
};

const GROUPING_LABEL: Record<FfsSpool['grouping'], string> = {
  'girth-weld': 'Between two girth welds of the run',
  'joint-number': 'Reported joint number',
  'upstream-weld': 'Derived from distance to the upstream GW',
  unassigned: 'Section only - no spool boundary reported',
};

const SEVERITY_LABEL = {
  fail: 'Not acceptable',
  review: 'Review',
  pass: 'Acceptable',
} as const;

function num(value: number | null | undefined, digits = 3): number | string {
  return value !== null && value !== undefined && Number.isFinite(value)
    ? Number(value.toFixed(digits))
    : '';
}

function ld(item: FfsScreenedResult): number {
  const value = Number(item.nominal.ld);
  return Number.isFinite(value) ? Number(value.toFixed(3)) : 0;
}

/** Column widths sized from the header, so nothing arrives as ####. */
function widthsFor(header: string[], min = 10, max = 34): XLSX.ColInfo[] {
  return header.map((label) => ({ wch: Math.min(max, Math.max(min, label.length + 2)) }));
}

function extentText(spool: FfsSpool): string {
  const start = spool.usGwLdM ?? spool.firstFeatureLdM;
  const end = spool.dsGwLdM ?? spool.lastFeatureLdM;
  return `${start.toFixed(1)} – ${end.toFixed(1)}`;
}

export function buildSpoolReviewWorkbook(
  spools: FfsSpool[],
  dispositions: Record<string, FfsSpoolDisposition>,
  config: FfsConfig,
  screening: FfsScreeningConfig,
  reportContext: FfsReportContext,
): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  const decided = spools.filter((spool) => dispositions[spool.id]);
  const repaired = decided.filter((spool) => dispositions[spool.id]?.mode === 'repaired');
  const recommended = decided.filter((spool) => dispositions[spool.id]?.mode === 'recommendation');

  // ── Cover ───────────────────────────────────────────────────────────────
  const cover: (string | number)[][] = [
    ['SPOOL REVIEW AND REPAIR RECOMMENDATION'],
    [config.lineName],
    [],
    ['Assessment basis'],
    ['Method profile', methodProfileLabel(config)],
    ['Required pressure basis', pressureBasisLabel(config)],
    ['ILI inspection date', config.iliDate.toISOString().split('T')[0]],
    ['Report as-of date', reportContext.asOfDateIso],
    ['Remnant life review threshold [years]', config.highlightYears],
    [],
    ['Screening assumptions applied to this review'],
    ['ILI depth tolerance [% WT]', screening.depthTolerancePct],
    ['ILI length tolerance [mm/end]', screening.lengthToleranceMm],
    ['Growth basis', screening.growthBasis === 'measured'
      ? 'Per-feature source evidence (configured rate used only as the fallback)'
      : 'Uniform rate applied to every feature'],
    ['Corrosion growth rate [mm/y]', screening.growthRateMmPerYear],
    ['Review band ERF', screening.reviewBandErf],
    ['Depth rejection limit [% WT]', screening.depthRejectionPct],
    [],
    ['Population'],
    ['Girth-weld spools listed', spools.length],
    ['Spools carrying metal loss', spools.filter((spool) => spool.metalLossTotal > 0).length],
    ['Metal-loss records reported', spools.reduce((total, spool) => total + spool.metalLossTotal, 0)],
    ['Of those, assessed', spools.reduce((total, spool) => total + spool.assessedCount, 0)],
    ['Total metal-loss axial length [mm]', num(spools.reduce((total, spool) => total + spool.totalMetalLossLengthMm, 0), 0)],
    ['Spools not acceptable', spools.filter((spool) => spool.severity === 'fail').length],
    ['Spools in the review band', spools.filter((spool) => spool.severity === 'review').length],
    ['Spools with a recommendation', recommended.length],
    ['Spools recorded as repaired', repaired.length],
    ['Spools with no record yet', spools.length - decided.length],
    [],
    ['Reading this document'],
    ['A spool is one length of pipe between two girth welds. A repair is made to a spool, not to a feature, so'],
    ['the ERF, remnant life and corrosion rate quoted for a spool are those of the single feature that governs it.'],
    ['That feature is named on every row, and its full calculation is on the Feature detail sheet.'],
    [],
    ['A recommendation is what should be done. It carries no date, no capacity credit, and removes no feature from'],
    ['the assessed population. Only a spool recorded as repaired, with a completion date and an evidence reference,'],
    ['changes the population - and only when the repair is permanent and verified.'],
    [],
    ['This is an engineering calculation record. Final disposition requires an approved procedure and independent checking.'],
    ['Generated', new Date().toISOString()],
  ];
  const coverSheet = XLSX.utils.aoa_to_sheet(cover);
  coverSheet['!cols'] = [{ wch: 46 }, { wch: 62 }];
  coverSheet['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 1 } },
  ];
  XLSX.utils.book_append_sheet(workbook, coverSheet, 'Cover');

  // ── Spool register ──────────────────────────────────────────────────────
  const registerHeader = [
    'Spool', 'U/S girth weld', 'D/S girth weld', 'Joint no.', 'Section', 'Boundary source',
    'Extent [m]', 'Joint length [m]',
    'Metal loss reported', 'Assessed', 'Not released', 'Total ML length [mm]',
    'Total ML footprint [mm2]', 'ML coverage of joint [%]',
    'Clusters', 'Internal', 'External',
    'Max depth [%WT]', 'Mean depth [%WT]', 'Longest feature [mm]',
    'Governing feature', 'Governing ERF', 'ERF with tolerance', 'Not acceptable',
    'Shortest remnant life', 'Life limited by', 'Due date',
    'Mean CR depth [mm/y]', 'Worst CR depth [mm/y]', 'Rates observed', 'Rates assumed', 'No rate',
    'Interacting pairs', 'Result',
    'Record', 'Method', 'Method class', 'Repair kind', 'Completion date', 'Evidence reference',
    'Owner', 'Features in record', 'Justification / notes',
    'Suggested method', 'Suggestion basis',
  ];
  const registerRows = spools.map((spool) => {
    const disposition = dispositions[spool.id] ?? null;
    const option = repairOptionById(disposition?.optionId ?? null);
    const suggestion = suggestSpoolDisposition(spool, screening, config.highlightYears);
    const life = spool.governingLife?.nominal.remnantLife ?? null;
    return [
      spool.label,
      spool.usGwId ?? '',
      spool.dsGwId ?? '',
      spool.jointNumber ?? '',
      spool.section,
      GROUPING_LABEL[spool.grouping],
      extentText(spool),
      num(spool.lengthM, 2),
      spool.metalLossTotal,
      spool.assessedCount,
      spool.unassessedCount,
      num(spool.totalMetalLossLengthMm, 0),
      num(spool.totalMetalLossAreaMm2, 0),
      num(spool.metalLossCoveragePct, 2),
      spool.clusterCount,
      spool.internalCount,
      spool.externalCount,
      num(spool.maxDepthPct, 1),
      num(spool.meanDepthPct, 1),
      num(spool.longestFeatureMm, 0),
      spool.governingErf?.nominal.featureId ?? '',
      num(spool.worstNominalErf, 4),
      num(spool.worstConservativeErf, 4),
      spool.unacceptableCount,
      life ? formatRemnantLife(life) : 'Not established',
      life ? remnantLimitLabel(life) : '',
      life?.dueDateIso ?? '',
      num(spool.growth.meanMmPerYear, 4),
      num(spool.growth.maxMmPerYear, 4),
      spool.growth.measuredCount,
      spool.growth.assumedCount,
      spool.growth.unavailableCount,
      spool.interactionCount,
      SEVERITY_LABEL[spool.severity],
      disposition ? MODE_LABEL[disposition.mode] : 'No record',
      option?.label ?? '',
      option ? (option.repairClass === 'permanent' ? 'Permanent' : option.repairClass === 'temporary' ? 'Temporary' : 'No intervention') : '',
      disposition?.mode === 'repaired'
        ? (disposition.repairKind === 'permanent-repair-verified' ? 'Permanent, verified' : 'Temporary')
        : '',
      disposition?.mode === 'repaired' ? disposition.completedDateIso ?? '' : '',
      disposition?.mode === 'repaired' ? disposition.evidenceReference ?? '' : '',
      disposition?.owner ?? '',
      disposition ? disposition.memberIndexes.length : '',
      disposition?.justification ?? '',
      repairOptionById(suggestion.optionId)?.label ?? '',
      suggestion.reason,
    ];
  });
  const registerSheet = XLSX.utils.aoa_to_sheet([registerHeader, ...registerRows]);
  registerSheet['!cols'] = widthsFor(registerHeader, 11, 40);
  registerSheet['!freeze'] = { xSplit: 1, ySplit: 1 };
  registerSheet['!autofilter'] = {
    ref: XLSX.utils.encode_range({
      s: { r: 0, c: 0 },
      e: { r: registerRows.length, c: registerHeader.length - 1 },
    }),
  };
  XLSX.utils.book_append_sheet(workbook, registerSheet, 'Spool register');

  // ── Repair plan ─────────────────────────────────────────────────────────
  const planHeader = [
    'Priority', 'Spool', 'Section', 'Extent [m]', 'Metal loss reported', 'Record', 'Method', 'Method class',
    'What the method does', 'Repair kind', 'Completion date', 'Evidence reference', 'Owner',
    'Governing ERF', 'ERF with tolerance', 'Shortest remnant life', 'Due date',
    'Features in record', 'Metal loss on spool', 'Justification / notes',
  ];
  const planRows = [...decided]
    // Outstanding recommendations first and worst first: the sheet is a work
    // list, and a spool already repaired is not work anyone has left to do.
    .sort((left, right) => {
      const leftOpen = dispositions[left.id]?.mode === 'recommendation' ? 0 : 1;
      const rightOpen = dispositions[right.id]?.mode === 'recommendation' ? 0 : 1;
      return leftOpen - rightOpen || right.worstConservativeErf - left.worstConservativeErf;
    })
    .map((spool, index) => {
      const disposition = dispositions[spool.id]!;
      const option = repairOptionById(disposition.optionId);
      const life = spool.governingLife?.nominal.remnantLife ?? null;
      const isRepaired = disposition.mode === 'repaired';
      return [
        index + 1,
        spool.label,
        spool.section,
        extentText(spool),
        spool.metalLossTotal,
        MODE_LABEL[disposition.mode],
        option?.label ?? 'Not selected',
        option ? (option.repairClass === 'permanent' ? 'Permanent' : option.repairClass === 'temporary' ? 'Temporary' : 'No intervention') : '',
        option?.note ?? '',
        isRepaired
          ? (disposition.repairKind === 'permanent-repair-verified' ? 'Permanent, verified' : 'Temporary')
          : '',
        isRepaired ? disposition.completedDateIso ?? '' : '',
        isRepaired ? disposition.evidenceReference ?? '' : '',
        disposition.owner ?? '',
        num(spool.worstNominalErf, 4),
        num(spool.worstConservativeErf, 4),
        life ? formatRemnantLife(life) : 'Not established',
        life?.dueDateIso ?? '',
        disposition.memberIndexes.length,
        spool.metalLossTotal,
        disposition.justification ?? '',
      ];
    });
  const planSheet = XLSX.utils.aoa_to_sheet(
    planRows.length > 0
      ? [planHeader, ...planRows]
      : [planHeader, ['', 'No spool record has been made yet.']],
  );
  planSheet['!cols'] = widthsFor(planHeader, 12, 48);
  planSheet['!freeze'] = { xSplit: 2, ySplit: 1 };
  XLSX.utils.book_append_sheet(workbook, planSheet, 'Repair plan');

  // ── Basis of judgement ──────────────────────────────────────────────────
  const basisHeader = ['Spool', 'Result', 'Point', 'Finding'];
  const basisRows = spools.flatMap((spool) => spool.drivers.map((driver, index) => [
    index === 0 ? spool.label : '',
    index === 0 ? SEVERITY_LABEL[spool.severity] : '',
    index + 1,
    driver,
  ]));
  const basisSheet = XLSX.utils.aoa_to_sheet([basisHeader, ...basisRows]);
  basisSheet['!cols'] = [{ wch: 30 }, { wch: 16 }, { wch: 7 }, { wch: 130 }];
  basisSheet['!freeze'] = { xSplit: 1, ySplit: 1 };
  XLSX.utils.book_append_sheet(workbook, basisSheet, 'Basis of judgement');

  // ── Feature detail ──────────────────────────────────────────────────────
  const featureHeader = [
    'Spool', 'In spool record', 'Feature ID', 'LD [m]', 'Clock', 'Surface', 'Clustered',
    'Depth [%WT]', 'Length [mm]', 'Width [mm]', 'Wall [mm]',
    'd/t', 'z', 'M', 'S_flow [MPa]', 'S_f [MPa]', 'P_f [MPa]', 'Safety factor',
    'Safe pressure [MPa]', 'Required P0 [MPa]', 'ERF', 'ERF with tolerance', 'Acceptance',
    'CR depth [mm/y]', 'CR length [mm/y]', 'Remnant life', 'Life limited by', 'Due date',
    'Repair status', 'Repair method', 'Repair date', 'Evidence', 'Recommendation', 'Owner',
  ];
  const featureRows = spools.flatMap((spool) => {
    const inDecision = new Set(dispositions[spool.id]?.memberIndexes ?? []);
    return spool.members.map((member) => {
      const n = member.nominal;
      return [
        spool.label,
        dispositions[spool.id] ? (inDecision.has(member.index) ? 'Yes' : 'No') : '',
        n.featureId ?? `Row ${member.index + 1}`,
        ld(member),
        n.orient ?? '',
        n.surface ?? '',
        n.isClusteredMetalLoss ? 'Yes' : 'No',
        num(n.maxDepthPct, 1),
        num(n.length, 1),
        num(n.width, 1),
        num(n.wall, 2),
        num(n.dt, 4),
        num(n.z, 4),
        n.M === null ? '' : num(n.M, 4),
        num(n.sflow, 2),
        num(n.Sf, 2),
        num(n.Pf, 4),
        num(n.SF, 3),
        num(n.safePressure, 4),
        num(n.p0, 4),
        num(n.ERF, 4),
        num(member.conservative.ERF, 4),
        n.acceptance,
        num(n.crDepth, 4),
        num(n.crLength, 4),
        formatRemnantLife(n.remnantLife),
        remnantLimitLabel(n.remnantLife),
        n.remnantLife.dueDateIso ?? '',
        n.repairStatus,
        n.repairMethod ?? '',
        n.repairDate ?? '',
        n.repairReference ?? '',
        n.recommendation ?? '',
        n.actionOwner ?? '',
      ];
    });
  });
  const featureSheet = XLSX.utils.aoa_to_sheet([featureHeader, ...featureRows]);
  featureSheet['!cols'] = widthsFor(featureHeader, 10, 30);
  featureSheet['!freeze'] = { xSplit: 3, ySplit: 1 };
  featureSheet['!autofilter'] = {
    ref: XLSX.utils.encode_range({
      s: { r: 0, c: 0 },
      e: { r: featureRows.length, c: featureHeader.length - 1 },
    }),
  };
  XLSX.utils.book_append_sheet(workbook, featureSheet, 'Feature detail');

  // ── Method reference ────────────────────────────────────────────────────
  const methodHeader = ['Method', 'Class', 'When it is the right answer'];
  const methodSheet = XLSX.utils.aoa_to_sheet([
    methodHeader,
    ...FFS_REPAIR_OPTIONS.map((option) => [
      option.label,
      option.repairClass === 'permanent' ? 'Permanent' : option.repairClass === 'temporary' ? 'Temporary' : 'No intervention',
      option.note,
    ]),
    [],
    ['Only a permanent repair with completed, dated evidence removes a feature from the assessed population.'],
    ['A temporary repair keeps the feature active in every figure in this workbook.'],
  ]);
  methodSheet['!cols'] = [{ wch: 48 }, { wch: 18 }, { wch: 120 }];
  methodSheet['!freeze'] = { xSplit: 0, ySplit: 1 };
  XLSX.utils.book_append_sheet(workbook, methodSheet, 'Method reference');

  return workbook;
}

export function exportSpoolReviewWorkbook(
  spools: FfsSpool[],
  dispositions: Record<string, FfsSpoolDisposition>,
  config: FfsConfig,
  screening: FfsScreeningConfig,
  reportContext: FfsReportContext,
): void {
  const workbook = buildSpoolReviewWorkbook(spools, dispositions, config, screening, reportContext);
  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  triggerDownload(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `${safeFilename(config.lineName)}-spool-review-${reportContext.asOfDateIso}.xlsx`,
  );
}
