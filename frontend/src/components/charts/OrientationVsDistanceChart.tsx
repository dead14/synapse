import { useRef, useMemo } from 'react';
import { Scatter } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend
} from 'chart.js';
import { createMatchLinesPlugin } from './matchLinesPlugin';
import { parseClockToDegrees } from '../../utils/clock';

import {
  SECTION_RIBBON_PADDING,
  sectionBandsPlugin,
  sectionTooltipLine,
} from '../../lib/sections/sectionBandsPlugin';
import type { SectionBandsPluginOptions } from '../../lib/sections/sectionBandsPlugin';

ChartJS.register(LinearScale, PointElement, LineElement, Tooltip, Legend, sectionBandsPlugin);

interface OrientationVsDistanceChartProps {
  data: any[];
  /** Section ribbon config, when the run has been sectioned. */
  sectionBands?: SectionBandsPluginOptions;
  filters: {
    matched: string;
    unmatched: string;
    multiMatchOnly: boolean;
    defectTypes: { internal: boolean; external: boolean };
    visualType: string;
  };
}

const asNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '-') return null;
  const parsed = parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
};

const isMatchedRow = (row: any) => row['Match/Unmatch'] === 'Matched' || row['Match/Unmatch'] === 'Match';

/** Clock position (HH:MM, numeric hours, or Excel serial) in degrees, or null when absent. */
const clockDegrees = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '-' || String(value).trim() === '') return null;
  const degrees = parseClockToDegrees(value);
  return Number.isFinite(degrees) ? degrees : null;
};

export default function OrientationVsDistanceChart({ data, filters, sectionBands }: OrientationVsDistanceChartProps) {
  const chartRef = useRef<any>(null);

  const chartData = useMemo(() => {
    const run1Matched: any[] = [];
    const run1Unmatched: any[] = [];
    const run2Matched: any[] = [];
    const run2Unmatched: any[] = [];
    const lines: any[] = [];

    data.forEach(row => {
      // Run 1 (OLD) data
      const dist1 = asNumber(row['Log Dist OLD (m)']);
      const orient1 = clockDegrees(row["O'Clock OLD"]);

      // Run 2 (NEW) data
      const dist2 = asNumber(row['Log Dist NEW (m)']);
      const orient2 = clockDegrees(row["O'Clock NEW"]);

      const isMatched = isMatchedRow(row);

      if (dist1 !== null && orient1 !== null) {
        const pt = { x: dist1, y: orient1, raw: row, isRun1: true };
        if (isMatched) {
          if (filters.matched === 'Both' || filters.matched === 'Run 1') run1Matched.push(pt);
        } else {
          if (filters.unmatched === 'Both' || filters.unmatched === 'Run 1') run1Unmatched.push(pt);
        }
      }

      if (dist2 !== null && orient2 !== null) {
        const pt = { x: dist2, y: orient2, raw: row, isRun1: false };
        if (isMatched) {
          if (filters.matched === 'Both' || filters.matched === 'Run 2') run2Matched.push(pt);
        } else {
          if (filters.unmatched === 'Both' || filters.unmatched === 'Run 2') run2Unmatched.push(pt);
        }
      }

      // Add line if matched
      if (isMatched && dist1 !== null && orient1 !== null && dist2 !== null && orient2 !== null) {
        lines.push({ x1: dist1, y1: orient1, x2: dist2, y2: orient2 });
      }
    });

    return { run1Matched, run1Unmatched, run2Matched, run2Unmatched, lines };
  }, [data, filters]);

  const hasPoints = chartData.run1Matched.length + chartData.run1Unmatched.length
    + chartData.run2Matched.length + chartData.run2Unmatched.length > 0;

  // A run pair routinely carries tens of thousands of features. Animating every
  // marker on every update is the dominant cost on a real dataset, so past this
  // size only the finished frame is drawn.
  const heavy = chartData.run1Matched.length + chartData.run1Unmatched.length
    + chartData.run2Matched.length + chartData.run2Unmatched.length > 2_000;


  const matchLinesPlugin = useMemo(
    () => createMatchLinesPlugin(chartData.lines, 'rgba(15,23,42,0.35)'),
    [chartData.lines],
  );
  const chartPlugins = useMemo(() => [matchLinesPlugin], [matchLinesPlugin]);

  const isRect = filters.visualType === 'Rectangles';

  const datasets = [
    {
      label: 'Matched, old ILI',
      data: chartData.run1Matched,
      backgroundColor: 'blue',
      pointStyle: isRect ? 'rect' : 'rect',
      radius: isRect ? 8 : 4,
    },
    {
      label: 'Matched, new ILI',
      data: chartData.run2Matched,
      backgroundColor: 'red',
      pointStyle: isRect ? 'rect' : 'circle',
      radius: isRect ? 8 : 4,
    },
    {
      label: 'Unmatched, old ILI',
      data: chartData.run1Unmatched,
      backgroundColor: 'transparent',
      borderColor: 'blue',
      borderWidth: 1.5,
      pointStyle: isRect ? 'rect' : 'rect',
      radius: isRect ? 8 : 4,
    },
    {
      label: 'Unmatched, new ILI',
      data: chartData.run2Unmatched,
      backgroundColor: 'transparent',
      borderColor: 'red',
      borderWidth: 1.5,
      pointStyle: isRect ? 'rect' : 'circle',
      radius: isRect ? 8 : 4,
    },
  ];

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    // Skip the transition and the per-update parse pass on a large population.
    animation: heavy ? (false as const) : undefined,
    parsing: false as const,
    interaction: { mode: 'nearest' as const, intersect: true, axis: 'xy' as const },
    // Reserve the strip the section ribbon is drawn in, so it never covers a point.
    layout: sectionBands ? { padding: { top: SECTION_RIBBON_PADDING } } : undefined,
    scales: {
      x: {
        type: 'linear' as const,
        position: 'bottom' as const,
        title: {
          display: true,
          text: 'Distance [m]'
        }
      },
      y: {
        title: {
          display: true,
          text: 'Orientation [°]'
        },
        min: 0,
        max: 360,
        reverse: true // Orientation is usually 0 at top (12 o'clock), 180 at bottom. Let's keep 0 on top.
      }
    },
    plugins: {
      sectionBands,
      legend: {
        position: 'top' as const,
        labels: {
          usePointStyle: true,
        }
      },
      tooltip: {
        callbacks: {
          label: (context: any) => {
            const pt = context.raw;
            const line = `${context.dataset.label}: Dist ${pt.x.toFixed(3)}m, Orient ${pt.y}°`;
            const band = sectionBands ? sectionTooltipLine(sectionBands.bands, pt.x) : null;
            return band ? [line, band] : line;
          }
        }
      }
    }
  };

  return (
    <div className="w-full h-full relative" style={{ minHeight: '400px' }}>
      {!hasPoints && (
        <div className="absolute inset-0 z-10 flex items-center justify-center text-sm text-gray-400">
          No orientation (o'clock) values available in this result set
        </div>
      )}
      <Scatter
        ref={chartRef}
        data={{ datasets }}
        options={options}
        plugins={chartPlugins}
      />
    </div>
  );
}
