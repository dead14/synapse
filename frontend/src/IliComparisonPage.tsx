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
      for(let i = 1; i <= 100; i++) {
        dummy.push({
          'Unnamed: 29': \`Defect \${i}\`,
          'DATA LAMA 2020 (Vendor Lama)  >': 1000 + i * 12.5,
          'Unnamed: 37': (10 + Math.random() * 20).toFixed(1),
          'Unnamed: 2': \`Defect \${i}A\`,
          '<  DATA BARU 2025 (Vendor Baru)': 1000 + i * 12.5 + (Math.random() * 0.2 - 0.1),
          'Unnamed: 10': (12 + Math.random() * 20).toFixed(1)
        });
      }
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
