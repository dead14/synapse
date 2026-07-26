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
import type { Plugin } from 'chart.js';

ChartJS.register(LinearScale, PointElement, LineElement, Tooltip, Legend);

interface DepthVsDistanceChartProps {
  data: any[];
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

export default function DepthVsDistanceChart({ data, filters }: DepthVsDistanceChartProps) {
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
        lines.push({ x1: dist1, y1: depth1, x2: dist2, y2: depth2, color: '#cbd5e1' });
      }
    });

    return { run1Matched, run1Unmatched, run2Matched, run2Unmatched, lines };
  }, [data, filters]);

  const hasPoints = chartData.run1Matched.length + chartData.run1Unmatched.length
    + chartData.run2Matched.length + chartData.run2Unmatched.length > 0;

  const matchLinesPlugin: Plugin = {
    id: 'matchLinesPlugin',
    beforeDraw(chart) {
      const { ctx, chartArea, scales: { x, y } } = chart;
      if (!chartArea || !x || !y) return; // Prevent crash on initial render
      
      ctx.save();
      
      chartData.lines.forEach(line => {
        const x1Px = x.getPixelForValue(line.x1);
        const y1Px = y.getPixelForValue(line.y1);
        const x2Px = x.getPixelForValue(line.x2);
        const y2Px = y.getPixelForValue(line.y2);

        // Simple culling
        if (
          Math.max(x1Px, x2Px) >= chartArea.left &&
          Math.min(x1Px, x2Px) <= chartArea.right &&
          Math.max(y1Px, y2Px) >= chartArea.top &&
          Math.min(y1Px, y2Px) <= chartArea.bottom
        ) {
          ctx.beginPath();
          ctx.moveTo(x1Px, y1Px);
          ctx.lineTo(x2Px, y2Px);
          ctx.lineWidth = 1;
          ctx.strokeStyle = line.color;
          ctx.stroke();
        }
      });
      ctx.restore();
    }
  };

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
            return `${context.dataset.label}: Dist ${pt.x.toFixed(3)}m, Depth ${pt.y}`;
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
        plugins={[matchLinesPlugin]}
      />
    </div>
  );
}
