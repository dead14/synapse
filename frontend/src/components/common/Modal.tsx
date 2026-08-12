import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

/** Elements that can receive keyboard focus inside the dialog. */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

// Modals can stack (e.g. a confirm dialog above a full-screen panel), so the
// body scroll lock is reference-counted and only restored by the last one out.
let scrollLockCount = 0;
let previousBodyOverflow = '';

function lockBodyScroll() {
  if (scrollLockCount === 0) {
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  scrollLockCount += 1;
}

function unlockBodyScroll() {
  scrollLockCount = Math.max(0, scrollLockCount - 1);
  if (scrollLockCount === 0) document.body.style.overflow = previousBodyOverflow;
}

export interface ModalProps {
  onClose: () => void;
  children: ReactNode;
  /** id of the element that titles the dialog (preferred). */
  labelledBy?: string;
  /** Accessible name when no visible title element exists. */
  ariaLabel?: string;
  /** Wrapper that covers the viewport; sites keep their existing backdrop styling. */
  overlayClassName?: string;
  /**
   * The dialog surface; sites keep their existing panel styling.
   *
   * This *replaces* the default, background and all — passing only sizing
   * (`max-w-3xl w-full`) leaves a transparent dialog with the page showing
   * through it. Pass `ds-dialog` for the token-based surface, or include a
   * background of your own.
   */
  panelClassName?: string;
  /** Close when the backdrop (not the panel) is clicked. Default true. */
  closeOnBackdrop?: boolean;
  /** Element to focus when the dialog opens; defaults to the first focusable child. */
  initialFocusRef?: RefObject<HTMLElement | null>;
}

/**
 * Accessible modal behavior: role="dialog", aria-modal, initial focus, a
 * Tab/Shift+Tab focus trap, Escape-to-close, focus restoration to the opener,
 * and a body scroll lock. Rendering is portaled to <body> so stacking follows
 * mount order.
 */
export default function Modal({
  onClose,
  children,
  labelledBy,
  ariaLabel,
  overlayClassName = 'fixed inset-0 z-[999999] flex items-center justify-center bg-black/50 p-4',
  panelClassName = 'w-full max-w-lg rounded-xl bg-white p-6 shadow-xl',
  closeOnBackdrop = true,
  initialFocusRef,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const opener = document.activeElement;
    lockBodyScroll();
    const target = initialFocusRef?.current
      ?? panelRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
      ?? panelRef.current;
    target?.focus();
    return () => {
      unlockBodyScroll();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
    // Mount-only by design: the component exists exactly while the dialog is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onCloseRef.current();
      return;
    }
    if (event.key !== 'Tab') return;
    // Portaled children still bubble through the React tree, so without this a
    // stacked modal's Tab would also run an ancestor modal's trap and yank
    // focus out of the topmost dialog.
    event.stopPropagation();
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      .filter((element) => element === document.activeElement || element.getClientRects().length > 0);
    if (focusable.length === 0) {
      event.preventDefault();
      panel.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey) {
      if (active === first || active === panel || !panel.contains(active)) {
        event.preventDefault();
        last.focus();
      }
    } else if (active === last || !panel.contains(active)) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleBackdropMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (closeOnBackdrop && event.target === event.currentTarget) onCloseRef.current();
  };

  return createPortal(
    <div className={overlayClassName} onKeyDown={handleKeyDown} onMouseDown={handleBackdropMouseDown}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : ariaLabel}
        tabIndex={-1}
        className={panelClassName}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
