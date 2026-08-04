import { FiAlertTriangle, FiCheckCircle, FiClock, FiTool, FiXCircle } from 'react-icons/fi';
import {
  buildExecutiveSummary,
  formatPipelineRemnantLife,
  formatPressure,
  verdictSentence,
  type FfsExecutiveSummary as Summary,
  type FfsFeatureHighlight,
} from '../../lib/ffs/executiveSummary';
import type { FfsReportContext } from '../../lib/ffs/reportCase';
import { DEFAULT_DEPTH_BUCKETS } from '../../lib/ffs/statistics';
import type { FfsConfig, FfsScreenedResult, FfsScreeningConfig } from '../../lib/ffs/types';
import { useMemo } from 'react';

/**
 * The report's headline figures, beside the narrative rather than inside it.
 *
 * The narrative reads top to bottom; this does not. It is the panel an engineer
 * keeps in view while reading the document, and the one a reviewer scans before
 * deciding whether to read the document at all.
 */

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
      {children}
    </p>
  );
}

function Figure({
  label,
  value,
  foot,
  tone = 'neutral',
  onClick,
}: {
  label: string;
  value: string;
  foot?: string;
  tone?: 'neutral' | 'good' | 'warn' | 'bad';
  onClick?: () => void;
}) {
  const toneClass = {
    neutral: 'text-slate-900 dark:text-slate-50',
    good: 'text-emerald-600 dark:text-emerald-400',
    warn: 'text-amber-600 dark:text-amber-400',
    bad: 'text-rose-600 dark:text-rose-400',
  }[tone];

  const body = (
    <>
      <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </span>
      <span className={`mt-0.5 block text-[15px] font-bold leading-tight tabular-nums ${toneClass}`}>
        {value}
      </span>
      {foot && (
        <span className="mt-0.5 block text-[10px] leading-snug text-slate-400 dark:text-slate-500">{foot}</span>
      )}
    </>
  );

  if (!onClick) {
    return <div className="rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">{body}</div>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-slate-200 px-3 py-2 text-left transition-colors hover:border-indigo-300 hover:bg-indigo-50/40 dark:border-slate-700 dark:hover:border-indigo-700 dark:hover:bg-indigo-950/20"
    >
      {body}
    </button>
  );
}

function highlightFigure(
  label: string,
  highlight: FfsFeatureHighlight | null,
  tone: 'neutral' | 'good' | 'warn' | 'bad',
  onSelect?: (item: FfsScreenedResult) => void,
) {
  if (!highlight) {
    return <Figure key={label} label={label} value="Not established" tone="neutral" />;
  }
  return (
    <Figure
      key={label}
      label={label}
      value={highlight.value}
      foot={highlight.location}
      tone={tone}
      onClick={onSelect ? () => onSelect(highlight.item) : undefined}
    />
  );
}

