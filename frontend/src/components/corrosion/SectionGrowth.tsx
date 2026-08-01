import { useMemo, useState } from 'react';

import { growthBySection, type SectionGrowth as SectionGrowthRow } from '../../lib/corrosion/analytics';
import type { CorrosionFeature } from '../../lib/corrosion/analysis';
import { sectionBandColor } from '../../lib/sections/bands';
import { VizFrame, niceTicks, useVizTooltip } from './vizPrimitives';

interface Props {
  features: CorrosionFeature[];
  /** Rows shown before the list is truncated. */
  limit?: number;
}

const PLOT = { width: 960, height: 240, left: 44, right: 12, top: 12, bottom: 30 };

function pct(value: number | null, digits = 2): string {
  return value === null ? '—' : `${value.toFixed(digits)} %WT/y`;
}

function mm(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(3)} mm/y`;
}

function kpSpan(row: SectionGrowthRow): string {
  if (row.startM === null || row.endM === null) return 'no distance reported';
  const start = row.startM / 1000;
  const end = row.endM / 1000;
  if (Math.abs(end - start) < 0.005) return `KP ${start.toFixed(2)}`;
  return `KP ${start.toFixed(2)}–${end.toFixed(2)}`;
}

/**
 * Corrosion growth rate per section, with the KP span each section covers.
 *
 * The per-KP density profile answers "where are the anomalies"; this answers
 * "how fast is each named stretch actually corroding", which is the number a
 * reassessment interval is set from. Each section shows its P95 rate — the one
 * an assessment would be run at — against its mean, because a mean over a
 * tolerance-driven population understates the rate that is really occurring.
 */
export default function SectionGrowth({ features, limit = 12 }: Props) {
  const rows = useMemo(() => growthBySection(features), [features]);
  const [expanded, setExpanded] = useState(false);
  const { frameRef, show, hide, node } = useVizTooltip();

  if (rows.length === 0) {
    return <p className="viz-note">No sectioned features on this run, so growth cannot be split by section.</p>;
  }

  const visible = expanded ? rows : rows.slice(0, limit);
  const withRates = rows.filter((row) => row.p95PctWtPerYear !== null || row.maxPctWtPerYear !== null);

  if (withRates.length === 0) {
    return (
      <p className="viz-note">
        The sections are defined, but no feature in them carries a growth rate — the run pair produced no
        matched depth change to derive one from.
      </p>
    );
  }

  const max = Math.max(
    0.01,
    ...visible.map((row) => Math.max(row.p95PctWtPerYear ?? 0, row.meanPctWtPerYear ?? 0)),
  );
  const ticks = niceTicks(max);
  const axisMax = Math.max(max, ticks[ticks.length - 1]);

  const plotWidth = PLOT.width - PLOT.left - PLOT.right;
  const plotHeight = PLOT.height - PLOT.top - PLOT.bottom;
  const slot = plotWidth / visible.length;
  const barWidth = Math.max(4, Math.min(48, slot * 0.62));
  const yOf = (rate: number) => PLOT.top + plotHeight - (Math.min(rate, axisMax) / axisMax) * plotHeight;

  const worst = withRates[0];
  const negativeHeavy = rows.filter((row) => row.measured > 0 && row.negative / row.measured > 0.3);

  return (
    <VizFrame
      frameRef={frameRef}
      tooltip={node}
      note={
        <>
          <strong>{worst.section}</strong> ({kpSpan(worst)}) is growing fastest at{' '}
          <strong>{pct(worst.p95PctWtPerYear ?? worst.maxPctWtPerYear)}</strong> on its 95th percentile
          {worst.meanMmPerYear !== null && <> — about {mm(worst.meanMmPerYear)} of wall on average</>}.
          {' '}That rate, not the line-wide average, is what sets the next assessment date for this stretch.
          {negativeHeavy.length > 0 && (
            <>
              {' '}
              {negativeHeavy.length === 1
                ? <><strong>{negativeHeavy[0].section}</strong> reports more than a third of its features shrinking</>
                : <>{negativeHeavy.length} sections report more than a third of their features shrinking</>}
              , which is a sizing difference between the two vendors rather than real recovery — treat those
              rates as unusable.
            </>
          )}
        </>
      }
    >
      <svg
        className="viz-plot"
        viewBox={`0 0 ${PLOT.width} ${PLOT.height}`}
        role="img"
        aria-label="Corrosion growth rate per section"
        preserveAspectRatio="xMidYMid meet"
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line className="viz-grid-line" x1={PLOT.left} x2={PLOT.width - PLOT.right} y1={yOf(tick)} y2={yOf(tick)} />
            <text className="viz-tick" x={PLOT.left - 6} y={yOf(tick) + 3} textAnchor="end">{tick}</text>
          </g>
        ))}

        {visible.map((row, index) => {
          const center = PLOT.left + slot * (index + 0.5);
          const p95 = row.p95PctWtPerYear ?? 0;
          const mean = row.meanPctWtPerYear;
          const top = yOf(p95);
          return (
            <g key={row.section}>
              <rect
                className="viz-hit"
                x={center - barWidth / 2}
                y={top}
                width={barWidth}
                height={Math.max(1, PLOT.top + plotHeight - top)}
                fill={sectionBandColor(row.section)}
                opacity={0.85}
                onMouseMove={(event) => show(event, `${row.section} · ${kpSpan(row)}`, [
                  { label: 'P95 growth', value: pct(row.p95PctWtPerYear) },
                  { label: 'Mean growth', value: pct(row.meanPctWtPerYear) },
                  { label: 'Fastest feature', value: pct(row.maxPctWtPerYear) },
                  { label: 'Mean in wall', value: mm(row.meanMmPerYear) },
                  { label: 'Features', value: `${row.total.toLocaleString()} (${row.measured.toLocaleString()} measured)` },
                  { label: 'Active', value: row.active.toLocaleString() },
                  { label: 'Shrinking', value: row.negative.toLocaleString() },
                  {
                    label: 'Soonest limit',
                    value: row.worstRemainingLife === null
                      ? '—'
                      : row.worstRemainingLife < 1 ? '< 1 yr' : `${row.worstRemainingLife.toFixed(1)} yr`,
                  },
                ])}
                onMouseLeave={hide}
              />
              {/* The mean sits as a rule inside the P95 bar: the gap between the
                  two is the spread the section's rate carries. */}
              {mean !== null && mean > 0 && (
                <line
                  x1={center - barWidth / 2}
                  x2={center + barWidth / 2}
                  y1={yOf(mean)}
                  y2={yOf(mean)}
                  stroke="var(--viz-axis)"
                  strokeWidth={1.5}
                  strokeDasharray="3 2"
                />
              )}
              {slot > 34 && (
                <text
                  className="viz-tick"
                  x={center}
                  y={PLOT.height - 16}
                  textAnchor="middle"
                >
                  {row.section.length > 9 ? `${row.section.slice(0, 8)}…` : row.section}
                </text>
              )}
            </g>
          );
        })}

        <line className="viz-axis-line" x1={PLOT.left} x2={PLOT.width - PLOT.right} y1={PLOT.top + plotHeight} y2={PLOT.top + plotHeight} />
        <text className="viz-axis-title" x={PLOT.left} y={PLOT.height - 1}>
          Growth rate [%WT/year] — bar is P95, dashed rule is the mean
        </text>
      </svg>

      <div className="ds-table-wrap">
        <table className="ds-table">
          <caption className="sr-only">Corrosion growth rate per section</caption>
          <thead>
            <tr>
              <th scope="col">Section</th>
              <th scope="col">Extent</th>
              <th scope="col" className="ds-table__num">Features</th>
              <th scope="col" className="ds-table__num">Measured</th>
              <th scope="col" className="ds-table__num">Mean</th>
              <th scope="col" className="ds-table__num">P95</th>
              <th scope="col" className="ds-table__num">Max</th>
              <th scope="col" className="ds-table__num">Mean in wall</th>
              <th scope="col" className="ds-table__num">Active</th>
              <th scope="col" className="ds-table__num">Shrinking</th>
              <th scope="col" className="ds-table__num">Soonest limit</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.section}>
                <th scope="row">
                  <span
                    className="section-band-legend__swatch"
                    style={{ background: sectionBandColor(row.section), display: 'inline-block', marginRight: '0.375rem' }}
                    aria-hidden="true"
                  />
                  {row.section}
                </th>
                <td>{kpSpan(row)}</td>
                <td className="ds-table__num">{row.total.toLocaleString()}</td>
                <td className="ds-table__num">{row.measured.toLocaleString()}</td>
                <td className="ds-table__num">{row.meanPctWtPerYear === null ? '—' : row.meanPctWtPerYear.toFixed(2)}</td>
                <td className="ds-table__num">{row.p95PctWtPerYear === null ? '—' : row.p95PctWtPerYear.toFixed(2)}</td>
                <td className="ds-table__num">{row.maxPctWtPerYear === null ? '—' : row.maxPctWtPerYear.toFixed(2)}</td>
                <td className="ds-table__num">{row.meanMmPerYear === null ? '—' : row.meanMmPerYear.toFixed(3)}</td>
                <td className="ds-table__num">{row.active.toLocaleString()}</td>
                <td className="ds-table__num">{row.negative.toLocaleString()}</td>
                <td className="ds-table__num">
                  {row.worstRemainingLife === null
                    ? '—'
                    : row.worstRemainingLife < 1 ? '< 1 yr' : `${row.worstRemainingLife.toFixed(1)} yr`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length > limit && (
        <button type="button" className="section-band-legend__more" onClick={() => setExpanded((open) => !open)}>
          {expanded ? 'Show the fastest sections only' : `Show all ${rows.length} sections`}
        </button>
      )}
    </VizFrame>
  );
}
