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

interface OrientationVsDistanceChartProps {
  data: any[];
  filters: {
    matched: string;
    unmatched: string;
    multiMatchOnly: boolean;
    defectTypes: { internal: boolean; external: boolean };
    visualType: string;
  };
}

export default function OrientationVsDistanceChart({ data, filters }: OrientationVsDistanceChartProps) {
  const chartRef = useRef<any>(null);

  const chartData = useMemo(() => {
    const validData = data.slice(1);

    const run1Matched: any[] = [];
    const run1Unmatched: any[] = [];
    const run2Matched: any[] = [];
    const run2Unmatched: any[] = [];
    const lines: any[] = [];

    validData.forEach(row => {
      // Run 1 Data
      const dist1 = typeof row['DATA LAMA 2020 (Vendor Lama)  >'] === 'number' 
        ? row['DATA LAMA 2020 (Vendor Lama)  >'] - 0.1
        : null;
      const orient1 = parseFloat(row['Unnamed: 34']);

      // Run 2 Data
      const dist2 = typeof row['<  DATA BARU 2025 (Vendor Baru)'] === 'number'
        ? row['<  DATA BARU 2025 (Vendor Baru)']
        : null;
      const orient2 = parseFloat(row['Unnamed: 7']);

      const isMatched = row['Match/Unmatch'] === 'Matched';

      if (dist1 !== null && !isNaN(orient1)) {
        const pt = { x: dist1, y: orient1, raw: row, isRun1: true };
        if (isMatched) {
          if (filters.matched === 'Both' || filters.matched === 'Run 1') run1Matched.push(pt);
        } else {
          if (filters.unmatched === 'Both' || filters.unmatched === 'Run 1') run1Unmatched.push(pt);
        }
      }

      if (dist2 !== null && !isNaN(orient2)) {
        const pt = { x: dist2, y: orient2, raw: row, isRun1: false };
        if (isMatched) {
          if (filters.matched === 'Both' || filters.matched === 'Run 2') run2Matched.push(pt);
        } else {
          if (filters.unmatched === 'Both' || filters.unmatched === 'Run 2') run2Unmatched.push(pt);
        }
      }

      // Add line if matched
      if (isMatched && dist1 !== null && !isNaN(orient1) && dist2 !== null && !isNaN(orient2)) {
        lines.push({ x1: dist1, y1: orient1, x2: dist2, y2: orient2, color: 'black' });
      }
    });

    return { run1Matched, run1Unmatched, run2Matched, run2Unmatched, lines };
  }, [data, filters]);

  const matchLinesPlugin: Plugin = {
    id: 'matchLinesPlugin',
    beforeDraw(chart) {
      const { ctx, chartArea, scales: { x, y } } = chart;
      if (!chartArea || !x || !y) return;
      
      ctx.save();
      
      chartData.lines.forEach(line => {
        const x1Px = x.getPixelForValue(line.x1);
        const y1Px = y.getPixelForValue(line.y1);
        const x2Px = x.getPixelForValue(line.x2);
        const y2Px = y.getPixelForValue(line.y2);

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
            return `${context.dataset.label}: Dist ${pt.x.toFixed(3)}m, Orient ${pt.y}°`;
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
        plugins={[matchLinesPlugin]}
      />
    </div>
  );
}
