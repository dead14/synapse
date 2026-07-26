import type { FfsConfig, FfsResult } from './types';
import { assertValidFfsRow } from './inputValidation.ts';

export {
  MODIFIED_B31G_Z_CUTOFF,
  ORIGINAL_B31G_Z_CUTOFF,
  evaluateModifiedB31g,
  evaluateOriginalB31g,
} from './remainingStrength.ts';

// Modified B31G calculation
function calcModified(d: number, l: number, wall: number, smys: number, od: number, df: number, so: number, saMode: 'smys69' | 'smys11') {
  if (d >= wall) return { ERF: 1e9, depthPct: 100, Sf: 0, Pf: 0, M: 0, z: 0, dt: 1, sflow: 0, branch: '' };
  const dt = d / wall;
  const z = (l * l) / (od * wall);
  let M: number, branch: string;
  if (z <= 50) {
    let m2 = 1 + 0.6275 * z - 0.003375 * z * z;
    if (m2 < 1) m2 = 1;
    M = Math.sqrt(m2);
    branch = 'z≤50';
  } else {
    M = 0.032 * z + 3.3;
    branch = 'z>50';
  }
  const sflow = saMode === 'smys11' ? 1.1 * smys : smys + 69;
  const num = 1 - 0.85 * dt;
  const den = 1 - (0.85 * dt / M);
  if (den <= 0 || num <= 0) return { ERF: 1e9, depthPct: dt * 100, Sf: 0, Pf: 0, M, z, dt, sflow, branch };
  const Sf = sflow * num / den;
  const Pf = 2 * Sf * wall / od;
  const ERF = so / (Sf * df);
  return { ERF, depthPct: dt * 100, Sf, Pf, M, z, dt, sflow, branch };
}

// Original B31G calculation
function calcOriginal(d: number, l: number, wall: number, smys: number, od: number, df: number, so: number) {
  if (d >= wall) return { ERF: 1e9, depthPct: 100, Sf: 0, Pf: 0, M: 0, z: 0, dt: 1, sflow: 0, branch: '' };
  const dt = d / wall;
  const z = (l * l) / (od * wall);
  const sflow = 1.1 * smys;
  let M: number | null, Sf: number, branch: string;
  if (z <= 20) {
    M = Math.sqrt(1 + 0.8 * z);
    branch = 'z≤20';
    const num = 1 - (2 / 3) * dt;
    const den = 1 - (2 / 3) * (dt / M);
    if (den <= 0 || num <= 0) return { ERF: 1e9, depthPct: dt * 100, Sf: 0, Pf: 0, M, z, dt, sflow, branch };
    Sf = sflow * num / den;
  } else {
    M = null;
    branch = 'z>20';
    Sf = sflow * (1 - dt);
  }
  const Pf = 2 * Sf * wall / od;
  const ERF = so / (Sf * df);
  return { ERF, depthPct: dt * 100, Sf, Pf, M, z, dt, sflow, branch };
}

// Calculate at a future year
function calcAtYear(method: string, dInit: number, lInit: number, wall: number, smys: number, od: number, df: number, so: number, crDepth: number, crLength: number, years: number, saMode: string) {
  const d = dInit + crDepth * years;
  const l = lInit + crLength * years;
  return method === 'original'
    ? calcOriginal(d, l, wall, smys, od, df, so)
    : calcModified(d, l, wall, smys, od, df, so, saMode as any);
}

// Add years to date
function addYears(date: Date, years: number): string {
  const d = new Date(date);
  const whole = Math.floor(years);
  const frac = years - whole;
  d.setFullYear(d.getFullYear() + whole);
  d.setDate(d.getDate() + Math.round(frac * 365.25));
  return d.toISOString().split('T')[0];
}

