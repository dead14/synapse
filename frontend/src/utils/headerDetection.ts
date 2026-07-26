export type TabularCell = string | number | boolean | null | undefined;

export const FIELD_ALIASES = {
  feature_id: [
    'feature id',
    'feature #',
    'feature no',
    'feature num',
    'feature number',
    'feature number num',
  ],
  log_distance_m: [
    'log distance',
    'log distance m',
    'absolute distance',
    'absolute distance m',
    'abs distance',
    'abs distance m',
    'chainage',
    'chainage m',
    'odometer',
    'odometer m',
  ],
  joint_number: ['joint number', 'joint no', 'joint #', 'pipe number', 'pipe no'],
  dist_to_us_gw_m: [
    'dist us gw',
    'dist us gw m',
    'distance us gw',
    'distance us gw m',
    'distance to us gw',
    'distance to us gw m',
    'distance to upstream girth weld',
    'distance to upstream girth weld m',
  ],
  joint_length_m: ['joint length', 'joint length m', 'pipe length', 'pipe length m'],
  feature_type: [
    'feature type',
    'feature type pof',
    'component anomaly type',
    'component type',
    'anomaly type',
  ],
  feature_identification: [
    'feature identification',
    'feature identification pof',
    'component anomaly ident',
    'feature description',
    'feature name',
    'identification',
  ],
  dim_classification: [
    'dim classification',
    'dimension classification',
    'defect classification',
  ],
  clock_position: [
    'clock position',
    'clock position h',
    'orientation o clock',
    'angle o clock',
    'o clock',
  ],
  wall_thickness_mm: [
    'wall thickness',
    'wall thickness mm',
    'nominal wall thickness',
    'nominal wall thickness mm',
    'wt',
    'wt mm',
  ],
  length_mm: [
    'length',
    'length mm',
    'feature length',
    'feature length mm',
    'anomaly length',
    'anomaly length mm',
  ],
  width_mm: [
    'width',
    'width mm',
    'feature width',
    'feature width mm',
    'anomaly width',
    'anomaly width mm',
  ],
  depth_pct: [
    'depth',
    'depth percent',
    'depth pct',
    'depth wt',
    'depth percent wt',
    'max depth',
    'max depth percent',
    'max depth pct',
    'max depth wt',
  ],
  surface_location: ['surface location', 'surface', 'internal external', 'id od'],
  erf_asme: ['erf asme', 'erf', 'estimated repair factor'],
  psafe_bar: [
    'psafe',
    'psafe bar',
    'safe pressure',
    'safe pressure bar',
    'predicted safe pressure',
  ],
  comment: ['comment', 'comments', 'remark', 'remarks', 'note', 'notes'],
} as const;

export type CanonicalField = keyof typeof FIELD_ALIASES;

export function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/%/g, ' percent ')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const ALIAS_LOOKUP = new Map<string, CanonicalField>();

for (const [canonicalField, aliases] of Object.entries(FIELD_ALIASES) as [
  CanonicalField,
  readonly string[],
][]) {
  ALIAS_LOOKUP.set(normalizeHeader(canonicalField), canonicalField);
  aliases.forEach((alias) => ALIAS_LOOKUP.set(normalizeHeader(alias), canonicalField));
}

export function canonicalFieldForHeader(value: unknown): CanonicalField | undefined {
  return ALIAS_LOOKUP.get(normalizeHeader(value));
}

function fieldsInRow(row: readonly TabularCell[]): Set<CanonicalField> {
  const fields = new Set<CanonicalField>();
  row.forEach((cell) => {
    const canonicalField = canonicalFieldForHeader(cell);
    if (canonicalField) fields.add(canonicalField);
  });
  return fields;
}

export function detectHeaderRowIndex(rows: readonly (readonly TabularCell[])[]): number {
  let bestIndex = -1;
  let bestScore = -1;

  rows.forEach((row, index) => {
    const fields = fieldsInRow(row);
    const hasRequiredFields = fields.has('log_distance_m') && fields.has('feature_type');
    if (hasRequiredFields && fields.size > bestScore) {
      bestIndex = index;
      bestScore = fields.size;
    }
  });

  if (bestIndex < 0) {
    throw new Error(
      'Baris header tidak ditemukan. Kolom jarak absolut dan jenis fitur wajib tersedia.',
    );
  }

  return bestIndex;
}
