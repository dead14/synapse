import { useMemo } from 'react';
import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend
} from 'chart.js';
import { corrosionRateMmPerYear } from './CrVsDistanceChart';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

interface CrDistributionChartProps {
  data: any[];
  filters: {
    matched: string;
    unmatched: string;
    defectTypes: { internal: boolean; external: boolean };
    binSize?: number;
    maxCr?: number;
    minCr?: number;
  };
}

export default function CrDistributionChart({ data, filters }: CrDistributionChartProps) {

  const chartData = useMemo(() => {
    const crValues: number[] = [];

    data.forEach(row => {
      const isMatched = row['Match/Unmatch'] === 'Matched' || row['Match/Unmatch'] === 'Match';
      const cr = corrosionRateMmPerYear(row);
      if (cr === null) return;

      if (isMatched) {
        if (filters.matched === 'Both' || filters.matched === 'Run 2') {
          crValues.push(cr);
        }
      } else {
        if (filters.unmatched === 'Both' || filters.unmatched === 'Run 2') {
          crValues.push(cr);
        }
      }
    });

    // Histogram grouping
    const binSize = filters.binSize || 0.2;
    const minCr = filters.minCr !== undefined ? filters.minCr : -2;
    const maxCr = filters.maxCr !== undefined ? filters.maxCr : 2;
    
    const numBins = Math.ceil((maxCr - minCr) / binSize);
    const bins = Array(numBins).fill(0);
    const labels = Array(numBins).fill('');

    for (let i = 0; i < numBins; i++) {
      const start = minCr + i * binSize;
      const end = start + binSize;
      labels[i] = `${start.toFixed(1)} to ${end.toFixed(1)}`;
    }

    crValues.forEach(cr => {
      if (cr >= minCr && cr <= maxCr) {
        const binIndex = Math.min(Math.floor((cr - minCr) / binSize), numBins - 1);
        if (binIndex >= 0) {
          bins[binIndex]++;
        }
      }
    });

    return { labels, bins, count: crValues.length };
  }, [data, filters]);

  const datasets = [
    {
      label: 'Corrosion Rate Distribution',
      data: chartData.bins,
      backgroundColor: 'rgba(54, 162, 235, 0.6)',
      borderColor: 'rgba(54, 162, 235, 1)',
      borderWidth: 1,
    }
  ];

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: {
        title: {
          display: true,
          text: 'Corrosion Rate [mm/yr]'
        }
      },
      y: {
        title: {
          display: true,
          text: 'Count (Frequency)'
        },
        beginAtZero: true,
        ticks: {
          stepSize: 1
        }
      }
    }
  };

  return (
    <div className="w-full h-full relative" style={{ minHeight: '400px' }}>
      {chartData.count === 0 && (
        <div className="absolute inset-0 z-10 flex items-center justify-center text-sm text-gray-400">
          No corrosion rate could be derived (requires NEW depth, wall thickness, and run years)
        </div>
      )}
      <Bar
        data={{ labels: chartData.labels, datasets }}
        options={options}
      />
    </div>
  );
}
