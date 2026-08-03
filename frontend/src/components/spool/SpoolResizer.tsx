/**
 * Drag handle between two panes of the workspace.
 *
 * Pointer capture is what makes this reliable: without it the first move over
 * the WebGL canvas would steal the pointer and the drag would stall halfway.
 * Double-click collapses the neighbouring pane and restores it, and the arrow
 * keys move it too, so the layout is not mouse-only.
 */

import { useRef, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';

interface SpoolResizerProps {
  axis: 'x' | 'y';
  /** Called with the pointer delta in pixels along the handle's axis. */
  onResize: (delta: number) => void;
  /** Double-click and Enter: collapse the neighbouring pane, or bring it back. */
  onToggle?: () => void;
  label: string;
}

export default function SpoolResizer({ axis, onResize, onToggle, label }: SpoolResizerProps) {
  const last = useRef<number | null>(null);

  const position = (event: ReactPointerEvent<HTMLDivElement>) => (axis === 'x' ? event.clientX : event.clientY);

  const start = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    last.current = position(event);
    // A drag that selects the labels either side of the handle looks broken.
    document.body.style.userSelect = 'none';
  };

  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (last.current === null) return;
    const now = position(event);
    onResize(now - last.current);
    last.current = now;
  };

  const end = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    last.current = null;
    document.body.style.userSelect = '';
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 64 : 16;
    const back = axis === 'x' ? 'ArrowLeft' : 'ArrowUp';
    const forward = axis === 'x' ? 'ArrowRight' : 'ArrowDown';
    if (event.key === back) { event.preventDefault(); onResize(-step); }
    else if (event.key === forward) { event.preventDefault(); onResize(step); }
    else if (event.key === 'Enter' && onToggle) { event.preventDefault(); onToggle(); }
  };

  return (
    <div
      role="separator"
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      aria-label={label}
      tabIndex={0}
      className={`spool-resizer spool-resizer--${axis}`}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={onToggle}
      onKeyDown={onKeyDown}
    >
      <span aria-hidden="true" />
    </div>
  );
}
