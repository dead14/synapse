import React from 'react';
import { Doughnut } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend
} from 'chart.js';

ChartJS.register(ArcElement, Tooltip, Legend);

interface Props {
  data: {
    matched: number;
    newFeature: number;
    removedFeature: number;
  };
}

const FeatureCompositionChart: React.FC<Props> = ({ data }) => {
  const chartData = {
    labels: ['Matched', 'New Feature (Only NEW)', 'Removed Feature (Only OLD)'],
    datasets: [
      {
        data: [data.matched, data.newFeature, data.removedFeature],
        backgroundColor: [
          '#10B981', // Matched (Green)
          '#3C50E0', // New Feature (Blue)
          '#F87171', // Removed Feature (Red)
        ],
        borderWidth: 0,
      }
    ]
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '75%',
    plugins: {
      legend: {
        position: 'bottom' as const,
      }
    }
  };

  return <div className="h-[250px]"><Doughnut data={chartData} options={options} /></div>;
};

export default FeatureCompositionChart;
