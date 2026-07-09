const fs = require('fs');
let txt = fs.readFileSync('src/wizard/StepGwSimulator.tsx', 'utf8');

// Strip out everything from the first {activeTab === 'odometer' && ( to the {activeTab === 'offset' && (
txt = txt.replace(/\{activeTab === 'odometer' && \([\s\S]*?\{activeTab === 'offset' && \(/, "{activeTab === 'odometer' && (\n          <OdometerDashboard matches={matches} ota={ota} setOta={setOta} dtwOn={dtwOn} setDtwOn={setDtwOn} />\n        )}\n\n        {activeTab === 'offset' && (");

fs.writeFileSync('src/wizard/StepGwSimulator.tsx', txt);
