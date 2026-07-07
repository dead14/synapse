import React, { useEffect, useState } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import { 
  FiActivity, FiAlertTriangle, FiCheckCircle, FiClock, FiArrowRight, FiArrowUpRight, FiArrowDownRight, FiPlus, FiUploadCloud, FiBox
} from 'react-icons/fi';
import AlignmentPage from './AlignmentPage';
import PipelineRuns from './PipelineRuns';
import IliComparisonPage from './IliComparisonPage';
import Layout from './Layout';
import RiskTrendChart from './components/charts/RiskTrendChart';
import AssetCompositionChart from './components/charts/AssetCompositionChart';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import { Line, Bar } from 'react-chartjs-2';
import { MapContainer, TileLayer, Marker, Popup, CircleMarker } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

const Dashboard = () => {
  const navigate = useNavigate();

  const runs = [
    { id: 'RUN-2024-01', name: 'HU-CPA Gas', start: 'Jakarta', end: 'Bandung', dateStart: '18 Nov', dateEnd: '24 Nov', dist: '168 km', color: 'bg-green-500', progress: 80 },
    { id: 'RUN-2024-02', name: 'BK-SGT Oil', start: 'Surabaya', end: 'Malang', dateStart: '01 Des', dateEnd: '02 Des', dist: '550 km', color: 'bg-red-500', progress: 50, active: true },
    { id: 'RUN-2024-03', name: 'MT-KLK Water', start: 'Semarang', end: 'Purwokerto', dateStart: '12 Jan', dateEnd: '13 Jan', dist: '25 km', color: 'bg-yellow-400', progress: 30 },
    { id: 'RUN-2024-04', name: 'JKT-BDG Gas', start: 'Makassar', end: 'Parepare', dateStart: '15 Feb', dateEnd: '16 Feb', dist: '120 km', color: 'bg-orange-500', progress: 60 }
  ];

  const alerts = [
    { id: 1, title: 'Alignment Completed', desc: 'BK-SGT Oil Pipeline alignment finished successfully.', time: '10 min ago', type: 'success', icon: FiCheckCircle, color: 'text-green-500' },
    { id: 2, title: 'Critical Anomaly Detected', desc: 'HU-CPA Gas KP 12.5 requires immediate review.', time: '1 hour ago', type: 'critical', icon: FiAlertTriangle, color: 'text-red-500' },
    { id: 3, title: 'Inspection Overdue', desc: 'MT-KLK Water inspection was due on 15 Oct.', time: '2 days ago', type: 'warning', icon: FiClock, color: 'text-orange-400' },
    { id: 4, title: 'Data Uploaded', desc: 'New ILI data uploaded for JKT-BDG segment.', time: '3 days ago', type: 'info', icon: FiBox, color: 'text-blue-500' }
  ];

  const pipelines = [
    { id: 'PL-GAS-01', name: 'HU-CPA Gas', riskScore: 25, anomalies: 12, color: 'bg-success' },
    { id: 'PL-OIL-02', name: 'BK-SGT Oil', riskScore: 92, anomalies: 89, color: 'bg-error' },
    { id: 'PL-WAT-03', name: 'MT-KLK Water', riskScore: 55, anomalies: 34, color: 'bg-warning' },
    { id: 'PL-GAS-04', name: 'JKT-BDG Gas', riskScore: 78, anomalies: 62, color: 'bg-brand-500' },
    { id: 'PL-OIL-05', name: 'SMR-SBY Oil', riskScore: 12, anomalies: 2, color: 'bg-success' },
    { id: 'PL-GAS-06', name: 'MLG-BWI Gas', riskScore: 20, anomalies: 8, color: 'bg-success' },
  ];

  const statisticsData = {
    labels: ['S', 'M', 'T', 'W', 'T', 'F', 'S'],
    datasets: [
      {
        label: 'Value',
        data: [4.5, 2.8, 2, 3.5, 4.5, 3.2, 5],
        backgroundColor: '#a855f7',
        borderRadius: 20,
        borderSkipped: false,
        barThickness: 12,
      },
      {
        label: 'Track',
        data: [1, 2.7, 3.5, 2, 1, 2.3, 0.5], // 5.5 - value
        backgroundColor: '#f3f4f6',
        borderRadius: 20,
        borderSkipped: false,
        barThickness: 12,
      }
    ]
  };

  return (
    <div>
      <div className="flex justify-between items-end mb-6">
        <div>
          <h1 className="text-title-md2 font-bold text-gray-800 dark:text-white/90">Portfolio Overview</h1>
        </div>
        <div className="flex gap-3 items-center">
          <button 
            title="Upload Pipeline Alignment"
            onClick={() => navigate('/alignment')}
            className="group flex items-center justify-center rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 hover:shadow-sm dark:border-gray-800 dark:bg-white/[0.03] dark:text-white/90 dark:hover:bg-white/[0.05] transition-all"
          >
            <FiPlus size={18} className="mr-2" />
            Running Data
          </button>
          
          <button 
            onClick={() => navigate('/runs')}
            className="flex items-center justify-center rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 transition-colors gap-2"
          >
            Alignment Data 
            <FiArrowUpRight size={16} />
          </button>
        </div>
      </div>

          {/* Top Row: Horizontal KPI / Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 mb-6">
            <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6">
              <div className="flex items-center justify-center w-12 h-12 bg-gray-100 rounded-xl dark:bg-gray-800">
                <FiActivity className="text-gray-800 size-6 dark:text-white/90" />
              </div>
              <div className="flex items-end justify-between mt-5">
                <div>
                  <span className="text-sm text-gray-500 dark:text-gray-400">Total Pipelines</span>
                  <h4 className="mt-1 font-bold text-gray-800 text-title-sm dark:text-white/90">24</h4>
                </div>
              </div>
            </div>
            
            <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6">
              <div className="flex items-center justify-center w-12 h-12 bg-gray-100 rounded-xl dark:bg-gray-800">
                <FiCheckCircle className="text-gray-800 size-6 dark:text-white/90" />
              </div>
              <div className="flex items-end justify-between mt-5">
                <div>
                  <span className="text-sm text-gray-500 dark:text-gray-400">Active Jobs</span>
                  <h4 className="mt-1 font-bold text-gray-800 text-title-sm dark:text-white/90">8</h4>
                </div>
                <span className="flex items-center gap-1 text-sm font-medium text-success">
                  <FiArrowUpRight size={16} /> 12%
                </span>
              </div>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6">
              <div className="flex items-center justify-center w-12 h-12 bg-gray-100 rounded-xl dark:bg-gray-800">
                <FiAlertTriangle className="text-gray-800 size-6 dark:text-white/90" />
              </div>
              <div className="flex items-end justify-between mt-5">
                <div>
                  <span className="text-sm text-gray-500 dark:text-gray-400">Critical Alerts</span>
                  <h4 className="mt-1 font-bold text-gray-800 text-title-sm dark:text-white/90">3</h4>
                </div>
                <span className="flex items-center gap-1 text-sm font-medium text-error">
                  <FiArrowDownRight size={16} /> 5%
                </span>
              </div>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6">
              <div className="flex items-center justify-center w-12 h-12 bg-gray-100 rounded-xl dark:bg-gray-800">
                <FiClock className="text-gray-800 size-6 dark:text-white/90" />
              </div>
              <div className="flex items-end justify-between mt-5">
                <div>
                  <span className="text-sm text-gray-500 dark:text-gray-400">Overdue</span>
                  <h4 className="mt-1 font-bold text-gray-800 text-title-sm dark:text-white/90">12</h4>
                </div>
              </div>
            </div>
          </div>

          {/* New Charts Row */}
          <div className="grid grid-cols-12 gap-4 md:gap-6 mb-6">
            <div className="col-span-12 xl:col-span-8 rounded-2xl border border-gray-200 bg-white px-5 pt-7 pb-5 shadow-sm dark:border-gray-800 dark:bg-white/[0.03] sm:px-7">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-4">
                <h2 className="text-lg font-bold text-gray-800 dark:text-white/90">Risk Trend (12 Months)</h2>
              </div>
              <RiskTrendChart />
            </div>

            <div className="col-span-12 xl:col-span-4 rounded-2xl border border-gray-200 bg-white px-5 pt-7 pb-5 shadow-sm dark:border-gray-800 dark:bg-white/[0.03] sm:px-7">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-4">
                <h2 className="text-lg font-bold text-gray-800 dark:text-white/90">Asset Composition</h2>
              </div>
              <AssetCompositionChart />
            </div>
          </div>

          {/* Middle Row: Pipeline Health Grid & Map */}
          <div className="grid grid-cols-12 gap-6 mb-6">
            
            {/* Pipeline Health Overview Grid */}
            <div className="col-span-12 xl:col-span-7 rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6">
              <div className="flex justify-between items-center mb-5">
                <h2 className="text-lg font-bold text-gray-800 dark:text-white/90">Pipeline Health Status</h2>
                <div className="flex gap-2">
                  <span className="flex items-center gap-1 text-xs font-medium text-gray-500 dark:text-gray-400"><div className="w-2 h-2 rounded-full bg-success"></div> Healthy</span>
                  <span className="flex items-center gap-1 text-xs font-medium text-gray-500 dark:text-gray-400"><div className="w-2 h-2 rounded-full bg-error"></div> Critical</span>
                </div>
              </div>
              
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {pipelines.map(pl => (
                  <div key={pl.id} className="border border-gray-100 dark:border-gray-800 p-4 rounded-xl hover:border-brand-300 dark:hover:border-brand-500 hover:shadow-sm cursor-pointer transition-all bg-gray-50/50 dark:bg-gray-900/50">
                    <div className="flex justify-between items-start mb-3">
                      <span className="text-xs font-bold text-gray-400 dark:text-gray-500">{pl.id}</span>
                      <div className={`w-2.5 h-2.5 rounded-full ${pl.color} shadow-sm`}></div>
                    </div>
                    <div className="font-semibold text-gray-800 dark:text-white/90 text-sm mb-1 truncate">{pl.name}</div>
                    <div className="flex justify-between items-end mt-4">
                      <div>
                        <div className="text-[10px] text-gray-400 dark:text-gray-500 font-medium">Risk Score</div>
                        <div className="font-bold text-gray-700 dark:text-gray-300">{pl.riskScore}/100</div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] text-gray-400 dark:text-gray-500 font-medium">Anomalies</div>
                        <div className="font-bold text-gray-700 dark:text-gray-300">{pl.anomalies}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Geographical Map */}
            <div className="col-span-12 xl:col-span-5 rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6 flex flex-col h-[400px]">
              <h2 className="text-lg font-bold text-gray-800 dark:text-white/90 mb-4">Asset Geography</h2>
              <div className="flex-1 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-800 relative z-0">
                <MapContainer center={[-2.5, 118]} zoom={4} style={{ height: '100%', width: '100%' }} zoomControl={false}>
                  <TileLayer
                    url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                    attribution='&copy; OpenStreetMap'
                  />
                  {/* Mock locations for the pipelines in Indonesia */}
                  <CircleMarker center={[-6.2, 106.8]} pathOptions={{ color: '#219653', fillColor: '#219653', fillOpacity: 0.7 }} radius={6}><Popup>HU-CPA Gas (Healthy)</Popup></CircleMarker>
                  <CircleMarker center={[-1.2, 116.8]} pathOptions={{ color: '#D34053', fillColor: '#D34053', fillOpacity: 0.7 }} radius={8}><Popup>BK-SGT Oil (Critical)</Popup></CircleMarker>
                  <CircleMarker center={[-7.2, 112.7]} pathOptions={{ color: '#FFA70B', fillColor: '#FFA70B', fillOpacity: 0.7 }} radius={6}><Popup>MT-KLK Water (Monitor)</Popup></CircleMarker>
                  <CircleMarker center={[1.4, 101.4]} pathOptions={{ color: '#3C50E0', fillColor: '#3C50E0', fillOpacity: 0.7 }} radius={7}><Popup>JKT-BDG Gas (Repair)</Popup></CircleMarker>
                </MapContainer>
              </div>
            </div>

          </div>

          {/* Bottom Row: Recent Runs (Glassmorphism Stacked Cards) */}
          <div className="pt-10 pb-8 flex flex-col relative w-full">
            
            {/* Header */}
            <div className="flex justify-between items-center mb-10 z-10 px-2">
              <h2 className="font-bold text-gray-800 text-xl tracking-tight">Recent Runs</h2>
              <div className="text-xs text-gray-500 bg-white/40 px-3 py-1.5 rounded-full border border-white/50 backdrop-blur-md shadow-sm">
                Drop a filter here
              </div>
            </div>

            {/* Content Area */}
            <div className="flex items-end gap-6 z-10 w-full overflow-x-auto pt-24 pb-4 px-2 custom-scrollbar">
              
              {/* Add Button */}
              <div className="flex-shrink-0 flex items-center justify-center w-[72px] h-[140px] bg-white/30 rounded-3xl border border-white/60 shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-xl cursor-pointer hover:bg-white/40 transition-all hover:scale-105 group relative">
                <div className="w-10 h-10 rounded-full bg-white/60 flex items-center justify-center border border-white/80 text-gray-600 shadow-sm group-hover:bg-white transition-all">
                  <FiPlus size={20} strokeWidth={2.5} />
                </div>
              </div>

              {/* Card 1: Alignment Run */}
              <div className="relative w-[300px] h-[140px] flex-shrink-0 cursor-pointer group mt-4">
                {/* Back Layer 2 (Code Doc) */}
                <div className="absolute -top-16 left-28 w-[120px] h-[120px] rounded-2xl shadow-sm opacity-90 group-hover:-translate-y-4 rotate-[12deg] group-hover:rotate-[16deg] transition-all duration-300 overflow-hidden bg-white z-0 border border-gray-100 flex items-center justify-center">
                  <img src="/mini_doc_code.png" className="w-full h-full object-cover opacity-80 scale-[1.7]" alt="Doc Code" />
                </div>
                {/* Back Layer 1 (Purple Chart) */}
                <div className="absolute -top-14 left-8 w-[120px] h-[120px] rounded-2xl shadow-md opacity-100 group-hover:-translate-y-3 -rotate-[6deg] group-hover:-rotate-[10deg] transition-all duration-300 overflow-hidden bg-white z-0 border border-gray-100 flex items-center justify-center">
                  <img src="/mini_chart_purple.png" className="w-full h-full object-cover scale-[1.7]" alt="Purple Chart" />
                </div>
                {/* Front Main Glass Card */}
                <div className="absolute inset-0 bg-white/70 backdrop-blur-xl border border-white rounded-3xl shadow-[0_8px_32px_0_rgba(31,38,135,0.07)] p-6 flex flex-col justify-between group-hover:bg-white/80 transition-all duration-300 z-10">
                  <div>
                    <h3 className="font-bold text-gray-800 text-lg">MT-KLK Water</h3>
                    <p className="text-gray-500 text-xs font-medium">Alignment In Last 7 days</p>
                  </div>
                  <div className="flex justify-between items-end">
                    <div className="text-2xl font-black text-gray-900 tracking-tighter">82.8<span className="text-sm font-bold text-gray-500">%</span></div>
                    <div className="w-8 h-8 rounded-full bg-white/50 flex items-center justify-center border border-white/60 text-gray-500 hover:bg-white transition-colors">
                      ...
                    </div>
                  </div>
                </div>
              </div>

              {/* Card 2: FFS Run */}
              <div className="relative w-[300px] h-[140px] flex-shrink-0 cursor-pointer group mt-4">
                {/* Back Layer 1 (Red Chart) */}
                <div className="absolute -top-14 left-16 w-[120px] h-[120px] rounded-2xl shadow-md opacity-100 group-hover:-translate-y-4 -rotate-[2deg] group-hover:-rotate-[5deg] transition-all duration-300 overflow-hidden bg-white z-0 border border-gray-100 flex items-center justify-center">
                  <img src="/mini_chart_red.png" className="w-full h-full object-cover scale-[1.7]" alt="Red Chart" />
                </div>
                {/* Front Main Glass Card */}
                <div className="absolute inset-0 bg-white/70 backdrop-blur-xl border border-white rounded-3xl shadow-[0_8px_32px_0_rgba(31,38,135,0.07)] p-6 flex flex-col justify-between group-hover:bg-white/80 transition-all duration-300 z-10">
                  <div>
                    <h3 className="font-bold text-gray-800 text-lg">HU-CPA Gas</h3>
                    <p className="text-gray-500 text-xs font-medium">FFS In Last 7 days</p>
                  </div>
                  <div className="flex justify-between items-end">
                    <div className="text-2xl font-black text-gray-900 tracking-tighter flex items-center gap-1">
                      3 <span className="text-sm font-bold text-gray-500 mt-1"> Critical</span>
                    </div>
                    <div className="w-8 h-8 rounded-full bg-white/50 flex items-center justify-center border border-white/60 text-gray-500 hover:bg-white transition-colors">
                      ...
                    </div>
                  </div>
                </div>
              </div>
              
              {/* Card 3: Reports */}
              <div className="relative w-[300px] h-[140px] flex-shrink-0 cursor-pointer group">
                {/* Front Main Glass Card */}
                <div className="absolute inset-0 bg-white/30 backdrop-blur-xl border border-white/50 rounded-3xl shadow-[0_8px_32px_0_rgba(31,38,135,0.05)] p-6 flex flex-col justify-between group-hover:bg-white/40 transition-all duration-300">
                  <div>
                    <h3 className="font-bold text-gray-800 text-lg opacity-60">JKT-BDG Gas</h3>
                    <p className="text-gray-500 text-xs font-medium opacity-60">Pending Validation</p>
                  </div>
                  <div className="flex justify-between items-end">
                    <div className="w-1/2 h-1 bg-gray-300/50 rounded-full overflow-hidden">
                      <div className="w-1/3 h-full bg-blue-400"></div>
                    </div>
                    <div className="w-8 h-8 rounded-full bg-white/30 flex items-center justify-center border border-white/40 text-gray-500 hover:bg-white transition-colors">
                      ...
                    </div>
                  </div>
                </div>
              </div>

            </div>
          </div>

        </div>
  );
};

import AppLayout from './layout/AppLayout';

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/alignment" element={<AlignmentPage />} />
        <Route path="/ili-comparison" element={<IliComparisonPage />} />
        <Route path="/runs" element={<PipelineRuns />} />
      </Route>
    </Routes>
  );
}
