export interface FfsConfig {
  lineName: string;
  method: 'original' | 'modified';
  modifiedSa: 'smys69' | 'smys11';
  iliDate: Date;
  highlightYears: number;
}

export interface FfsInput {
  ld: number | string;
  section: string;
  surface: string;
  maxDepthPct: number;
  length: number;
  width: number;
  orient: string;
  wall: number;
  crDepth: number;
  crLength: number;
  df: number;
  od: number;
  smys: number;
  p0: number;
}

export interface FfsResult extends FfsInput {
  SF: number;
  d: number;
  dt: number;
  z: number;
  M: number | null;
  sflow: number;
  Sf: number;
  Pf: number;
  So: number;
  safePressure: number;
  ERF: number;
  acceptance: 'Acceptable' | 'Un-Acceptable';
  branch: string;
  expectedLife: number;
  yearService: string;
  failureCriteria: string;
  atFailure_ERF: number;
  atFailure_depth: number;
  atFailure_Sf: number;
  method: 'original' | 'modified';
  saMode: 'smys69' | 'smys11';
}

export const REQUIRED_COLUMNS = [
  'LD [m]', 'Section', 'Surface', 'Max Depth [%]', 'Length [mm]',
  'Width [mm]', 'Orient. (hrs:mins)', 'Nominal Wall Thickness [mm]',
  'CR Depth [mm/y]', 'CR Length [mm/y]', 'Design Factor',
  'Outer Diameter Ds', 'SMYS [MPa]', 'Operating Pressure P₀ [MPa]'
] as const;
