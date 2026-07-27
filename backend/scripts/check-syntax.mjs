// Syntax-check every backend JavaScript source file with `node --check`.
// The previous "check" script parsed exactly three hand-picked files, which
// let syntax errors ship in everything else (including the worker that
// launches the Python engines).
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const roots = ['server.js', 'src'];
const files = [];

const walk = (p) => {
  const st = statSync(p);
  if (st.isDirectory()) {
    for (const entry of readdirSync(p)) walk(join(p, entry));
  } else if (p.endsWith('.js')) {
    files.push(p);
  }
};

for (const root of roots) walk(root);

const failures = [];
for (const file of files) {
  const res = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (res.status !== 0) {
    failures.push(file);
    process.stderr.write(res.stderr || `Syntax check failed: ${file}\n`);
  }
}

if (failures.length > 0) {
  console.error(`Syntax check failed for ${failures.length} of ${files.length} files`);
  process.exit(1);
}
console.log(`Syntax OK: ${files.length} files`);
