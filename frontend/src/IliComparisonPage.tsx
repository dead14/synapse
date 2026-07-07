import React, { useState, useEffect } from 'react';
import { Doughnut, Scatter } from 'react-chartjs-2';
import { Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale, LinearScale, PointElement, Title } from 'chart.js';
import { FiBell, FiSettings, FiLink, FiAlertTriangle, FiClock, FiPlusCircle } from 'react-icons/fi';
import ResultsPanel from './ResultsPanel';

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, PointElement, Title);

export default function IliComparisonPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Generate dummy data since backend is not connected
    const generateDummyData = () => {
      const dummy = [{ /* header row */ }]; 
      
      // Matched data 14 / 1
      dummy.push({
        'Unnamed: 29': '14', 'DATA LAMA 2020 (Vendor Lama)  >': 20.055, 'Unnamed: 37': '1.31', 'Unnamed: 35': '25.0', 'Unnamed: 32': '0.65', 'Unnamed: 33': '8.74', 'Unnamed: 34': '202.5',
        'Unnamed: 2': '1', '<  DATA BARU 2025 (Vendor Baru)': 19.889, 'Unnamed: 10': '1.75', 'Unnamed: 8': '28.0', 'Unnamed: 5': '0.65', 'Unnamed: 6': '8.74', 'Unnamed: 7': '202.5'
      });
      // Matched data 37 / 2
      dummy.push({
        'Unnamed: 29': '37', 'DATA LAMA 2020 (Vendor Lama)  >': 288.472, 'Unnamed: 37': '0.96', 'Unnamed: 35': '18.0', 'Unnamed: 32': '7.66', 'Unnamed: 33': '8.74', 'Unnamed: 34': '25',
        'Unnamed: 2': '2', '<  DATA BARU 2025 (Vendor Baru)': 288.223, 'Unnamed: 10': '1.05', 'Unnamed: 8': '20.0', 'Unnamed: 5': '7.66', 'Unnamed: 6': '8.74', 'Unnamed: 7': '25'
      });
      // Unmatched New data (only Run 2) - Defects 3, 4, 6
      dummy.push({
        'Unnamed: 29': '', 'DATA LAMA 2020 (Vendor Lama)  >': null, 'Unnamed: 37': '', 'Unnamed: 35': '', 'Unnamed: 32': '', 'Unnamed: 33': '', 'Unnamed: 34': '',
        'Unnamed: 2': '3', '<  DATA BARU 2025 (Vendor Baru)': 596.014, 'Unnamed: 10': '0.72', 'Unnamed: 8': '12.0', 'Unnamed: 5': '3.21', 'Unnamed: 6': '6.40', 'Unnamed: 7': '110'
      });
      dummy.push({
        'Unnamed: 29': '', 'DATA LAMA 2020 (Vendor Lama)  >': null, 'Unnamed: 37': '', 'Unnamed: 35': '', 'Unnamed: 32': '', 'Unnamed: 33': '', 'Unnamed: 34': '',
        'Unnamed: 2': '4', '<  DATA BARU 2025 (Vendor Baru)': 619.582, 'Unnamed: 10': '0.67', 'Unnamed: 8': '11.0', 'Unnamed: 5': '4.11', 'Unnamed: 6': '6.40', 'Unnamed: 7': '120'
      });
      dummy.push({
        'Unnamed: 29': '', 'DATA LAMA 2020 (Vendor Lama)  >': null, 'Unnamed: 37': '', 'Unnamed: 35': '', 'Unnamed: 32': '', 'Unnamed: 33': '', 'Unnamed: 34': '',
        'Unnamed: 2': '6', '<  DATA BARU 2025 (Vendor Baru)': 619.696, 'Unnamed: 10': '0.61', 'Unnamed: 8': '10.5', 'Unnamed: 5': '4.22', 'Unnamed: 6': '6.40', 'Unnamed: 7': '125'
      });
      // Double Match example (Defect 87 -> 11, 13)
      dummy.push({
        'Unnamed: 29': '87', 'DATA LAMA 2020 (Vendor Lama)  >': 679.704, 'Unnamed: 37': '1.39', 'Unnamed: 35': '20.0', 'Unnamed: 32': '0.05', 'Unnamed: 33': '5.56', 'Unnamed: 34': '152.5',
        'Unnamed: 2': '11', '<  DATA BARU 2025 (Vendor Baru)': 679.214, 'Unnamed: 10': '0.56', 'Unnamed: 8': '15.0', 'Unnamed: 5': '0.05', 'Unnamed: 6': '5.56', 'Unnamed: 7': '152.5'
      });
      dummy.push({
        'Unnamed: 29': '87', 'DATA LAMA 2020 (Vendor Lama)  >': 679.704, 'Unnamed: 37': '1.39', 'Unnamed: 35': '20.0', 'Unnamed: 32': '0.05', 'Unnamed: 33': '5.56', 'Unnamed: 34': '152.5',
        'Unnamed: 2': '13', '<  DATA BARU 2025 (Vendor Baru)': 679.297, 'Unnamed: 10': '1.45', 'Unnamed: 8': '22.0', 'Unnamed: 5': '0.15', 'Unnamed: 6': '5.56', 'Unnamed: 7': '152.5'
      });

      // Data for Distance filter 5300-5350
      dummy.push({
        'Unnamed: 29': '709', 'DATA LAMA 2020 (Vendor Lama)  >': 5302.224, 'Unnamed: 37': '0.56', 'Unnamed: 35': '15.0', 'Unnamed: 32': '1.20', 'Unnamed: 33': '6.00', 'Unnamed: 34': '90',
        'Unnamed: 2': '247', '<  DATA BARU 2025 (Vendor Baru)': 5300.307, 'Unnamed: 10': '0.56', 'Unnamed: 8': '15.0', 'Unnamed: 5': '1.20', 'Unnamed: 6': '6.00', 'Unnamed: 7': '90'
      });
      // Defect 717 mapped to 250 and 252 (Double match / intervention target)
      dummy.push({
        'Unnamed: 29': '717', 'DATA LAMA 2020 (Vendor Lama)  >': 5320.274, 'Unnamed: 37': '0.72', 'Unnamed: 35': '18.0', 'Unnamed: 32': '2.10', 'Unnamed: 33': '6.00', 'Unnamed: 34': '100',
        'Unnamed: 2': '250', '<  DATA BARU 2025 (Vendor Baru)': 5318.311, 'Unnamed: 10': '0.61', 'Unnamed: 8': '16.0', 'Unnamed: 5': '2.10', 'Unnamed: 6': '6.00', 'Unnamed: 7': '100'
      });
      dummy.push({
        'Unnamed: 29': '716', 'DATA LAMA 2020 (Vendor Lama)  >': 5320.269, 'Unnamed: 37': '0.61', 'Unnamed: 35': '14.0', 'Unnamed: 32': '2.05', 'Unnamed: 33': '6.00', 'Unnamed: 34': '105',
        'Unnamed: 2': '251', '<  DATA BARU 2025 (Vendor Baru)': 5318.312, 'Unnamed: 10': '0.61', 'Unnamed: 8': '14.0', 'Unnamed: 5': '2.05', 'Unnamed: 6': '6.00', 'Unnamed: 7': '105'
      });
      dummy.push({
        'Unnamed: 29': '717', 'DATA LAMA 2020 (Vendor Lama)  >': 5320.274, 'Unnamed: 37': '0.72', 'Unnamed: 35': '18.0', 'Unnamed: 32': '2.10', 'Unnamed: 33': '6.00', 'Unnamed: 34': '100',
        'Unnamed: 2': '252', '<  DATA BARU 2025 (Vendor Baru)': 5318.313, 'Unnamed: 10': '0.72', 'Unnamed: 8': '18.0', 'Unnamed: 5': '2.11', 'Unnamed: 6': '6.00', 'Unnamed: 7': '100'
      });
      
      // Some Unmatched Old data (only Run 1)
      dummy.push({
        'Unnamed: 29': '999', 'DATA LAMA 2020 (Vendor Lama)  >': 7200.123, 'Unnamed: 37': '1.10', 'Unnamed: 35': '12.0', 'Unnamed: 32': '4.50', 'Unnamed: 33': '7.00', 'Unnamed: 34': '180',
        'Unnamed: 2': '', '<  DATA BARU 2025 (Vendor Baru)': null, 'Unnamed: 10': '', 'Unnamed: 8': '', 'Unnamed: 5': '', 'Unnamed: 6': '', 'Unnamed: 7': ''
      });

      return { comparison: dummy };
    };

    setTimeout(() => {
      setData(generateDummyData());
      setLoading(false);
    }, 800);
  }, []);

  // Prepare dummy data for charts based on screenshot
  
  // 1. Status Distribution (Doughnut)
  const statusData = {
    labels: ['Active', 'Stable', 'Suspect', 'NDF', 'NEW'],
    datasets: [{
      data: [60, 19, 63, 5268, 52],
      backgroundColor: ['#ef4444', '#10b981', '#f59e0b', '#f97316', '#3b82f6'],
      borderWidth: 0,
      cutout: '75%',
    }]
  };
  
  const statusOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom' as const,
        labels: { boxWidth: 10, usePointStyle: true, font: { size: 10 } }
      }
    }
  };

  // 2. Depth Comparison (Scatter)
  // Generate cluster of points representing depth R1 vs R2
  const generateScatterPoints = () => {
     const points = [];
     for(let i=0; i<40; i++) {
        points.push({ x: 10 + Math.random()*20, y: 10 + Math.random()*25 + (Math.random() > 0.5 ? 10 : 0) });
     }
     return points;
  };
  
  const scatterData = {
    datasets: [
      {
        label: 'Active',
        data: generateScatterPoints().slice(0, 15),
        backgroundColor: '#ef4444',
      },
      {
        label: 'Stable',
        data: generateScatterPoints().slice(15, 25).map(p => ({x: p.x + 10, y: p.y - 5})),
        backgroundColor: '#10b981',
      },
      {
        label: 'Suspect',
        data: generateScatterPoints().slice(25, 40).map(p => ({x: p.x + 20, y: p.y + 5})),
        backgroundColor: '#f59e0b',
      }
    ]
  };

  const scatterOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { title: { display: true, text: 'Depth R1 (%WT)' }, grid: { color: '#f3f4f6' }, min: 0, max: 68 },
      y: { title: { display: true, text: 'Depth R2 (%WT)' }, grid: { color: '#f3f4f6' }, min: 0, max: 68 }
    }
  };

  // 3. Match Rate (Gauge / Doughnut)
  const matchRateData = {
    datasets: [{
      data: [5320, 142], // 5320 matched out of 5462
      backgroundColor: ['#0ea5e9', '#f1f5f9'],
      borderWidth: 0,
      cutout: '85%',
      circumference: 270,
      rotation: 225,
    }]
  };

  return (
    <div className="min-h-screen bg-[#f8f9fa] font-sans pb-12">
      
      {/* Header */}
      <div className="max-w-[1600px] mx-auto px-8 pt-8 pb-6 flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight flex items-center gap-2">
            Hi, Engineer! <span className="text-2xl">👋</span>
          </h1>
          <p className="text-sm text-gray-500 mt-1">Upload two ILI survey files to begin the 4-layer alignment process.</p>
        </div>
        <div className="flex gap-4">
          <button className="p-2 text-gray-400 hover:text-gray-900 bg-white border border-gray-200 rounded-full hover:bg-gray-50 shadow-sm transition-colors">
            <FiBell size={20} />
          </button>
          <button className="p-2 text-gray-400 hover:text-gray-900 bg-white border border-gray-200 rounded-full hover:bg-gray-50 shadow-sm transition-colors">
            <FiSettings size={20} />
          </button>
        </div>
      </div>

      <div className="max-w-[1600px] mx-auto px-8 flex flex-col gap-6">
        
        {/* KPI Cards Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {/* Matched Pairs */}
          <div className="bg-[#e6fcf5] border border-[#a7f3d0] rounded-2xl p-6 shadow-sm relative overflow-hidden group">
             <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center text-green-500 mb-4 shadow-sm border border-green-100">
                <FiLink size={18} />
             </div>
             <h2 className="text-4xl font-black text-gray-900 mb-1">142</h2>
             <p className="text-sm text-gray-600 font-medium">Matched Pairs</p>
          </div>

          {/* Active Corrosion */}
          <div className="bg-[#fff1f2] border border-[#fecdd3] rounded-2xl p-6 shadow-sm relative overflow-hidden">
             <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center text-rose-500 mb-4 shadow-sm border border-rose-100">
                <FiAlertTriangle size={18} />
             </div>
             <h2 className="text-4xl font-black text-gray-900 mb-1">60</h2>
             <p className="text-sm text-gray-600 font-medium">Active Corrosion</p>
          </div>

          {/* NDF */}
          <div className="bg-[#fffbeb] border border-[#fde68a] rounded-2xl p-6 shadow-sm relative overflow-hidden">
             <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center text-amber-500 mb-4 shadow-sm border border-amber-100">
                <FiClock size={18} />
             </div>
             <h2 className="text-4xl font-black text-gray-900 mb-1">5268</h2>
             <p className="text-sm text-gray-600 font-medium">Not Detected (NDF)</p>
          </div>

          {/* New Anomalies */}
          <div className="bg-[#eff6ff] border border-[#bfdbfe] rounded-2xl p-6 shadow-sm relative overflow-hidden">
             <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center text-blue-500 mb-4 shadow-sm border border-blue-100">
                <FiPlusCircle size={18} />
             </div>
             <h2 className="text-4xl font-black text-gray-900 mb-1">52</h2>
             <p className="text-sm text-gray-600 font-medium">New Anomalies</p>
          </div>
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[340px]">
          
          {/* Status Distribution */}
          <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm flex flex-col items-center justify-center relative">
             <h3 className="text-sm font-bold text-gray-700 absolute top-6 text-center w-full">Status Distribution</h3>
             <div className="w-full h-48 mt-8 relative">
               <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                 <span className="text-2xl font-black text-gray-900">5462</span>
                 <span className="text-xs text-gray-500 font-medium">Total</span>
               </div>
               <Doughnut data={statusData} options={statusOptions} />
             </div>
          </div>

          {/* Depth Comparison */}
          <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm relative flex flex-col">
             <h3 className="text-sm font-bold text-gray-700 text-center mb-4">Depth Comparison (R1 vs R2)</h3>
             <div className="flex-1 w-full min-h-0 relative">
                <Scatter data={scatterData} options={scatterOptions} />
             </div>
          </div>

          {/* Match Rate */}
          <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm flex flex-col items-center justify-center relative">
             <h3 className="text-sm font-bold text-gray-700 absolute top-6 text-center w-full">Match Rate</h3>
             <div className="w-full h-48 mt-8 relative">
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none mt-4">
                 <span className="text-4xl font-black text-gray-900">97%</span>
                 <span className="text-xs text-gray-500 font-medium mt-1">5320 of 5462</span>
               </div>
               <Doughnut data={matchRateData} options={{...statusOptions, plugins: { legend: {display: false} }}} />
             </div>
          </div>

        </div>

        {/* Full-width Results Table */}
        <div className="w-full h-[600px]">
           {/* Wrapping ResultsPanel to ensure it takes the height and looks cohesive */}
           <ResultsPanel data={data?.comparison || []} loading={loading} />
        </div>

      </div>
    </div>
  );
}
