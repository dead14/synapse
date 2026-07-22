export const MIN_SCHEMATIC_ZOOM = 0.5;
export const MAX_SCHEMATIC_ZOOM = 20;
export const UNMATCHED_LABEL_DETAIL_ZOOM = 2;

export function clampSchematicZoom(zoom: number) {
  return Math.max(MIN_SCHEMATIC_ZOOM, Math.min(MAX_SCHEMATIC_ZOOM, zoom));
}

export function shouldShowUnmatchedMarkerLabel(zoom: number) {
  return zoom >= UNMATCHED_LABEL_DETAIL_ZOOM;
}

export function canInspectGwPrecisely(zoom: number) {
  return zoom >= 6;
}
