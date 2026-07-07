import React, { useState } from 'react';
import { FiUploadCloud, FiInfo, FiChevronDown, FiChevronUp, FiDatabase, FiSettings, FiShield } from 'react-icons/fi';

interface StepUploadILIProps {
  onNext: () => void;
}

export default function StepUploadILI({ onNext }: StepUploadILIProps) {
  const [expandedSection, setExpandedSection] = useState<string | null>('all');

  const toggleSection = (section: string) => {
    if (expandedSection === 'all') {
      setExpandedSection(section);
    } else {
      setExpandedSection(expandedSection === section ? null : section);
    }
  };

  const isExpanded = (section: string) => expandedSection === 'all' || expandedSection === section;

  return (
    <div className="w-full flex flex-col gap-6 animate-fade-in">
      
      {/* Page Title */}
      <div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-100 flex flex-col sm:flex-row justify-between items-start sm:items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <FiDatabase className="text-brand-500" /> Inspection Intake Form
          </h2>
          <p className="text-gray-500 mt-1">Define pipeline parameters and upload ILI data for alignment processing.</p>
        </div>
        <button 
          onClick={onNext}
          className="mt-4 sm:mt-0 bg-brand-500 hover:bg-brand-600 text-white px-8 py-3 rounded-xl font-medium transition-colors shadow-md shadow-brand-500/20"
        >
          Initialize Alignment
        </button>
      </div>

      <div className="flex flex-col-reverse gap-6">
        {/* Left Column (Now Bottom): Asset & Specs */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          
          {/* Section 1: Asset Identification */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <button 
              onClick={() => toggleSection('asset')}
              className="w-full px-6 py-4 flex justify-between items-center bg-gray-50/50 hover:bg-gray-50 transition-colors border-b border-gray-100"
            >
              <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                <FiInfo className="text-gray-500" /> Asset & Operations
              </h3>
              {isExpanded('asset') ? <FiChevronUp /> : <FiChevronDown />}
            </button>
            
            {isExpanded('asset') && (
              <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Pipeline Name</label>
                  <input type="text" className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"   placeholder="e.g. SMR-SBY Gas Line" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Segment Route</label>
                  <input type="text" className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"   placeholder="e.g. Station A - Station B" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Environment</label>
                  <select className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none bg-white"  >
                    <option>Onshore</option>
                    <option>Offshore</option>
                    <option>Subsea</option>
                    <option>Swamp</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Length (km)</label>
                  <input type="number" className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"   placeholder="150" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Product Medium</label>
                  <select className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none bg-white"  >
                    <option>Natural Gas (Dry)</option>
                    <option>Natural Gas (Wet)</option>
                    <option>Crude Oil</option>
                    <option>Refined Product</option>
                    <option>Water</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">MAOP (psi)</label>
                  <input type="number" className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"   placeholder="e.g. 1200" />
                </div>
              </div>
            )}
          </div>

          {/* Section 2: Physical Specs & Protection */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <button 
              onClick={() => toggleSection('specs')}
              className="w-full px-6 py-4 flex justify-between items-center bg-gray-50/50 hover:bg-gray-50 transition-colors border-b border-gray-100"
            >
              <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                <FiSettings className="text-gray-500" /> Physical Specs & Protection
              </h3>
              {isExpanded('specs') ? <FiChevronUp /> : <FiChevronDown />}
            </button>
            
            {isExpanded('specs') && (
              <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Outer Diameter (OD)</label>
                  <select className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none bg-white"  >
                    <option>10 inch</option>
                    <option>12 inch</option>
                    <option>24 inch</option>
                    <option>36 inch</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Nominal WT (mm)</label>
                  <input type="number" step="0.01" className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"   placeholder="e.g. 12.7" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Material Grade</label>
                  <select className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none bg-white"  >
                    <option>API 5L X42</option>
                    <option>API 5L X52</option>
                    <option>API 5L X60</option>
                    <option>API 5L X65</option>
                    <option>API 5L X70</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Seam Type</label>
                  <select className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none bg-white"  >
                    <option>SMLS (Seamless)</option>
                    <option>ERW</option>
                    <option>DSAW</option>
                    <option>SAWH</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">External Coating</label>
                  <select className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none bg-white"  >
                    <option>3LPE</option>
                    <option>FBE</option>
                    <option>Coal Tar Enamel (CTE)</option>
                    <option>Bare</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Inst. Year / Loc Class</label>
                  <div className="flex gap-2">
                    <input type="text" className="w-1/2 rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-brand-500 outline-none"   placeholder="Year" />
                    <select className="w-1/2 rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-brand-500 outline-none bg-white"  >
                      <option>Class 1</option>
                      <option>Class 2</option>
                      <option>Class 3</option>
                      <option>Class 4</option>
                    </select>
                  </div>
                </div>
              </div>
            )}
          </div>

        </div>

        {/* Right Column: ILI Uploads */}
        <div className="flex flex-col gap-6">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden h-full flex flex-col">
            <div className="px-6 py-4 bg-gray-50/50 border-b border-gray-100">
              <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                <FiShield className="text-gray-500" /> ILI Data Configuration
              </h3>
            </div>
            
            <div className="p-6 flex-1 grid grid-cols-1 xl:grid-cols-2 gap-6">
              
              {/* Baseline Upload */}
              <div className="p-5 rounded-xl border border-gray-100 bg-gray-50/30">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-2 h-6 bg-gray-400 rounded-full"></div>
                  <h4 className="font-bold text-gray-700">Baseline (Previous ILI)</h4>
                </div>
                
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Vendor</label>
                    <select className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-brand-500 outline-none bg-white"  >
                      <option>Rosen</option>
                      <option>Baker Hughes</option>
                      <option>NDT Global</option>
                      <option>TDW</option>
                      <option>Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Year & Tool</label>
                    <div className="flex gap-2">
                      <input type="text" className="w-1/3 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-brand-500 outline-none"   placeholder="YYYY" />
                      <select className="w-2/3 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-brand-500 outline-none bg-white"  >
                        <option>MFL-A</option>
                        <option>MFL-C</option>
                        <option>UT-WM</option>
                        <option>Combo</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className="border-2 border-dashed border-gray-300 rounded-xl p-6 flex flex-col items-center justify-center bg-white hover:border-brand-500 hover:bg-brand-50 transition-colors cursor-pointer group">
                  <FiUploadCloud className="text-3xl text-gray-500 group-hover:text-brand-500 mb-2" />
                  <p className="text-sm font-medium text-gray-700">Upload Baseline Excel</p>
                  <p className="text-xs text-gray-500 mt-1">Drag & drop or click to browse</p>
                </div>
              </div>

              {/* Current Upload */}
              <div className="p-5 rounded-xl border border-brand-100 bg-brand-50/30">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-2 h-6 bg-brand-500 rounded-full"></div>
                  <h4 className="font-bold text-gray-800">Current (New ILI)</h4>
                </div>
                
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Vendor</label>
                    <select className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-brand-500 outline-none bg-white"  >
                      <option>Rosen</option>
                      <option>Baker Hughes</option>
                      <option>NDT Global</option>
                      <option>TDW</option>
                      <option>Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Year & Tool</label>
                    <div className="flex gap-2">
                      <input type="text" className="w-1/3 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-brand-500 outline-none"   placeholder="YYYY" />
                      <select className="w-2/3 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-brand-500 outline-none bg-white"  >
                        <option>MFL-A</option>
                        <option>MFL-C</option>
                        <option>UT-WM</option>
                        <option>Combo</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className="border-2 border-dashed border-brand-300 rounded-xl p-6 flex flex-col items-center justify-center bg-white hover:border-brand-500 hover:bg-brand-50 transition-colors cursor-pointer group">
                  <FiUploadCloud className="text-3xl text-brand-400 group-hover:text-brand-500 mb-2" />
                  <p className="text-sm font-medium text-gray-700">Upload Current Excel</p>
                  <p className="text-xs text-gray-500 mt-1">Drag & drop or click to browse</p>
                </div>
              </div>

            </div>
          </div>
        </div>
      </div>
      
    </div>
  );
}
