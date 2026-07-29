import { useMemo } from 'react';
import { buildErfProfile } from '../../lib/ffs/chartData';
import {
  buildActionRegister,
  buildClusters,
  buildKpis,
  findInteractions,
  formatLife,
} from '../../lib/ffs/screening';
import { isInternal } from '../../lib/ffs/statistics';
import type { FfsConfig, FfsScreenedResult, FfsScreeningConfig, FfsSeverity } from '../../lib/ffs/types';
import { Callout, Panel, PanelHeader, PriorityLabel, Stat, formatErf } from './FfsPrimitives';

const SEVERITY_FILL: Record<FfsSeverity, string> = {
  pass: '#10b981',
  review: '#f59e0b',
  fail: '#ef4444',
};

function numericLd(item: FfsScreenedResult): number {
  const value = Number(item.nominal.ld);
  return Number.isFinite(value) ? value : 0;
}

/**
 * Horizontal pipeline schematic. Each feature is a marker at its log distance,
 * coloured by the conservative severity, so hot spots read at a glance.
 */
function PipelineSchematic({
  items,
  onSelect,
}: {
  items: FfsScreenedResult[];
  onSelect: (item: FfsScreenedResult) => void;
}) {
  const distances = items.map(numericLd);
  const min = Math.min(...distances);
  const max = Math.max(...distances);
  const span = max - min || 1;

  return (
    <div>
      <div className="relative h-16 rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/50">
        {/* Pipe body */}
        <div
          className="absolute left-2 right-2 top-1/2 h-2.5 -translate-y-1/2 rounded-full border border-slate-300 bg-gradient-to-b from-slate-200 via-slate-100 to-slate-300 dark:border-slate-600 dark:from-slate-600 dark:via-slate-700 dark:to-slate-600"
          aria-hidden="true"
        />
        {items.map((item) => {
          const left = 8 + ((numericLd(item) - min) / span) * 100;
          const severity = item.conservative.severity;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onSelect(item)}
              title={`LD ${numericLd(item).toLocaleString()} m · ${item.nominal.section} · conservative ERF ${formatErf(item.conservative.ERF)}`}
              aria-label={`Feature at log distance ${numericLd(item).toLocaleString()} metres, conservative ERF ${formatErf(item.conservative.ERF)}`}
              className="absolute top-1/2 h-4 w-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow transition-transform hover:scale-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-800"
              style={{
                left: `calc(${((numericLd(item) - min) / span) * 100}% * 0.96 + 2%)`,
                background: SEVERITY_FILL[severity],
                // Escalated features sit above the pass markers so they stay visible.
                zIndex: severity === 'fail' ? 3 : severity === 'review' ? 2 : 1,
                ...(left > 100 ? { left: '98%' } : {}),
              }}
            />
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] tabular-nums text-slate-400">
        <span>{min.toLocaleString()} m</span>
        <span>{((min + max) / 2).toLocaleString(undefined, { maximumFractionDigits: 0 })} m</span>
        <span>{max.toLocaleString()} m</span>
      </div>
    </div>
  );
}

/**
 * Pipe cross-section with features plotted at their clock angle. A concentration
 * in the 4-8 o'clock arc points to water hold-up along the invert.
 */
function ClockPolarChart({
  items,
  onSelect,
}: {
  items: FfsScreenedResult[];
  onSelect: (item: FfsScreenedResult) => void;
}) {
  const size = 300;
  const cx = size / 2;
  const cy = size / 2;
  const radius = 96;
  const plotted = items.filter((item) => item.clockHour !== null);

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className="mx-auto block h-auto w-full max-w-[300px]"
      role="img"
      aria-label={`Pipe cross-section showing the clock orientation of ${plotted.length} features`}
    >
      <title>Feature orientation around the pipe circumference</title>
      {/* Pipe wall */}
      <circle cx={cx} cy={cy} r={radius + 16} className="fill-slate-50 dark:fill-slate-900/60" />
      <circle
        cx={cx}
        cy={cy}
        r={radius}
        className="fill-white stroke-slate-300 dark:fill-slate-800 dark:stroke-slate-600"
        strokeWidth="2"
      />
      <circle
        cx={cx}
        cy={cy}
        r={radius - 26}
        className="fill-slate-50/60 stroke-slate-200 dark:fill-slate-900/40 dark:stroke-slate-700"
      />

      {/* Bottom-quadrant arc highlight */}
      <path
        d={`M ${cx - radius - 8} ${cy} A ${radius + 8} ${radius + 8} 0 0 0 ${cx + radius + 8} ${cy}`}
        fill="none"
        stroke="#f59e0b"
        strokeWidth="5"
        strokeLinecap="round"
        opacity="0.2"
      />

      {/* Clock labels */}
      {[
        { label: '12', x: cx, y: cy - radius - 22 },
        { label: '3', x: cx + radius + 24, y: cy + 4 },
        { label: '6', x: cx, y: cy + radius + 30 },
        { label: '9', x: cx - radius - 24, y: cy + 4 },
      ].map((tick) => (
        <text
          key={tick.label}
          x={tick.x}
          y={tick.y}
          textAnchor="middle"
          className="fill-slate-400 text-[11px]"
        >
          {tick.label}
        </text>
      ))}

      <text x={cx} y={cy - 2} textAnchor="middle" className="fill-slate-500 text-[11px] font-bold">
        PIPE
      </text>
      <text x={cx} y={cy + 12} textAnchor="middle" className="fill-slate-400 text-[8px]">
        CROSS SECTION
      </text>

      {/* Features */}
      {plotted.map((item) => {
        // 12 o'clock is the top of the pipe, so offset the angle by a quarter turn.
        const angle = (item.clockHour! / 12) * Math.PI * 2 - Math.PI / 2;
        const r = radius - 13;
        return (
          <circle
            key={item.key}
            cx={cx + Math.cos(angle) * r}
            cy={cy + Math.sin(angle) * r}
            r={4.5}
            fill={isInternal(item) ? '#6366f1' : '#f97316'}
            stroke="#fff"
            strokeWidth="1.5"
            className="cursor-pointer transition-all hover:brightness-110"
            onClick={() => onSelect(item)}
          >
            <title>
              LD {numericLd(item).toLocaleString()} m · {item.nominal.orient} · {item.nominal.surface} ·
              depth {item.nominal.maxDepthPct.toFixed(1)}%
            </title>
          </circle>
        );
      })}
    </svg>
  );
}

