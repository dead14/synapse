export const SECTION_FALLBACK_COLOR = '#c084fc';

export const SECTION_TYPE_COLORS: Record<string, string> = {
  RL: '#2dd4bf',
  AL: '#60a5fa',
  RIS: '#ef4444',
  ROC: '#fb923c',
  BUR: '#84cc16',
  CAS: '#94a3b8',
  BND: '#f472b6',
  UNCLASSIFIED: '#cbd5e1',
  OTH: SECTION_FALLBACK_COLOR,
};

export function sectionColor(type: string) {
  return SECTION_TYPE_COLORS[type] ?? SECTION_FALLBACK_COLOR;
}
