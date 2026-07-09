import os
import re

with open('src/wizard/StepGwSimulator.tsx', 'r', encoding='utf-8') as f:
    text = f.read()

# 1. Add tableRowRefs and parse anomalies
imports_old = "import React, { useState, useEffect, useMemo } from 'react';"
imports_new = "import React, { useState, useEffect, useMemo, useRef } from 'react';"
text = text.replace(imports_old, imports_new)

# Add ref inside component
state_old = "const [currentPage, setCurrentPage] = useState(1);"
state_new = "const [currentPage, setCurrentPage] = useState(1);\n  const tableRowRefs = useRef<{[key: string]: HTMLTableRowElement | null}>({});"
text = text.replace(state_old, state_new)

# 2. Extract anomalies between selectedGWs
# We need to find where Pipeline3DViewer is rendered and inject anomalies.
# First, let's add the logic to compute anomalies right before the Pipeline3DViewer.
viewer_old = "<Pipeline3DViewer length={selectedGWs[1] - selectedGWs[0]} od={12} />"
viewer_new = """{(() => {
                const startDist = Math.min(selectedGWs[0], selectedGWs[1]);
                const endDist = Math.max(selectedGWs[0], selectedGWs[1]);
                
                // Get all metal loss/dents between these two GWs from the original oldRun payload
                const anomalies = (config?.payload?.oldRun || [])
                  .filter((f: any) => {
                    const isDefect = f.type && (f.type.toLowerCase().includes('metal loss') || f.type.toLowerCase().includes('dent') || f.type.toLowerCase().includes('corrosion') || f.type.toLowerCase().includes('anomaly'));
                    return isDefect && f.dist > startDist && f.dist < endDist;
                  })
                  .map((f: any) => ({
                    position: f.dist - startDist, // relative position from the first GW
                    depthPct: f.depth || 10,
                    clockAngle: f.orientation || 0
                  }));

                return <Pipeline3DViewer length={endDist - startDist} od={12} anomalies={anomalies} />;
              })()}"""
text = text.replace(viewer_old, viewer_new)


# 3. Add onClick to table rows (Match Results Data table AND Main Editable table)
# Main editable table: <tr key={row.id} className="hover:bg-gray-50 transition-colors">
# Small table: <tr key={row.id} className="hover:bg-gray-100 transition-colors">
text = text.replace(
    '<tr key={row.id} className="hover:bg-gray-50 transition-colors">',
    """<tr key={row.id} 
                      ref={el => tableRowRefs.current[row.id] = el}
                      className={`transition-colors cursor-pointer ${selectedGWs.includes(row.oldVal || 0) ? 'bg-yellow-100 hover:bg-yellow-200' : 'hover:bg-gray-50'}`}
                      onClick={() => {
                        if (row.oldVal === null) return;
                        setSelectedGWs(prev => {
                          const dist = row.oldVal;
                          if (prev.includes(dist)) return prev.filter(d => d !== dist);
                          const next = [...prev, dist].slice(-2);
                          if (next.length === 2) setShow3DViewer(true);
                          return next;
                        });
                      }}>"""
)

text = text.replace(
    '<tr key={row.id} className="hover:bg-gray-100 transition-colors">',
    """<tr key={row.id} 
                      ref={el => tableRowRefs.current[row.id] = el}
                      className={`transition-colors cursor-pointer ${selectedGWs.includes(row.oldVal || 0) ? 'bg-yellow-100 hover:bg-yellow-200' : 'hover:bg-gray-100'}`}
                      onClick={() => {
                        if (row.oldVal === null) return;
                        setSelectedGWs(prev => {
                          const dist = row.oldVal;
                          if (prev.includes(dist)) return prev.filter(d => d !== dist);
                          const next = [...prev, dist].slice(-2);
                          if (next.length === 2) setShow3DViewer(true);
                          return next;
                        });
                      }}>"""
)


# 4. Chart onClick handler
# Find the Line component for the offset chart
chart_old = "<Line data={chartData} options={chartOptions as any} />"
chart_new = """<Line data={chartData} options={{
                ...chartOptions,
                onClick: (e: any, elements: any[]) => {
                  if (elements.length > 0) {
                    const idx = elements[0].index;
                    const match = matches[idx];
                    if (match && match.oldVal !== null) {
                      // Select GW
                      setSelectedGWs(prev => {
                        const dist = match.oldVal;
                        if (prev.includes(dist)) return prev.filter(d => d !== dist);
                        const next = [...prev, dist].slice(-2);
                        if (next.length === 2) setShow3DViewer(true);
                        return next;
                      });
                      
                      // Scroll to table row
                      const rowEl = tableRowRefs.current[match.id];
                      if (rowEl) {
                        rowEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        rowEl.classList.add('animate-pulse', 'bg-yellow-200');
                        setTimeout(() => rowEl.classList.remove('animate-pulse', 'bg-yellow-200'), 2000);
                      }
                    }
                  }
                }
              } as any} />"""
text = text.replace(chart_old, chart_new)

with open('src/wizard/StepGwSimulator.tsx', 'w', encoding='utf-8') as f:
    f.write(text)
