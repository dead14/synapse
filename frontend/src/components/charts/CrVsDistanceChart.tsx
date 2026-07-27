import { useRef, useMemo } from 'react';
import { Scatter } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  LinearScale,
  PointElement,
  Tooltip,
  Legend
} from 'chart.js';

ChartJS.register(LinearScale, PointElement, Tooltip, Legend);

interface CrVsDistanceChartProps {
  data: any[];
  filters: {
    matched: string;
    unmatched: string;
    defectTypes: { internal: boolean; external: boolean };
  };
}

const asNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '-') return null;
  const parsed = parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
};

const isMatchedRow = (row: any) => row['Match/Unmatch'] === 'Matched' || row['Match/Unmatch'] === 'Match';

/**
 * Corrosion rate in mm/yr for one comparison row, derived from the %WT depths
 * and wall thickness. Matched rows use the engine's Depth Growth (%WT/yr) when
 * present, else the raw depth delta over the run-year span. Unmatched NEW rows
 * get an estimated rate assuming the feature initiated after the OLD run.
 * Returns null when the quantities needed are absent.
 */
export function corrosionRateMmPerYear(row: any): number | null {
  const depth2Pct = asNumber(row['Depth NEW (%WT)']);
  const wt = asNumber(row['Wall WT NEW (mm)']) ?? asNumber(row['Wall WT OLD (mm)']);
  if (depth2Pct === null || wt === null) return null;

  const oldYear = asNumber(row['Run Year OLD']);
  const newYear = asNumber(row['Run Year NEW']);
  const yearSpan = oldYear !== null && newYear !== null && newYear > oldYear ? newYear - oldYear : null;

  const depth1Pct = asNumber(row['Depth OLD (%WT)']);
  if (isMatchedRow(row)) {
    if (depth1Pct === null) return null;
    const growthPctPerYear = asNumber(row['Depth Growth (%WT/yr)'])
      ?? (yearSpan !== null ? (depth2Pct - depth1Pct) / yearSpan : null);
    return growthPctPerYear !== null ? (growthPctPerYear / 100) * wt : null;
  }
  return yearSpan !== null ? ((depth2Pct / 100) * wt) / yearSpan : null;
}

export default function CrVsDistanceChart({ data, filters }: CrVsDistanceChartProps) {
  const chartRef = useRef<any>(null);

  const chartData = useMemo(() => {
    // For CR we'll plot CR for Matched and potentially estimated CR for Unmatched.
    const matchedCRs: any[] = [];
    const unmatchedNewCRs: any[] = [];

    data.forEach(row => {
      const dist2 = asNumber(row['Log Dist NEW (m)']);
      if (dist2 === null) return;

      const cr = corrosionRateMmPerYear(row);
      if (cr === null) return;

      if (isMatchedRow(row)) {
        if (filters.matched === 'Both' || filters.matched === 'Run 2') {
          matchedCRs.push({ x: dist2, y: cr, raw: row });
        }
      } else {
        if (filters.unmatched === 'Both' || filters.unmatched === 'Run 2') {
          unmatchedNewCRs.push({ x: dist2, y: cr, raw: row });
        }
      }
    });

    return { matchedCRs, unmatchedNewCRs };
  }, [data, filters]);

  const hasPoints = chartData.matchedCRs.length + chartData.unmatchedNewCRs.length > 0;

  const datasets = [
    {
      label: 'Matched Defect CR',
      data: chartData.matchedCRs,
      backgroundColor: 'purple',
      pointStyle: 'triangle',
      radius: 5,
    },
    {
      label: 'Unmatched (New) Estimated CR',
      data: chartData.unmatchedNewCRs,
      backgroundColor: 'transparent',
      borderColor: 'purple',
      borderWidth: 1.5,
      pointStyle: 'triangle',
      radius: 5,
    }
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
          text: 'Corrosion Rate [mm/yr]'
        }
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
            return `${context.dataset.label}: Dist ${pt.x.toFixed(3)}m, CR ${pt.y.toFixed(3)} mm/yr`;
          }
        }
      }
    }
  };

  return (
    <div className="w-full h-full relative" style={{ minHeight: '400px' }}>
      {!hasPoints && (
        <div className="absolute inset-0 z-10 flex items-center justify-center text-sm text-gray-400">
          No corrosion rate could be derived (requires NEW depth, wall thickness, and run years)
        </div>
      )}
      <Scatter
        ref={chartRef}
        data={{ datasets }}
        options={options}
      />
    </div>
  );
}
