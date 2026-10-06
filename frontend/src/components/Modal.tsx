import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

/**
 * A modal dialog on the browser's top layer (<dialog> + showModal()): above every sticky panel and
 * the header, a full-page backdrop, everything behind it inert (no clicks, no Tab), focus inside.
 * Tab cycles inside it. Esc calls `onCancel` (always the safe choice) instead of closing on its own.
 */
export function Modal({
  label,
  onCancel,
  children,
}: {
  label: string;
  onCancel: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement | null>(null);
  const cancelRef = useRef(onCancel);
  useEffect(() => {
    cancelRef.current = onCancel;
  });
  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (!dialog.open) dialog.showModal(); // focuses the first button: the safe choice
    const onEsc = (e: Event) => {
      e.preventDefault();
      cancelRef.current();
    };
    dialog.addEventListener('cancel', onEsc);
    return () => {
      dialog.removeEventListener('cancel', onEsc);
      if (dialog.open) dialog.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="dialog"
      role="alertdialog"
      aria-label={label}
      onKeyDown={(e) => {
        // Keep Tab inside the dialog (the browser would otherwise move on to its own toolbar).
        if (e.key !== 'Tab') return;
        const items = Array.from(
          e.currentTarget.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input, select, textarea',
          ),
        );
        const first = items[0];
        const last = items[items.length - 1];
        if (first === undefined || last === undefined) return;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }}
    >
      {children}
    </dialog>
  );
}
