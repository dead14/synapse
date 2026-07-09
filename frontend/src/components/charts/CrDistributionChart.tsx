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
    const validData = data.slice(1);
    
    const YEARS_DIFF = 5; 
    const crValues: number[] = [];

    validData.forEach(row => {
      const isMatched = row['Match/Unmatch'] === 'Matched';
      
      const depth1 = parseFloat(row['Unnamed: 37']);
      const depth2 = parseFloat(row['Unnamed: 10']);

      if (isMatched && !isNaN(depth1) && !isNaN(depth2)) {
        if (filters.matched === 'Both' || filters.matched === 'Run 2') {
           crValues.push((depth2 - depth1) / YEARS_DIFF);
        }
      } else if (!isMatched && !isNaN(depth2)) {
        if (filters.unmatched === 'Both' || filters.unmatched === 'Run 2') {
           crValues.push(depth2 / YEARS_DIFF);
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

    return { labels, bins };
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
      <Bar 
        data={{ labels: chartData.labels, datasets }} 
        options={options} 
      />
    </div>
  );
}
