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

export default function CrVsDistanceChart({ data, filters }: CrVsDistanceChartProps) {
  const chartRef = useRef<any>(null);

  const chartData = useMemo(() => {
    const validData = data.slice(1);
    
    // For CR we'll plot CR for Matched and potentially estimated CR for Unmatched.
    const matchedCRs: any[] = [];
    const unmatchedNewCRs: any[] = [];

    const YEARS_DIFF = 5; // Assuming 2020 to 2025 for now

    validData.forEach(row => {
      const isMatched = row['Match/Unmatch'] === 'Matched';

      // Distances
      const dist2 = typeof row['<  DATA BARU 2025 (Vendor Baru)'] === 'number' ? row['<  DATA BARU 2025 (Vendor Baru)'] : null;
      
      // Depths (Absolute mm)
      const depth1 = parseFloat(row['Unnamed: 37']);
      const depth2 = parseFloat(row['Unnamed: 10']);

      if (isMatched && dist2 !== null && !isNaN(depth1) && !isNaN(depth2)) {
        // Calculate CR (mm/yr)
        const cr = (depth2 - depth1) / YEARS_DIFF;
        
        if (filters.matched === 'Both' || filters.matched === 'Run 2') {
          matchedCRs.push({ x: dist2, y: cr, raw: row });
        }
      } else if (!isMatched && dist2 !== null && !isNaN(depth2)) {
        // Unmatched New - Assume it grew from 0 over 5 years? Or don't plot?
        // Let's plot it as an estimated CR
        const cr = depth2 / YEARS_DIFF;
        
        if (filters.unmatched === 'Both' || filters.unmatched === 'Run 2') {
          unmatchedNewCRs.push({ x: dist2, y: cr, raw: row });
        }
      }
    });

    return { matchedCRs, unmatchedNewCRs };
  }, [data, filters]);

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
      <Scatter 
        ref={chartRef}
        data={{ datasets }} 
        options={options} 
      />
    </div>
  );
}