// Process a single row
export function processRow(row: Record<string, string>, config: FfsConfig): FfsResult {
  assertValidFfsRow(row, config);
  const ld = row['LD [m]'];
  const section = row['Section'];
  const surface = row['Surface'];
  const maxDepthPct = parseFloat(row['Max Depth [%]']);
  const length = parseFloat(row['Length [mm]']);
  const width = parseFloat(row['Width [mm]']);
  const orient = row['Orient. (hrs:mins)'];
  const wall = parseFloat(row['Nominal Wall Thickness [mm]']);
  const crDepth = parseFloat(row['CR Depth [mm/y]']);
  const crLength = parseFloat(row['CR Length [mm/y]']);
  const df = parseFloat(row['Design Factor']);
  const od = parseFloat(row['Outer Diameter Ds']);
  const smys = parseFloat(row['SMYS [MPa]']);
  const p0 = parseFloat(row['Operating Pressure P₀ [MPa]']);

  const dInit = (maxDepthPct / 100) * wall;
  const so = (p0 * od) / (2 * wall);
  const SF = 1 / df;

  const init = calcAtYear(config.method, dInit, length, wall, smys, od, df, so, crDepth, crLength, 0, config.modifiedSa);
  const safePressure = init.Pf * df;
  const acceptance = (init.ERF < 1 && maxDepthPct < 80) ? 'Acceptable' : 'Un-Acceptable';

  let tDepth = Infinity;
  if (crDepth > 0) {
    tDepth = (0.80 * wall - dInit) / crDepth;
    if (tDepth < 0) tDepth = 0;
  } else if (dInit / wall >= 0.80) {
    tDepth = 0;
  }

  let tErf = Infinity;
  if (init.ERF >= 1) {
    tErf = 0;
  } else {
    const MAX = 200;
    const atMax = calcAtYear(config.method, dInit, length, wall, smys, od, df, so, crDepth, crLength, MAX, config.modifiedSa);
    if (atMax.ERF >= 1) {
      let lo = 0, hi = MAX;
      for (let ii = 0; ii < 60; ii++) {
        const mid = (lo + hi) / 2;
        const rv = calcAtYear(config.method, dInit, length, wall, smys, od, df, so, crDepth, crLength, mid, config.modifiedSa);
        if (rv.ERF >= 1) hi = mid; else lo = mid;
      }
      tErf = Math.round(hi * 100) / 100;
    }
  }

  let expectedLife: number, failureCriteria: string;
  const td = tDepth === Infinity ? 999 : Math.round(tDepth * 100) / 100;
  const te = tErf === Infinity ? 999 : tErf;
  if (td <= te) {
    expectedLife = td >= 200 ? 200 : td;
    failureCriteria = td >= 200 ? 'N/A (≥200yr)' : 'Depth = 80%';
    if (tDepth === 0 && maxDepthPct < 80 && tErf === 0) { failureCriteria = 'ERF = 1'; expectedLife = 0; }
  } else {
    expectedLife = te >= 200 ? 200 : te;
    failureCriteria = te >= 200 ? 'N/A (≥200yr)' : 'ERF = 1';
  }
  if (tDepth === Infinity && tErf === Infinity) { expectedLife = 200; failureCriteria = 'N/A (≥200yr)'; }

  const yearService = addYears(config.iliDate, expectedLife);
  const atFailure = calcAtYear(config.method, dInit, length, wall, smys, od, df, so, crDepth, crLength, expectedLife, config.modifiedSa);

  return {
    ld: parseFloat(ld as string) || ld as any, section, surface, maxDepthPct, length, width, orient, wall,
    crDepth, crLength, df, od, smys, p0,
    SF: +SF.toFixed(4), d: +dInit.toFixed(4), dt: +init.dt.toFixed(4),
    z: +(init.z || 0).toFixed(4), M: init.M !== null ? +(init.M).toFixed(4) : null,
    sflow: +(init.sflow || 0).toFixed(4),
    Sf: +(init.Sf || 0).toFixed(4), Pf: +(init.Pf || 0).toFixed(4),
    So: +so.toFixed(4), safePressure: +safePressure.toFixed(4),
    ERF: +init.ERF.toFixed(4), acceptance,
    branch: init.branch,
    expectedLife, yearService, failureCriteria,
    atFailure_ERF: +atFailure.ERF.toFixed(4),
    atFailure_depth: +atFailure.depthPct.toFixed(2),
    atFailure_Sf: +atFailure.Sf.toFixed(4),
    method: config.method,
    saMode: config.modifiedSa,
  };
}

export function processAllRows(rows: Record<string, string>[], config: FfsConfig, onProgress?: (pct: number) => void): Promise<FfsResult[]> {
  return new Promise((resolve, reject) => {
    const results: FfsResult[] = [];
    const total = rows.length;
    if (total === 0) {
      onProgress?.(100);
      resolve(results);
      return;
    }
    const BATCH = 200;
    let i = 0;
    function tick() {
      try {
        const end = Math.min(i + BATCH, total);
        for (; i < end; i++) {
          results.push(processRow(rows[i], config));
        }
        onProgress?.(Math.round((i / total) * 100));
        if (i < total) setTimeout(tick, 0);
        else resolve(results);
      } catch (error) {
        reject(error);
      }
    }
    setTimeout(tick, 0);
  });
}