/**
 * Spatial ERF profile drawn as an SVG. Stems connect each feature's nominal
 * value to its forecast so the rate of change reads spatially.
 */
function ErfProfileChart({
  items,
  screening,
  onSelect,
}: {
  items: FfsScreenedResult[];
  screening: FfsScreeningConfig;
  onSelect: (item: FfsScreenedResult) => void;
}) {
  const profile = useMemo(() => buildErfProfile(items), [items]);
  const width = 1000;
  const height = 320;
  const margin = { top: 18, right: 24, bottom: 42, left: 56 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;

  if (!profile.length) return null;

  const ldMin = profile[0].ld;
  const ldMax = profile[profile.length - 1].ld;
  const ldSpan = ldMax - ldMin || 1;
  const maxErf = Math.max(1.25, ...profile.map((p) => p.forecast)) * 1.08;

  const xOf = (ld: number) => margin.left + ((ld - ldMin) / ldSpan) * plotW;
  const yOf = (erf: number) => margin.top + plotH - (Math.min(erf, maxErf) / maxErf) * plotH;

  const yTicks = Array.from({ length: 6 }, (_, i) => (maxErf * i) / 5);
  const xTicks = Array.from({ length: 7 }, (_, i) => ldMin + (ldSpan * i) / 6);

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="block h-auto w-full min-w-[640px]"
        role="img"
        aria-label="Estimated repair factor against log distance, showing nominal, conservative, and forecast values"
      >
        <title>ERF profile along the pipeline</title>

        {/* Grid */}
        {yTicks.map((tick) => (
          <g key={`y${tick}`}>
            <line
              x1={margin.left}
              y1={yOf(tick)}
              x2={width - margin.right}
              y2={yOf(tick)}
              className="stroke-slate-200 dark:stroke-slate-700"
              strokeWidth="1"
            />
            <text
              x={margin.left - 8}
              y={yOf(tick) + 3.5}
              textAnchor="end"
              className="fill-slate-400 text-[9px] tabular-nums"
            >
              {tick.toFixed(2)}
            </text>
          </g>
        ))}
        {xTicks.map((tick) => (
          <text
            key={`x${tick}`}
            x={xOf(tick)}
            y={height - 22}
            textAnchor="middle"
            className="fill-slate-400 text-[9px] tabular-nums"
          >
            {Math.round(tick).toLocaleString()}
          </text>
        ))}

        {/* Threshold lines */}
        {[
          { value: screening.reviewBandErf, color: '#f59e0b', label: 'Review band' },
          { value: 1, color: '#ef4444', label: 'ERF 1.00' },
        ].map((line) => (
          <g key={line.label}>
            <line
              x1={margin.left}
              y1={yOf(line.value)}
              x2={width - margin.right}
              y2={yOf(line.value)}
              stroke={line.color}
              strokeWidth="1.5"
              strokeDasharray="6 4"
            />
            <text
              x={width - margin.right - 4}
              y={yOf(line.value) - 5}
              textAnchor="end"
              fill={line.color}
              className="text-[9px] font-semibold"
            >
              {line.label}
            </text>
          </g>
        ))}

        {/* Stems from nominal to forecast */}
        {profile.map((point) => (
          <line
            key={`stem-${point.item.key}`}
            x1={xOf(point.ld)}
            y1={yOf(point.nominal)}
            x2={xOf(point.ld)}
            y2={yOf(point.forecast)}
            className="stroke-slate-300 dark:stroke-slate-600"
            strokeWidth="1"
          />
        ))}

        {/* Three tiers, forecast underneath so nominal stays readable */}
        {(
          [
            { key: 'forecast' as const, color: '#8b5cf6', r: 4 },
            { key: 'conservative' as const, color: '#f59e0b', r: 3.4 },
            { key: 'nominal' as const, color: '#10b981', r: 3.2 },
          ]
        ).map((series) =>
          profile.map((point) => (
            <circle
              key={`${series.key}-${point.item.key}`}
              cx={xOf(point.ld)}
              cy={yOf(point[series.key])}
              r={series.r}
              fill={series.color}
              stroke="#fff"
              strokeWidth="1"
              className="cursor-pointer"
              onClick={() => onSelect(point.item)}
            >
              <title>
                LD {point.ld.toLocaleString()} m · {series.key} ERF {point[series.key].toFixed(3)}
              </title>
            </circle>
          )),
        )}

        {/* Axis labels */}
        <text
          x={14}
          y={margin.top + plotH / 2}
          transform={`rotate(-90 14 ${margin.top + plotH / 2})`}
          textAnchor="middle"
          className="fill-slate-500 text-[10px]"
        >
          Estimated repair factor
        </text>
        <text
          x={margin.left + plotW / 2}
          y={height - 5}
          textAnchor="middle"
          className="fill-slate-500 text-[10px]"
        >
          Log distance [m]
        </text>
      </svg>
    </div>
  );
}

