import React, { useState, useEffect } from 'react';
import { FiBell, FiSettings } from 'react-icons/fi';
import ResultsPanel from './ResultsPanel';
import TimelineViewer from './TimelineViewer';

export default function IliComparisonPage() {
  const [data, setData] = useState<any[]>([]);
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

    // Simulate fetch delay
    setTimeout(() => {
      const resData = generateDummyData();
      setData(resData.comparison);
      setLoading(false);
    }, 500);
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 font-sans pb-12 text-gray-800">
      
      {/* Premium Header */}
      <div className="max-w-[1600px] mx-auto px-8 pt-8 pb-8 flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight flex items-center gap-2 bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent">
            Hi, Engineer! <span className="text-2xl">👋</span>
          </h1>
          <p className="text-sm text-gray-500 mt-1 font-medium">Upload two ILI survey files to begin the 4-layer alignment process.</p>
        </div>
        <div className="flex gap-4">
          <button className="p-2.5 text-gray-500 hover:text-blue-600 bg-white border border-gray-200 rounded-full hover:bg-blue-50 hover:border-blue-200 shadow-sm transition-all duration-300">
            <FiBell size={20} />
          </button>
          <button className="p-2.5 text-gray-500 hover:text-blue-600 bg-white border border-gray-200 rounded-full hover:bg-blue-50 hover:border-blue-200 shadow-sm transition-all duration-300">
            <FiSettings size={20} />
          </button>
        </div>
      </div>

      <div className="max-w-[1600px] mx-auto px-8 flex flex-col gap-6">
        
        {/* Timeline Viewer (Replaces old KPIs and Charts) */}
        <TimelineViewer />

        {/* Results Panel */}
        <div className="h-[600px] mt-4">
          <ResultsPanel data={data} loading={loading} />
        </div>
      </div>
    </div>
  );
}
