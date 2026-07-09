import os
import re

with open('src/wizard/StepGwSimulator.tsx', 'r', encoding='utf-8') as f:
    text = f.read()

text = re.sub(r"\{activeTab === 'odometer' && \([\s\S]*?\{activeTab === 'offset' && \(", "{activeTab === 'odometer' && (\n          <OdometerDashboard matches={matches} ota={ota} setOta={setOta} dtwOn={dtwOn} setDtwOn={setDtwOn} />\n        )}\n\n        {activeTab === 'offset' && (", text, count=1)

with open('src/wizard/StepGwSimulator.tsx', 'w', encoding='utf-8') as f:
    f.write(text)