/**
 * The engineering decision layer: headline indicators, spatial context, the
 * ranked action register, and the spacing screens that feed dig planning.
 */
export default function FfsIntegrityPanel({
  items,
  config,
  screening,
  onSelect,
}: {
  items: FfsScreenedResult[];
  config: FfsConfig;
  screening: FfsScreeningConfig;
  onSelect: (item: FfsScreenedResult) => void;
}) {
  const kpis = useMemo(() => buildKpis(items), [items]);
  const clusters = useMemo(() => buildClusters(items), [items]);
  const interactions = useMemo(() => findInteractions(items, screening), [items, screening]);
  const actions = useMemo(() => buildActionRegister(items, screening), [items, screening]);

  if (!items.length) {
    return <Callout tone="warn">No assessed features are available for the integrity review.</Callout>;
  }

  const ldLabel = (item: FfsScreenedResult) =>
    `LD ${numericLd(item).toLocaleString(undefined, { maximumFractionDigits: 1 })} m`;

  return (
    <div className="space-y-5">
      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat
          label="Max nominal ERF"
          value={formatErf(kpis.maxNominalErf?.nominal.ERF ?? 0)}
          foot={kpis.maxNominalErf ? ldLabel(kpis.maxNominalErf) : ''}
          tone={(kpis.maxNominalErf?.nominal.ERF ?? 0) > 1 ? 'bad' : 'default'}
        />
        <Stat
          label="Max conservative ERF"
          value={formatErf(kpis.maxConservativeErf?.conservative.ERF ?? 0)}
          foot="With ILI tolerance"
          tone={(kpis.maxConservativeErf?.conservative.ERF ?? 0) > 1 ? 'bad' : 'warn'}
        />
        <Stat
          label={`Max ${screening.forecastYears} y forecast ERF`}
          value={formatErf(kpis.maxForecastErf?.forecast.ERF ?? 0)}
          foot={`At ${screening.growthRateMmPerYear.toFixed(2)} mm/y`}
          tone={(kpis.maxForecastErf?.forecast.ERF ?? 0) > 1 ? 'bad' : 'accent'}
        />
        <Stat
          label="Shortest life to ERF 1"
          value={formatLife(kpis.minLife?.lifeToErf1 ?? Infinity)}
          foot={kpis.minLife ? ldLabel(kpis.minLife) : ''}
          tone={(kpis.minLife?.lifeToErf1 ?? Infinity) < 10 ? 'warn' : 'good'}
        />
        <Stat
          label="Escalated features"
          value={kpis.escalatedCount.toLocaleString()}
          foot={`${(kpis.totalCount - kpis.escalatedCount).toLocaleString()} pass the screen`}
          tone={kpis.escalatedCount > 0 ? 'warn' : 'good'}
        />
        <Stat
          label="Bottom quadrant"
          value={`${kpis.totalCount ? Math.round((kpis.bottomQuadrantCount / kpis.totalCount) * 100) : 0}%`}
          foot={`${kpis.bottomQuadrantCount} at 04:00-08:59`}
          tone="default"
        />
      </div>

      {/* Schematic + polar */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.5fr_1fr]">
        <Panel>
          <PanelHeader
            title="Pipeline schematic"
            subtitle="Feature positions coloured by conservative severity — select a marker to open its trace"
            actions={
              <div className="flex flex-wrap items-center gap-3 text-[10px] text-slate-500 dark:text-slate-400">
                {(
                  [
                    ['pass', 'Pass'],
                    ['review', 'Review'],
                    ['fail', 'Not acceptable'],
                  ] as [FfsSeverity, string][]
                ).map(([severity, label]) => (
                  <span key={severity} className="inline-flex items-center gap-1.5">
                    <i
                      className="h-2 w-2 rounded-full"
                      style={{ background: SEVERITY_FILL[severity] }}
                      aria-hidden="true"
                    />
                    {label}
                  </span>
                ))}
              </div>
            }
          />
          <PipelineSchematic items={items} onSelect={onSelect} />

          <div className="mt-4">
            <PanelHeader
              title="ERF profile"
              subtitle={`Nominal, conservative, and ${screening.forecastYears}-year forecast against log distance`}
              actions={
                <div className="flex flex-wrap items-center gap-3 text-[10px] text-slate-500 dark:text-slate-400">
                  {[
                    ['#10b981', 'Nominal'],
                    ['#f59e0b', 'Conservative'],
                    ['#8b5cf6', 'Forecast'],
                  ].map(([color, label]) => (
                    <span key={label} className="inline-flex items-center gap-1.5">
                      <i className="h-2 w-2 rounded-full" style={{ background: color }} aria-hidden="true" />
                      {label}
                    </span>
                  ))}
                </div>
              }
            />
            <ErfProfileChart items={items} screening={screening} onSelect={onSelect} />
          </div>
        </Panel>

        <Panel>
          <PanelHeader
            title="Clock orientation"
            subtitle="Feature centre points around the circumference"
            actions={
              <span className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-500 dark:border-slate-600 dark:text-slate-400">
                {kpis.bottomQuadrantCount}/{kpis.totalCount} bottom
              </span>
            }
          />
          <ClockPolarChart items={items} onSelect={onSelect} />
          <div className="mt-3 flex justify-center gap-4 text-[10px] text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <i className="h-2 w-2 rounded-full bg-indigo-500" aria-hidden="true" /> Internal
            </span>
            <span className="inline-flex items-center gap-1.5">
              <i className="h-2 w-2 rounded-full bg-orange-500" aria-hidden="true" /> External
            </span>
          </div>
          <div className="mt-4">
            <Callout>
              {kpis.bottomQuadrantCount / Math.max(1, kpis.totalCount) > 0.5
                ? 'A dominant bottom-quadrant concentration supports targeted drainage, inhibitor, coating, and excavation validation planning. Confirm the mechanism with field evidence.'
                : 'No strong invert bias in this population. Review orientation alongside terrain profile and coating history.'}
            </Callout>
          </div>
        </Panel>
      </div>

      {/* Action register + clusters */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.5fr_1fr]">
        <Panel>
          <PanelHeader
            title="Action register"
            subtitle="Screening recommendations ranked by priority — assign owners in the controlled system"
            actions={
              <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-600 dark:border-rose-800/60 dark:bg-rose-950/30 dark:text-rose-400">
                {items.filter((item) => item.priority === 'High').length} high priority
              </span>
            }
          />
          <ol className="space-y-2">
            {actions.map((action) => (
              <li key={action.code}>
                <button
                  type="button"
                  onClick={() => onSelect(action.target)}
                  className="grid w-full grid-cols-[64px_1fr_auto] gap-3 rounded-lg border border-slate-200 p-3 text-left transition-colors hover:border-indigo-300 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-700 dark:hover:border-indigo-700 dark:hover:bg-slate-700/40"
                >
                  <span className="text-[10px] font-bold leading-tight text-indigo-600 dark:text-indigo-400">
                    {action.code}
                    <span className="mt-0.5 block font-normal tabular-nums text-slate-400">
                      {numericLd(action.target).toFixed(0)} m
                    </span>
                  </span>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <PriorityLabel priority={action.priority} />
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">
                        {action.target.nominal.section} · {action.target.nominal.maxDepthPct.toFixed(1)}% depth
                      </span>
                    </span>
                    <span className="mt-1 block text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                      {action.recommendation}
                    </span>
                    <span className="mt-1 block text-[10px] tabular-nums text-slate-400">
                      Conservative ERF {formatErf(action.target.conservative.ERF)} · forecast{' '}
                      {formatErf(action.target.forecast.ERF)} · life {formatLife(action.target.lifeToErf1)}
                    </span>
                  </span>
                  <span
                    className={`self-start whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                      action.due === 'Immediate'
                        ? 'border-rose-200 bg-rose-50 text-rose-600 dark:border-rose-800/60 dark:bg-rose-950/30 dark:text-rose-400'
                        : action.due === 'Planned'
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-600 dark:border-emerald-800/60 dark:bg-emerald-950/30 dark:text-emerald-400'
                          : 'border-amber-200 bg-amber-50 text-amber-600 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-400'
                    }`}
                  >
                    {action.due}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </Panel>

        <div className="space-y-5">
          <Panel>
            <PanelHeader
              title="Location clusters"
              subtitle="Features grouped where adjacent gaps are 10 m or less"
              actions={
                <span className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-500 dark:border-slate-600 dark:text-slate-400">
                  {clusters.length} zone{clusters.length === 1 ? '' : 's'}
                </span>
              }
            />
            {clusters.length ? (
              <ul className="space-y-2">
                {clusters.slice(0, 10).map((cluster, i) => (
                  <li
                    key={cluster.id}
                    className="rounded-lg border border-slate-200 p-2.5 dark:border-slate-700"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-700 dark:text-slate-200">
                          Zone {String(i + 1).padStart(2, '0')}
                        </p>
                        <p className="mt-0.5 text-[10px] tabular-nums text-slate-400">
                          {cluster.startLd.toFixed(1)} – {cluster.endLd.toFixed(1)} m
                        </p>
                      </div>
                      <span className="shrink-0 text-right">
                        <span className="block text-[11px] font-bold tabular-nums text-slate-700 dark:text-slate-200">
                          {formatErf(cluster.worstErf)}
                        </span>
                        <span className="block text-[10px] text-slate-400">
                          {cluster.members.length} features
                        </span>
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.min(100, cluster.worstErf * 100)}%`,
                          background: cluster.worstErf > 1 ? '#ef4444' : cluster.worstErf >= screening.reviewBandErf ? '#f59e0b' : '#6366f1',
                        }}
                      />
                    </div>
                  </li>
                ))}
                {clusters.length > 10 && (
                  <li className="pt-1 text-center text-[10px] italic text-slate-400">
                    and {clusters.length - 10} further zone{clusters.length - 10 === 1 ? '' : 's'}
                  </li>
                )}
              </ul>
            ) : (
              <Callout>No multi-feature zone falls within a 10 m grouping distance.</Callout>
            )}
          </Panel>

          <Panel>
            <PanelHeader
              title="Axial interaction screen"
              subtitle={`Edge-to-edge separation against ${screening.interactionSpacingFactor}t`}
              actions={
                <span
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                    interactions.length
                      ? 'border-amber-200 bg-amber-50 text-amber-600 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-400'
                      : 'border-emerald-200 bg-emerald-50 text-emerald-600 dark:border-emerald-800/60 dark:bg-emerald-950/30 dark:text-emerald-400'
                  }`}
                >
                  {interactions.length ? `${interactions.length} flagged` : 'None flagged'}
                </span>
              }
            />
            {interactions.length ? (
              <ul className="space-y-1.5">
                {interactions.slice(0, 12).map((pair, i) => (
                  <li
                    key={`${pair.a.key}-${pair.b.key}-${i}`}
                    className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-2.5 py-2 text-[11px] dark:border-slate-700"
                  >
                    <span className="min-w-0 truncate text-slate-600 dark:text-slate-300">
                      {numericLd(pair.a).toFixed(1)} m ↔ {numericLd(pair.b).toFixed(1)} m
                    </span>
                    <span className="shrink-0 tabular-nums text-slate-400">
                      gap {pair.edgeGapMm.toFixed(1)} / {pair.thresholdMm.toFixed(1)} mm
                    </span>
                  </li>
                ))}
                {interactions.length > 12 && (
                  <li className="pt-1 text-center text-[10px] italic text-slate-400">
                    and {interactions.length - 12} further pair{interactions.length - 12 === 1 ? '' : 's'}
                  </li>
                )}
              </ul>
            ) : (
              <Callout>
                No pair has a calculated axial edge-to-edge separation within{' '}
                {screening.interactionSpacingFactor}t. This simplified screen does not replace a full
                interaction or colony assessment.
              </Callout>
            )}
          </Panel>
        </div>
      </div>

      <Callout tone="warn">
        <strong>Use limitation.</strong> This workspace is a transparent screening tool. Final fitness-for-service
        disposition requires an approved procedure, verified input data, a competent technical authority, and
        independent checking. The conservative and forecast tiers are screening assumptions, not code
        requirements.
      </Callout>
    </div>
  );
}
