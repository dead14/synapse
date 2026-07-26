export interface TooltipPlacementInput {
  pointerX: number;
  pointerY: number;
  tooltipWidth: number;
  tooltipHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  /** Gap between the pointer and the tooltip. Default 15px. */
  offset?: number;
  /** Minimum distance kept from the viewport edges. Default 8px. */
  margin?: number;
}

export interface TooltipPlacement {
  left: number;
  top: number;
}

/**
 * Place a fixed-position tooltip near the pointer without letting it overflow
 * the viewport: flip to the opposite side of the pointer when the preferred
 * side lacks room, then clamp to the viewport margins.
 */
export function clampTooltipPosition(input: TooltipPlacementInput): TooltipPlacement {
  const offset = input.offset ?? 15;
  const margin = input.margin ?? 8;

  const place = (pointer: number, size: number, viewport: number) => {
    let position = pointer + offset;
    if (position + size + margin > viewport) position = pointer - size - offset;
    // Upper bound first so the minimum margin wins when the tooltip is larger
    // than the viewport itself.
    position = Math.min(position, viewport - size - margin);
    return Math.max(margin, position);
  };

  return {
    left: place(input.pointerX, input.tooltipWidth, input.viewportWidth),
    top: place(input.pointerY, input.tooltipHeight, input.viewportHeight),
  };
}
