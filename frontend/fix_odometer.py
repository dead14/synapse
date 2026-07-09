import os
import re

with open('src/wizard/StepGwSimulator.tsx', 'r', encoding='utf-8') as f:
    text = f.read()

# 1. Re-add OdometerDashboard import
if 'OdometerDashboard' not in text:
    text = text.replace(
        "import Pipeline3DViewer from '../components/3d/Pipeline3DViewer';",
        "import Pipeline3DViewer from '../components/3d/Pipeline3DViewer';\nimport OdometerDashboard from './OdometerDashboard';"
    )

# 2. Re-add Odometer Slippage Tab Button
if 'Odometer Slippage' not in text:
    old_tab = """<button onClick={() => setActiveTab('all')} className={`px-6 py-3 font-medium text-sm transition-colors relative ${activeTab === 'all' ? 'text-brand-600' : 'text-gray-500 hover:text-gray-800'}`}>"""
    new_tab = """<button onClick={() => setActiveTab('odometer')} className={`px-6 py-3 font-medium text-sm transition-colors relative ${activeTab === 'odometer' ? 'text-brand-600' : 'text-gray-500 hover:text-gray-800'}`}>
          Odometer Slippage
          {activeTab === 'odometer' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-500" />}
        </button>
        <button onClick={() => setActiveTab('all')} className={`px-6 py-3 font-medium text-sm transition-colors relative ${activeTab === 'all' ? 'text-brand-600' : 'text-gray-500 hover:text-gray-800'}`}>"""
    text = text.replace(old_tab, new_tab)

# 3. Re-add OdometerDashboard component rendering
if '<OdometerDashboard />' not in text:
    old_content = """        {activeTab === 'all' && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 mb-8">"""
    new_content = """        {activeTab === 'odometer' && <OdometerDashboard />}
        {activeTab === 'all' && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 mb-8">"""
    text = text.replace(old_content, new_content)

# 4. Fix table visibility logic
if "activeTab === 'odometer'" not in text.split("Match Results Data")[0]:
    text = text.replace(
        "{activeTab === 'all' && (\n          <div className=\"bg-white rounded-xl border border-gray-200 overflow-hidden flex flex-col max-h-[400px]\">",
        "{(activeTab === 'all' || activeTab === 'odometer') && (\n          <div className=\"bg-white rounded-xl border border-gray-200 overflow-hidden flex flex-col max-h-[400px] mt-8\">"
    )

with open('src/wizard/StepGwSimulator.tsx', 'w', encoding='utf-8') as f:
    f.write(text)
