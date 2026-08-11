import { useMemo } from 'react';
import {
  buildActionRegister,
  buildLocationZones,
  buildKpis,
  findInteractions,
  formatLife,
} from '../../lib/ffs/screening';
import { buildClockRose, buildDistanceProfile, buildErfBands } from '../../lib/ffs/integrityViews';
import { buildColonyLevel2Assessments } from '../../lib/ffs/colonyAssessment';
import type { FfsConfig, FfsScreenedResult, FfsScreeningConfig, FfsSeverity } from '../../lib/ffs/types';
import { analysisHorizonYears } from '../../lib/ffs/lifeProjection';
import type { FfsReportCase, FfsReportContext } from '../../lib/ffs/reportCase';
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

const ERF_BAND_COUNT = 180;
const TIER_COLOR = { nominal: '#10b981', conservative: '#f59e0b', forecast: '#8b5cf6' } as const;

/**
 * Spatial ERF profile: the worst value in each stretch of line, one curve per
 * tier, over the spread the forecast opens up.
 *
 * Two things this drawing has to survive. The first is population size — see
 * {@link buildErfBands}; a mark per feature per tier is tens of thousands of
 * SVG nodes and the tab stops responding. The second is a healthy line. On a
 * population whose worst ERF is 0.23 a fixed axis anchored at 1.00 flattens
 * every curve onto the baseline, and the reader concludes the chart is broken
 * rather than that the pipe is fine. So the axis follows the data, and the
 * acceptance line is drawn when it is on scale and stated in words when it is
 * not — which is itself the answer to "how close are we".
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
  const profile = useMemo(() => buildErfBands(items, ERF_BAND_COUNT), [items]);
  const width = 1000;
  const height = 320;
  const margin = { top: 18, right: 24, bottom: 42, left: 56 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;

  if (!profile.bands.length) return null;

  const { bands, minM, maxM } = profile;
  const ldSpan = maxM - minM || 1;
  // Headroom over the highest plotted value, with the review band always in
  // frame so the screening decision has something to sit against. A collapsed
  // feature has no finite ERF to scale on, so its presence pulls the acceptance
  // line into the domain instead.
  const maxErf = Math.max(
    profile.peakErf * 1.14,
    screening.reviewBandErf * 1.2,
    profile.unboundedCount > 0 ? 1.15 : 0,
    0.05,
  );

  const xOf = (ld: number) => margin.left + ((ld - minM) / ldSpan) * plotW;
  const yOf = (erf: number) => margin.top + plotH - (Math.min(erf, maxErf) / maxErf) * plotH;

  const yTicks = Array.from({ length: 6 }, (_, i) => (maxErf * i) / 5);
  const xTicks = Array.from({ length: 7 }, (_, i) => minM + (ldSpan * i) / 6);
  const bandWidth = Math.max(1, plotW / bands.length);

  const line = (pick: (band: (typeof bands)[number]) => number) =>
    bands.map((band, index) => `${index === 0 ? 'M' : 'L'} ${xOf(band.midM).toFixed(2)} ${yOf(pick(band)).toFixed(2)}`).join(' ');

  // The forecast envelope: worst down the top, best back along the bottom.
  const envelope = [
    ...bands.map((band, index) => `${index === 0 ? 'M' : 'L'} ${xOf(band.midM).toFixed(2)} ${yOf(band.forecastMax).toFixed(2)}`),
    ...[...bands].reverse().map((band) => `L ${xOf(band.midM).toFixed(2)} ${yOf(band.forecastMin).toFixed(2)}`),
    'Z',
  ].join(' ');

  const thresholds = [
    { value: screening.reviewBandErf, color: '#f59e0b', label: 'Review band' },
    { value: 1, color: '#ef4444', label: 'ERF 1.00' },
  ].filter((line) => line.value <= maxErf);
  const acceptanceOffScale = maxErf < 1;

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="block h-auto w-full min-w-[640px]"
        role="img"
        aria-label={`Estimated repair factor against log distance, showing the worst nominal, conservative, and forecast value in each of ${bands.length} stretches`}
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

        {/* Threshold lines, drawn only where they fall inside the axis. */}
        {thresholds.map((threshold) => (
          <g key={threshold.label}>
            <line
              x1={margin.left}
              y1={yOf(threshold.value)}
              x2={width - margin.right}
              y2={yOf(threshold.value)}
              stroke={threshold.color}
              strokeWidth="1.5"
              strokeDasharray="6 4"
            />
            <text
              x={width - margin.right - 4}
              y={yOf(threshold.value) - 5}
              textAnchor="end"
              fill={threshold.color}
              className="text-[9px] font-semibold"
            >
              {threshold.label}
            </text>
          </g>
        ))}

        {/* Forecast spread, then the worst-in-stretch curve for each tier. */}
        <path d={envelope} fill={TIER_COLOR.forecast} opacity="0.14" />
        <path d={line((band) => band.forecastMax)} fill="none" stroke={TIER_COLOR.forecast} strokeWidth="1.6" strokeLinejoin="round" />
        <path d={line((band) => band.conservativeMax)} fill="none" stroke={TIER_COLOR.conservative} strokeWidth="1.6" strokeLinejoin="round" />
        <path d={line((band) => band.nominalMax)} fill="none" stroke={TIER_COLOR.nominal} strokeWidth="1.6" strokeLinejoin="round" />

        {/* Every feature that is not screened as a pass keeps its own mark. */}
        {profile.notable.map((item) => {
          const ld = Number(item.nominal.ld);
          return (
            <circle
              key={`notable-${item.key}-${item.index}`}
              cx={xOf(Number.isFinite(ld) ? ld : 0)}
              cy={yOf(Number.isFinite(item.forecast.ERF) ? item.forecast.ERF : maxErf)}
              r={3.4}
              fill={SEVERITY_FILL[item.conservative.severity]}
              stroke="#fff"
              strokeWidth="1"
              className="cursor-pointer"
              onClick={() => onSelect(item)}
            >
              <title>
                LD {ld.toLocaleString(undefined, { maximumFractionDigits: 1 })} m · conservative ERF{' '}
                {formatErf(item.conservative.ERF)} · forecast {formatErf(item.forecast.ERF)}
              </title>
            </circle>
          );
        })}

        {/* One hit target per stretch, so a click anywhere opens its worst feature. */}
        {bands.map((band) => (
          <rect
            key={`hit-${band.index}`}
            x={xOf(band.midM) - bandWidth / 2}
            y={margin.top}
            width={bandWidth}
            height={plotH}
            fill="transparent"
            className="cursor-pointer"
            onClick={() => onSelect(band.worst)}
          >
            <title>
              {Math.round(band.startM).toLocaleString()}–{Math.round(band.endM).toLocaleString()} m ·{' '}
              {band.count.toLocaleString()} feature(s) · worst nominal {formatErf(band.nominalMax)} ·
              conservative {formatErf(band.conservativeMax)} · forecast {formatErf(band.forecastMax)}
            </title>
          </rect>
        ))}

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

      <p className="mt-1.5 text-[10px] leading-snug text-slate-400 dark:text-slate-500">
        Worst value in each of {bands.length} stretches of{' '}
        {Math.round((maxM - minM) / bands.length).toLocaleString()} m; the shaded band is the spread
        of forecast values inside each stretch. {profile.notable.length.toLocaleString()} escalated
        feature{profile.notable.length === 1 ? '' : 's'} drawn individually
        {profile.notableOmitted > 0 && `, ${profile.notableOmitted.toLocaleString()} further not marked`}
        {acceptanceOffScale && '. Every feature is below ERF 1.00, so the acceptance line is off this axis'}
        {profile.unboundedCount > 0 && `. ${profile.unboundedCount.toLocaleString()} feature(s) carry no finite forecast ERF and are plotted at the top of the axis`}.
      </p>
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
  reportCase,
  onSelect,
}: {
  items: FfsScreenedResult[];
  config: FfsConfig;
  screening: FfsScreeningConfig;
  reportContext: FfsReportContext;
  /**
   * Built once by the workspace and handed down. Assembling it is a dozen
   * passes over the whole population, and this panel used to trigger two more
   * of them — one here and one inside the action register — for a case the page
   * above had already built.
   */
  reportCase: FfsReportCase;
  onSelect: (item: FfsScreenedResult) => void;
}) {
  const kpis = useMemo(() => buildKpis(items), [items]);
  const locationZones = useMemo(() => buildLocationZones(items), [items]);
  const interactions = useMemo(() => findInteractions(items, screening), [items, screening]);
  // Level 2 needs a corrosion profile, which one ILI box cannot provide but a
  // colony of them can. Only colonies whose merged Level 1 result is worth
  // challenging are evaluated; the rest would be arithmetic nobody reads.
  const colonyAssessments = useMemo(
    () => buildColonyLevel2Assessments(items, screening, config),
    [items, screening, config],
  );
  const actions = useMemo(
    () => buildActionRegister(items, screening, reportContext, undefined, reportCase),
    [items, screening, reportContext, reportCase],
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
                      {/* Below 45 degrees the pattern's overall length governs;
                          at or above it B31G para. 1.13 accepts the worst
                          longitudinal section instead, so merging the pair
                          would overstate the extent rather than protect. */}
                      {pair.combineRule === 'worst-longitudinal-section' && (
                        <span
                          title="The pair lies at 45 degrees or more to the pipe axis. B31G para. 1.13 accepts the most severe longitudinal section rather than the combined length."
                          className="ml-1.5 rounded border border-slate-200 px-1 py-px text-[9px] font-bold uppercase tracking-wide text-slate-400 dark:border-slate-700"
                        >
                          circumferential
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 tabular-nums text-slate-400">
                      axial {pair.edgeGapMm.toFixed(1)}
                      {' · circ '}
                      {pair.circumferentialGapMm === null
                        ? 'n/a'
                        : `${pair.circumferentialGapMm.toFixed(1)}`}
                      {' / '}{pair.thresholdMm.toFixed(1)} mm
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
                {screening.interactionSpacingFactor}t. Both the axial and circumferential separations are
                measured, per B31G para. 1.12(a), but the scan window is axial: two features metres apart
                are not a colony whatever their clock positions. This screen does not replace a full
                interaction or colony assessment.
              </Callout>
            )}
          </Panel>
        </div>
      </div>

      {/* Level 2 beside Level 1 for every colony that can supply a profile. */}
      {colonyAssessments.length > 0 && (
        <Panel>
          <PanelHeader
            title="Level 2 Effective Area, where a colony provides a profile"
            subtitle="ASME B31G para. 2.3"
            actions={
              <span className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:border-slate-700">
                {colonyAssessments.length} colon{colonyAssessments.length === 1 ? 'y' : 'ies'}
              </span>
            }
          />
          <Callout>
            Interacting features must be assessed as one flaw. At Level 1 that means the deepest depth over
            the whole colony extent, which counts the sound metal between the boxes as gone. Level 2
            evaluates the profile instead. A single feature cannot support this — one box carries no profile —
            so only colonies appear here.
          </Callout>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-[11px]">
              <thead>
                <tr className="text-[9px] font-bold uppercase tracking-wide text-slate-400">
                  <th className="pb-1.5">Location</th>
                  <th className="pb-1.5 text-right">Boxes</th>
                  <th className="pb-1.5 text-right">Merged extent</th>
                  <th className="pb-1.5 text-right">Max depth</th>
                  <th className="pb-1.5 text-right">Level 1 ERF</th>
                  <th className="pb-1.5 text-right">Level 2 ERF</th>
                  <th className="pb-1.5 text-right">P_safe recovered</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {colonyAssessments.map((colony) => (
                  <tr key={colony.id}>
                    <td className="py-1.5 pr-2 tabular-nums text-slate-600 dark:text-slate-300">
                      {colony.startLd.toFixed(1)} – {colony.endLd.toFixed(1)} m
                      {colony.changesDisposition && (
                        <span
                          title="The merged Level 1 flaw reaches the review band; the profile does not."
                          className="ml-1.5 rounded border border-emerald-200 px-1 py-px text-[9px] font-bold uppercase tracking-wide text-emerald-600 dark:border-emerald-800/60 dark:text-emerald-400"
                        >
                          changes disposition
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-slate-500">{colony.members.length}</td>
                    <td className="py-1.5 text-right tabular-nums text-slate-500">
                      {colony.mergedLengthMm.toFixed(0)} mm
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-slate-500">
                      {colony.maxDepthPct.toFixed(1)} %
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-amber-600 dark:text-amber-400">
                      {formatErf(colony.level1Erf)}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-slate-700 dark:text-slate-200">
                      {colony.level2Erf === null ? '—' : formatErf(colony.level2Erf)}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-slate-500">
                      {colony.recoveredSafePressureMpa === null
                        ? '—'
                        : `${colony.recoveredSafePressureMpa >= 0 ? '+' : ''}${colony.recoveredSafePressureMpa.toFixed(2)} MPa`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[10px] leading-snug text-slate-400 dark:text-slate-500">
            Level 2 uses the measured area rather than Level 1's assumed pit shape, so a recovery is not
            guaranteed: a colony of square-shouldered boxes can be worse than the 0.85 shape factor assumes.
            Both results carry the same safety factor and required pressure.
          </p>
        </Panel>
      )}

      <Callout tone="warn">
        <strong>Use limitation.</strong> This workspace is a transparent screening tool. Final fitness-for-service
        disposition requires an approved procedure, verified input data, a competent technical authority, and
        independent checking. The conservative and forecast tiers are screening assumptions, not code
        requirements.
      </Callout>
    </div>
  );
}
