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

import {
  SECTION_RIBBON_PADDING,
  sectionBandsPlugin,
  sectionTooltipLine,
} from '../../lib/sections/sectionBandsPlugin';
import type { SectionBandsPluginOptions } from '../../lib/sections/sectionBandsPlugin';

ChartJS.register(LinearScale, PointElement, LineElement, Tooltip, Legend, sectionBandsPlugin);

interface DepthVsDistanceChartProps {
  data: any[];
  /** Section ribbon config, when the run has been sectioned. */
  sectionBands?: SectionBandsPluginOptions;
  filters: {
    matched: string;
    unmatched: string;
    depthType: string;
    multiMatchOnly: boolean;
    defectTypes: { internal: boolean; external: boolean };
  };
}

const asNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '-') return null;
  const parsed = parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
};

const isMatchedRow = (row: any) => row['Match/Unmatch'] === 'Matched' || row['Match/Unmatch'] === 'Match';

export default function DepthVsDistanceChart({ data, filters, sectionBands }: DepthVsDistanceChartProps) {
  const chartRef = useRef<any>(null);

  // Parse data
  const chartData = useMemo(() => {
    const run1Matched: any[] = [];
    const run1Unmatched: any[] = [];
    const run2Matched: any[] = [];
    const run2Unmatched: any[] = [];
    const lines: any[] = [];

    data.forEach(row => {
      // Depths arrive as %WT; the absolute view converts through wall thickness.
      const toDepth = (pct: number | null, wt: number | null) => {
        if (filters.depthType === 'Percentage') return pct;
        return pct !== null && wt !== null ? (pct / 100) * wt : null;
      };

      // Run 1 (OLD) data
      const dist1 = asNumber(row['Log Dist OLD (m)']);
      const depth1 = toDepth(asNumber(row['Depth OLD (%WT)']), asNumber(row['Wall WT OLD (mm)']));

      // Run 2 (NEW) data
      const dist2 = asNumber(row['Log Dist NEW (m)']);
      const depth2 = toDepth(asNumber(row['Depth NEW (%WT)']), asNumber(row['Wall WT NEW (mm)']));

      const isMatched = isMatchedRow(row);

      if (dist1 !== null && depth1 !== null) {
        const pt = { x: dist1, y: depth1, raw: row, isRun1: true };
        if (isMatched) {
          if (filters.matched === 'Both' || filters.matched === 'Run 1') run1Matched.push(pt);
        } else {
          if (filters.unmatched === 'Both' || filters.unmatched === 'Run 1') run1Unmatched.push(pt);
        }
      }

      if (dist2 !== null && depth2 !== null) {
        const pt = { x: dist2, y: depth2, raw: row, isRun1: false };
        if (isMatched) {
          if (filters.matched === 'Both' || filters.matched === 'Run 2') run2Matched.push(pt);
        } else {
          if (filters.unmatched === 'Both' || filters.unmatched === 'Run 2') run2Unmatched.push(pt);
        }
      }

      // Add line if matched
      if (isMatched && dist1 !== null && depth1 !== null && dist2 !== null && depth2 !== null) {
        lines.push({ x1: dist1, y1: depth1, x2: dist2, y2: depth2 });
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


  // Memoised: a new plugin object on every render forces Chart.js to rebuild
  // its plugin state, and this one is rebuilt only when the ties change.
  const matchLinesPlugin = useMemo(
    () => createMatchLinesPlugin(chartData.lines, '#cbd5e1'),
    [chartData.lines],
  );
  const chartPlugins = useMemo(() => [matchLinesPlugin], [matchLinesPlugin]);

  const datasets = [
    {
      label: 'Matched, old ILI',
      data: chartData.run1Matched,
      backgroundColor: 'blue',
      pointStyle: 'rect',
      radius: 4,
    },
    {
      label: 'Matched, new ILI',
      data: chartData.run2Matched,
      backgroundColor: 'red',
      pointStyle: 'circle',
      radius: 4,
    },
    {
      label: 'Unmatched, old ILI',
      data: chartData.run1Unmatched,
      backgroundColor: 'transparent',
      borderColor: 'blue',
      borderWidth: 1.5,
      pointStyle: 'rect',
      radius: 4,
    },
    {
      label: 'Unmatched, new ILI',
      data: chartData.run2Unmatched,
      backgroundColor: 'transparent',
      borderColor: 'red',
      borderWidth: 1.5,
      pointStyle: 'circle',
      radius: 4,
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
          text: `Defect Depth [${filters.depthType === 'Absolute' ? 'mm' : '%'}]`
        },
        min: 0,
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
            const line = `${context.dataset.label}: Dist ${pt.x.toFixed(3)}m, Depth ${pt.y}`;
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
          No depth/distance values available in this result set
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
