import React from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

interface Props {
  data: { label: string; matchRate: number; confidence: number }[];
}

const AlignmentQualityTrendChart: React.FC<Props> = ({ data }) => {
  const chartData = {
    labels: data.map(d => d.label),
    datasets: [
      {
        label: 'Match Rate (%)',
        data: data.map(d => d.matchRate),
        borderColor: '#3C50E0',
        backgroundColor: 'rgba(60, 80, 224, 0.1)',
        tension: 0.4,
        fill: true,
      },
      {
        label: 'Confidence Score',
        data: data.map(d => d.confidence),
        borderColor: '#10B981',
        backgroundColor: 'transparent',
        borderDash: [5, 5],
        tension: 0.4,
      }
    ]
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top' as const,
      }
    },
    scales: {
      y: {
        min: 0,
        max: 100,
        ticks: { callback: (val: any) => val + '%' }
      }
    }
  };

  return <div className="h-[300px]"><Line data={chartData} options={options} /></div>;
};

export default AlignmentQualityTrendChart;
