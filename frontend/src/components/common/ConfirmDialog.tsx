import { useId, useRef, type ReactNode } from 'react';
import Modal from './Modal';

export interface ConfirmDialogProps {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Styles the confirm button for destructive actions. */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Accessible replacement for window.confirm(), built on the Modal primitive. */
export default function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  // Initial focus lands on Cancel so Enter never destroys anything by accident.
  const cancelRef = useRef<HTMLButtonElement>(null);

  return (
    <Modal
      onClose={onCancel}
      labelledBy={titleId}
      initialFocusRef={cancelRef}
      overlayClassName="fixed inset-0 z-[999999] flex items-center justify-center bg-black/50 p-4"
      panelClassName="w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
    >
      <h2 id={titleId} className="text-lg font-bold text-gray-800">{title}</h2>
      <div className="mt-2 text-sm leading-relaxed text-gray-600">{message}</div>
      <div className="mt-6 flex justify-end gap-3">
        <button
          ref={cancelRef}
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-50"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className={`rounded-lg px-4 py-2 text-sm font-bold text-white shadow-sm transition-colors ${
            danger ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'
          }`}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
