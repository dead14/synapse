import { useMemo } from 'react';
import { buildErfProfile } from '../../lib/ffs/chartData';
import {
  buildActionRegister,
  buildLocationZones,
  buildKpis,
  findInteractions,
  formatLife,
} from '../../lib/ffs/screening';
import { buildClockRose, buildDistanceProfile } from '../../lib/ffs/integrityViews';
import type { FfsConfig, FfsScreenedResult, FfsScreeningConfig, FfsSeverity } from '../../lib/ffs/types';
import { analysisHorizonYears } from '../../lib/ffs/lifeProjection';
import { buildFfsReportCase, type FfsReportContext } from '../../lib/ffs/reportCase';
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

const SCHEMATIC_BIN_COUNT = 140;
const SCHEMATIC_HEIGHT = 96;

function metres(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

/**
 * Feature density along the line, binned and coloured by the worst conservative
 * severity in each stretch.
 *
 * One marker per feature is unreadable at report scale — seven thousand dots on
 * a strip of a few hundred pixels overlap into a solid bar and answer nothing.
 * Bar height carries how many features fall in a stretch, colour carries how bad
 * the worst of them is, and clicking a bar opens that worst feature, so the
 * picture still leads somewhere.
 */
function PipelineSchematic({
  items,
  onSelect,
}: {
  items: FfsScreenedResult[];
  onSelect: (item: FfsScreenedResult) => void;
}) {
  const profile = useMemo(() => buildDistanceProfile(items, SCHEMATIC_BIN_COUNT), [items]);
  if (profile.bins.length === 0) return null;

  const { minM, maxM, peakCount, binWidthM } = profile;
  const span = maxM - minM || 1;
  const binPct = (binWidthM / span) * 100;

  return (
    <div>
      <div
        className="relative rounded-lg border border-slate-200 bg-slate-50 px-2 pb-4 pt-2 dark:border-slate-700 dark:bg-slate-900/50"
        style={{ height: SCHEMATIC_HEIGHT }}
      >
        {/* The pipe itself sits under the bars as the baseline they grow from. */}
        <div
          className="absolute bottom-3 left-2 right-2 h-1.5 rounded-full bg-slate-300 dark:bg-slate-600"
          aria-hidden="true"
        />
        {profile.bins.map((bin) => {
          // Square-root scaling: a stretch with 400 features is denser than one
          // with 40, but on a linear scale the 40 would be invisible.
          const height = Math.max(3, Math.sqrt(bin.count / (peakCount || 1)) * (SCHEMATIC_HEIGHT - 26));
          return (
            <button
              key={bin.index}
              type="button"
              onClick={() => onSelect(bin.worst)}
              title={`${metres(bin.startM)}–${metres(bin.endM)} m · ${bin.count.toLocaleString()} feature(s) · worst conservative ERF ${formatErf(bin.worstErf)}`}
              aria-label={`${bin.count} features between ${metres(bin.startM)} and ${metres(bin.endM)} metres, worst conservative ERF ${formatErf(bin.worstErf)}. Opens the worst feature.`}
              className="absolute bottom-3 rounded-t-[2px] transition-opacity hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
              style={{
                left: `calc(${((bin.startM - minM) / span) * 96}% + 2%)`,
                width: `max(2px, ${binPct * 0.96}%)`,
                height,
                background: SEVERITY_FILL[bin.severity],
                opacity: bin.severity === 'pass' ? 0.75 : 1,
                // A single escalated bin must not be hidden by its neighbours.
                zIndex: bin.severity === 'fail' ? 3 : bin.severity === 'review' ? 2 : 1,
              }}
            />
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] tabular-nums text-slate-400">
        <span>{metres(minM)} m</span>
        <span>
          {Math.round(binWidthM).toLocaleString()} m per bar · peak {peakCount.toLocaleString()} features
        </span>
        <span>{metres(maxM)} m</span>
      </div>
    </div>
  );
}

const INTERNAL_FILL = '#4f46e5';
const EXTERNAL_FILL = '#ea580c';

/** Wedge covering one clock hour, drawn from `inner` to `outer` radius. */
function sectorPath(cx: number, cy: number, hour: number, inner: number, outer: number): string {
  const step = (Math.PI * 2) / 12;
  // 12 o'clock is the top of the pipe, so the first sector is centred on -90°.
  const start = hour * step - Math.PI / 2 - step / 2 + 0.012;
  const end = start + step - 0.024;
  const p = (radiusValue: number, angle: number) => [
    cx + Math.cos(angle) * radiusValue,
    cy + Math.sin(angle) * radiusValue,
  ];
  const [x1, y1] = p(outer, start);
  const [x2, y2] = p(outer, end);
  const [x3, y3] = p(inner, end);
  const [x4, y4] = p(inner, start);
  return [
    `M ${x1} ${y1}`,
    `A ${outer} ${outer} 0 0 1 ${x2} ${y2}`,
    `L ${x3} ${y3}`,
    `A ${inner} ${inner} 0 0 0 ${x4} ${y4}`,
    'Z',
  ].join(' ');
}

/**
 * Clock-hour rose: how many features sit at each hour of the circumference,
 * counted separately for internal and external corrosion.
 *
 * Plotting one dot per feature on a single ring produced a solid band and hid
 * internal corrosion behind the far more numerous external features. A rose
 * answers the question the view is actually for — is the metal loss collecting
 * along the invert, and on which surface — and it answers it with counts an
 * engineer can quote.
 */
function ClockRoseChart({
  items,
  onSelect,
}: {
  items: FfsScreenedResult[];
  onSelect: (item: FfsScreenedResult) => void;
}) {
  const rose = useMemo(() => buildClockRose(items), [items]);
  const size = 320;
  const cx = size / 2;
  const cy = size / 2;
  const innerRadius = 44;
  const maxRadius = 132;
  const span = maxRadius - innerRadius;

  // Square-root scaling keeps a sector holding a handful of features visible
  // next to one holding a thousand; area then reads roughly with count.
  const radiusFor = (count: number) => (
    rose.peakCount > 0 ? innerRadius + Math.sqrt(count / rose.peakCount) * span : innerRadius
  );

  return (
    <div>
      <svg
        viewBox={`0 0 ${size} ${size}`}
        className="mx-auto block h-auto w-full max-w-[340px]"
        role="img"
        aria-label={`Feature count at each clock hour: ${rose.internalTotal} internal and ${rose.externalTotal} external across ${rose.plotted} oriented features`}
      >
        <title>Feature count by clock hour and surface</title>

        {/* Invert arc, 4 to 8 o'clock — where water collects. */}
        {[4, 5, 6, 7, 8].map((hour) => (
          <path
            key={`invert-${hour}`}
            d={sectorPath(cx, cy, hour, maxRadius + 5, maxRadius + 11)}
            fill="#f59e0b"
            opacity="0.35"
          />
        ))}

        {/* Count rings, so a sector can be read as a number, not just a shape. */}
        {[0.25, 0.5, 0.75, 1].map((fraction) => (
          <circle
            key={fraction}
            cx={cx}
            cy={cy}
            r={innerRadius + Math.sqrt(fraction) * span}
            fill="none"
            className="stroke-slate-200 dark:stroke-slate-700"
            strokeDasharray="2 3"
          />
        ))}
        <circle cx={cx} cy={cy} r={innerRadius} className="fill-white stroke-slate-300 dark:fill-slate-800 dark:stroke-slate-600" />

        {rose.sectors.map((sector) => {
          if (sector.total === 0) return null;
          // External is the outer ring, internal the inner one, so the smaller
          // population is never painted over by the larger.
          const outer = radiusFor(sector.total);
          const boundary = radiusFor(sector.internal);
          const label = `${sector.label} o'clock · ${sector.total.toLocaleString()} feature(s) · ${sector.internal.toLocaleString()} internal, ${sector.external.toLocaleString()} external`;
          return (
            <g
              key={sector.hour}
              className={sector.deepest ? 'cursor-pointer' : undefined}
              onClick={() => sector.deepest && onSelect(sector.deepest)}
            >
              <title>{label}{sector.deepest ? ` · deepest ${sector.deepest.nominal.maxDepthPct.toFixed(1)}%` : ''}</title>
              {sector.internal > 0 && (
                <path d={sectorPath(cx, cy, sector.hour, innerRadius, boundary)} fill={INTERNAL_FILL} opacity="0.9" />
              )}
              {sector.external > 0 && (
                <path
                  d={sectorPath(cx, cy, sector.hour, sector.internal > 0 ? boundary : innerRadius, outer)}
                  fill={EXTERNAL_FILL}
                  opacity="0.85"
                />
              )}
            </g>
          );
        })}

        {/* Hour labels around the outside. */}
        {rose.sectors.map((sector) => {
          const angle = (sector.hour / 12) * Math.PI * 2 - Math.PI / 2;
          const r = maxRadius + 22;
          return (
            <text
              key={`label-${sector.hour}`}
              x={cx + Math.cos(angle) * r}
              y={cy + Math.sin(angle) * r + 3.5}
              textAnchor="middle"
              className="fill-slate-400 text-[10px] tabular-nums"
            >
              {sector.label}
            </text>
          );
        })}

        <text x={cx} y={cy - 2} textAnchor="middle" className="fill-slate-500 text-[10px] font-bold">
          {rose.plotted.toLocaleString()}
        </text>
        <text x={cx} y={cy + 11} textAnchor="middle" className="fill-slate-400 text-[8px]">
          ORIENTED
        </text>
      </svg>

      <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
        <span className="inline-flex items-center gap-1.5">
          <i className="h-2 w-2 rounded-sm" style={{ background: INTERNAL_FILL }} aria-hidden="true" />
          Internal <strong className="tabular-nums text-slate-700 dark:text-slate-200">{rose.internalTotal.toLocaleString()}</strong>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="h-2 w-2 rounded-sm" style={{ background: EXTERNAL_FILL }} aria-hidden="true" />
          External <strong className="tabular-nums text-slate-700 dark:text-slate-200">{rose.externalTotal.toLocaleString()}</strong>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="h-2 w-2 rounded-sm bg-amber-400/60" aria-hidden="true" />
          4–8 o'clock <strong className="tabular-nums text-slate-700 dark:text-slate-200">{(rose.bottomShare * 100).toFixed(0)}%</strong>
        </span>
        {rose.withoutOrientation > 0 && (
          <span>{rose.withoutOrientation.toLocaleString()} without a clock value</span>
        )}
      </div>
    </div>
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
  // Collapsed features carry an infinite ERF; the axis is scaled on the finite
  // population and those points clamp to the top of the plot.
  const maxErf = Math.max(1.25, ...profile.map((p) => p.forecast).filter(Number.isFinite)) * 1.08;

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
  reportContext,
  onSelect,
}: {
  items: FfsScreenedResult[];
  config: FfsConfig;
  screening: FfsScreeningConfig;
  reportContext: FfsReportContext;
  onSelect: (item: FfsScreenedResult) => void;
}) {
  const kpis = useMemo(() => buildKpis(items), [items]);
  const locationZones = useMemo(() => buildLocationZones(items), [items]);
  const interactions = useMemo(() => findInteractions(items, screening), [items, screening]);
  const reportCase = useMemo(
    () => buildFfsReportCase(items, reportContext),
    [items, reportContext],
  );
  const actions = useMemo(
    () => buildActionRegister(items, screening, reportContext),
    [items, screening, reportContext],
  );
  const horizonYears = analysisHorizonYears(config);

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
          foot={screening.growthBasis === 'measured'
            ? 'At each feature’s measured rate'
            : `At ${screening.growthRateMmPerYear.toFixed(2)} mm/y`}
          tone={(kpis.maxForecastErf?.forecast.ERF ?? 0) > 1 ? 'bad' : 'accent'}
        />
        <Stat
          label="Shortest remnant life (tolerance-adj.)"
          value={formatLife(
            kpis.minLife?.remnantLifeConservative.years ?? null,
            kpis.minLife?.remnantLifeConservative.status ?? 'insufficient-growth-basis',
            horizonYears,
          )}
          foot={kpis.minLife ? ldLabel(kpis.minLife) : 'No limit reached'}
          tone={(kpis.minLife?.remnantLifeConservative.years ?? Infinity) < 10 ? 'warn' : 'good'}
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
          <ClockRoseChart items={items} onSelect={onSelect} />
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

      {/* Action register + location zones */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.5fr_1fr]">
        <Panel>
          <PanelHeader
            title="Action register"
            subtitle="Active as-managed features ranked by priority — assign owners in the controlled system"
            actions={
              <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-600 dark:border-rose-800/60 dark:bg-rose-950/30 dark:text-rose-400">
                {reportCase.asManagedItems.filter((item) => item.priority === 'High').length} high priority
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
                  <span className="text-[10px] font-bold leading-tight text-slate-700 dark:text-slate-200">
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
                      {formatErf(action.target.forecast.ERF)} · life{' '}
                      {formatLife(
                        action.target.remnantLifeConservative.years,
                        action.target.remnantLifeConservative.status,
                        horizonYears,
                      )}
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
              title="Location zones"
              subtitle="Features grouped where adjacent gaps are 10 m or less"
              actions={
                <span className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-500 dark:border-slate-600 dark:text-slate-400">
                  {locationZones.length} zone{locationZones.length === 1 ? '' : 's'}
                </span>
              }
            />
            {locationZones.length ? (
              <ul className="space-y-2">
                {locationZones.slice(0, 10).map((zone, i) => (
                  <li
                    key={zone.id}
                    className="rounded-lg border border-slate-200 p-2.5 dark:border-slate-700"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-700 dark:text-slate-200">
                          Zone {String(i + 1).padStart(2, '0')}
                        </p>
                        <p className="mt-0.5 text-[10px] tabular-nums text-slate-400">
                          {zone.startLd.toFixed(1)} – {zone.endLd.toFixed(1)} m
                        </p>
                      </div>
                      <span className="shrink-0 text-right">
                        <span className="block text-[11px] font-bold tabular-nums text-slate-700 dark:text-slate-200">
                          {formatErf(zone.worstErf)}
                        </span>
                        <span className="block text-[10px] text-slate-400">
                          {zone.members.length} features
                        </span>
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.min(100, zone.worstErf * 100)}%`,
                          background: zone.worstErf > 1 ? '#ef4444' : zone.worstErf >= screening.reviewBandErf ? '#f59e0b' : '#6366f1',
                        }}
                      />
                    </div>
                  </li>
                ))}
                {locationZones.length > 10 && (
                  <li className="pt-1 text-center text-[10px] italic text-slate-400">
                    and {locationZones.length - 10} further zone{locationZones.length - 10 === 1 ? '' : 's'}
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
