export interface SectionDef {
  id: string;
  name: string;
  type: string;
  physicalType?: string;
  policy?: string;
  startGw: string;
  endGw: string;
  startM: number;
  endM: number;
  length: number;
  notes: string;
  latStart?: number;
  lngStart?: number;
  latEnd?: number;
  lngEnd?: number;
}

export interface SpatialFeature {
  id: string;
  dist: number;
  type: string;
  runRole: 'MASTER' | 'HISTORICAL';
  runYear?: string;
  status?: 'MASTER' | 'MATCHED' | 'MISSING_IN_MASTER' | 'UNRESOLVED';
  wallThicknessMm?: number | null;
  rawData: Record<string, unknown>;
  lat: number;
  lng: number;
}

export interface HistoricalGwLane {
  id: string;
  label: string;
  year?: string;
  gws: SpatialFeature[];
  bends: SpatialFeature[];
}

export interface SpatialFeatures {
  gws: SpatialFeature[];
  allFeatures: SpatialFeature[];
  historicalLanes: HistoricalGwLane[];
  stats: { totalLength: number; gwCount: number; bendCount: number; missingGwCount: number };
}