export default function FfsExecutiveSummary({
  items,
  config,
  screening,
  reportContext,
  onSelect,
}: {
  items: FfsScreenedResult[];
  config: FfsConfig;
  screening: FfsScreeningConfig;
  reportContext: FfsReportContext;
  onSelect?: (item: FfsScreenedResult) => void;
}) {
  const summary: Summary = useMemo(
    () => buildExecutiveSummary(items, config, screening, reportContext, DEFAULT_DEPTH_BUCKETS),
    [items, config, screening, reportContext],
  );

  const life = summary.remnantLife;
  const afterRepair = summary.remnantLifeAfterRepairProgramme;
  const fit = summary.verdict === 'fit-for-service';
  const VerdictIcon = summary.verdict === 'no-population' ? FiAlertTriangle : fit ? FiCheckCircle : FiXCircle;

  return (
    <aside className="space-y-4 text-slate-700 dark:text-slate-300">
      {/* Verdict */}
      <div
        className={`rounded-xl border p-4 ${
          fit
            ? 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-900/60 dark:bg-emerald-950/20'
            : summary.verdict === 'no-population'
              ? 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/40'
              : 'border-rose-200 bg-rose-50/70 dark:border-rose-900/60 dark:bg-rose-950/20'
        }`}
      >
        <div className="flex items-start gap-2.5">
          <VerdictIcon
            className={`mt-0.5 h-5 w-5 shrink-0 ${
              fit ? 'text-emerald-600' : summary.verdict === 'no-population' ? 'text-slate-400' : 'text-rose-600'
            }`}
          />
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
              Immediate integrity
            </p>
            <p className="mt-1 text-xs font-medium leading-relaxed text-slate-800 dark:text-slate-100">
              {verdictSentence(summary, config, screening)}
            </p>
            <p className="mt-1.5 text-[10px] text-slate-500 dark:text-slate-400">
              {summary.activeCount.toLocaleString()} active of {summary.assessedCount.toLocaleString()} assessed
            </p>
          </div>
        </div>
      </div>

      {/* Remnant life — the figure the whole report exists to produce. */}
      <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
        <SectionTitle>Future integrity</SectionTitle>
        <div className="grid gap-2">
          <Figure
            label="Remnant life of the line"
            value={formatPipelineRemnantLife(life, config.analysisHorizonYears ?? 30)}
            foot={
              life.governing
                ? `${life.dueDateIso} · set by ${life.governing.nominal.featureId ?? 'unidentified'} at LD ${Number(life.governing.nominal.ld).toLocaleString()} m`
                : 'No active feature establishes a limit'
            }
            tone={life.years !== null && life.years < config.highlightYears ? 'bad' : life.years !== null ? 'warn' : 'neutral'}
            onClick={life.governing && onSelect ? () => onSelect(life.governing!) : undefined}
          />

          {summary.repairProgrammeCount > 0 && (
            <Figure
              label="After the recommended repairs"
              value={
                afterRepair.years === null
                  ? 'No limit remains'
                  : `${afterRepair.years.toFixed(2)} y`
              }
              foot={
                afterRepair.years === null
                  ? `Assumes ${summary.repairProgrammeCount.toLocaleString()} feature(s) cut out and replaced`
                  : `${afterRepair.dueDateIso} · assumes ${summary.repairProgrammeCount.toLocaleString()} feature(s) cut out and replaced`
              }
              tone="good"
              onClick={afterRepair.governing && onSelect ? () => onSelect(afterRepair.governing!) : undefined}
            />
          )}

          {summary.nextInspectionInsideMargin ? (
            <Figure
              label="Next inspection by"
              value="Cannot be deferred"
              foot="The projected limit falls inside the three-year deferral margin"
              tone="bad"
            />
          ) : summary.nextInspectionByIso ? (
            <Figure
              label="Next inspection by"
              value={summary.nextInspectionByIso}
              foot="Three years ahead of the projected limit; a planning hint, not a risk assessment"
            />
          ) : null}

          {summary.designLife && (
            <Figure
              label="Design life consumed"
              value={`${summary.designLife.ageAtInspectionYears.toFixed(1)} of ${summary.designLife.designLifeYears} y`}
              foot={
                summary.designLife.designLifeRemainingYears < 0
                  ? `${Math.abs(summary.designLife.designLifeRemainingYears).toFixed(1)} y beyond the original design life`
                  : `${summary.designLife.designLifeRemainingYears.toFixed(1)} y of design life remaining`
              }
              tone={summary.designLife.designLifeRemainingYears < 0 ? 'warn' : 'neutral'}
            />
          )}
        </div>
      </div>

      {/* Governing features */}
      <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
        <SectionTitle>Governing features</SectionTitle>
        <div className="grid gap-2">
          {highlightFigure('Lowest safe pressure', summary.lowestSafePressure, 'bad', onSelect)}
          {highlightFigure('Highest ERF', summary.worstErf, 'bad', onSelect)}
          {highlightFigure('Deepest metal loss', summary.deepest, 'warn', onSelect)}
          {highlightFigure('Fastest depth growth', summary.fastestDepthGrowth, 'warn', onSelect)}
          {/* The axial rate the old projection ignored entirely. Shown beside
              the radial one so a defect that is spreading rather than
              deepening is visible at the top of the report. */}
          {highlightFigure('Fastest length growth', summary.fastestLengthGrowth, 'warn', onSelect)}
        </div>
        <p className="mt-2 text-[10px] leading-snug text-slate-400 dark:text-slate-500">
          Required pressure basis {formatPressure(summary.pressureBasisMpa)}.
        </p>
      </div>

      {/* Population */}
      <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
        <SectionTitle>Population</SectionTitle>
        <div className="space-y-1.5">
          {summary.depthBands.map((band) => (
            <div key={band.label} className="flex items-center gap-2 text-[11px]">
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ background: band.color }}
              />
              <span className="w-16 shrink-0 font-medium text-slate-600 dark:text-slate-300">{band.label}</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <span
                  className="block h-full rounded-full"
                  style={{ width: `${Math.round(band.share * 100)}%`, background: band.color }}
                />
              </span>
              <span className="w-14 shrink-0 text-right tabular-nums text-slate-500 dark:text-slate-400">
                {band.count.toLocaleString()}
              </span>
            </div>
          ))}
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
          <div className="flex justify-between">
            <dt className="text-slate-500">Internal</dt>
            <dd className="font-semibold tabular-nums">{summary.internalCount.toLocaleString()}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">External</dt>
            <dd className="font-semibold tabular-nums">{summary.externalCount.toLocaleString()}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">4–8 o'clock</dt>
            <dd className="font-semibold tabular-nums">{summary.bottomQuadrantCount.toLocaleString()}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">Clustered</dt>
            <dd className="font-semibold tabular-nums">{summary.clusteredCount.toLocaleString()}</dd>
          </div>
        </dl>
      </div>

      {/* Corrosion growth by section — the reference report's Table 3.2.1. */}
      {summary.sections.length > 0 && (
        <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
          <SectionTitle>Growth by section</SectionTitle>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-[9px] font-bold uppercase tracking-wide text-slate-400">
                  <th className="pb-1 text-left">Section</th>
                  <th className="pb-1 text-right">INT d</th>
                  <th className="pb-1 text-right">EXT d</th>
                  <th className="pb-1 text-right">INT L</th>
                  <th className="pb-1 text-right">EXT L</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {summary.sections.map((section) => (
                  <tr key={section.section}>
                    <td className="max-w-[110px] truncate py-1 pr-2 font-medium text-slate-600 dark:text-slate-300">
                      {section.section}
                    </td>
                    <td className="py-1 text-right tabular-nums text-slate-500">
                      {section.internalDepthRateMmPerYear?.toFixed(2) ?? '—'}
                    </td>
                    <td className="py-1 text-right tabular-nums text-slate-500">
                      {section.externalDepthRateMmPerYear?.toFixed(2) ?? '—'}
                    </td>
                    <td className="py-1 text-right tabular-nums text-slate-500">
                      {section.internalLengthRateMmPerYear?.toFixed(2) ?? '—'}
                    </td>
                    <td className="py-1 text-right tabular-nums text-slate-500">
                      {section.externalLengthRateMmPerYear?.toFixed(2) ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[10px] leading-snug text-slate-400 dark:text-slate-500">
            Maximum rate in each section, in mm/y. A dash means no rate was established for that surface —
            it does not mean zero growth.
          </p>
        </div>
      )}

      {/* Repair programme */}
      {summary.repairProgrammeCount > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-900/60 dark:bg-amber-950/20">
          <div className="flex items-start gap-2.5">
            <FiTool className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div>
              <p className="text-[11px] font-semibold text-amber-800 dark:text-amber-300">
                {summary.repairProgrammeCount.toLocaleString()} feature(s) recommended for permanent repair
              </p>
              <p className="mt-1 text-[10px] leading-relaxed text-amber-700/90 dark:text-amber-400/80">
                Remnant life below {config.highlightYears} years, plus every temporary repair still in place.
                Temporary repairs receive no capacity credit.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* What the figures above depend on */}
      {summary.dataGaps.length > 0 && (
        <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
          <SectionTitle>Caveats behind these figures</SectionTitle>
          <ul className="space-y-2">
            {summary.dataGaps.map((gap) => (
              <li key={gap.label} className="flex items-start gap-2 text-[11px]">
                <FiClock className="mt-0.5 h-3 w-3 shrink-0 text-slate-400" />
                <span>
                  <span className="font-semibold tabular-nums text-slate-700 dark:text-slate-200">
                    {gap.count.toLocaleString()}
                  </span>{' '}
                  <span className="text-slate-600 dark:text-slate-300">{gap.label}</span>
                  <span className="mt-0.5 block text-[10px] leading-snug text-slate-400 dark:text-slate-500">
                    {gap.detail}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}
