import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { messageFor } from '../api/errors';

export function ErrorBox({ error }: { error: unknown }) {
  if (error === null || error === undefined) return null;
  return (
    <div className="msg msg-error" role="alert">
      ✗ {typeof error === 'string' ? error : messageFor(error)}
    </div>
  );
}

export function SuccessBox({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  return (
    <div className="msg msg-ok" role="status">
      ✓ {text}
    </div>
  );
}

export function WarningBox({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  return (
    <div className="msg msg-warn" role="status">
      ! {text}
    </div>
  );
}

/**
 * The error shown in the form's side panel, right next to the "आगे"/save button. Each new error
 * takes the focus (which also scrolls it into view), so the operator sees it at once.
 */
export function PanelError({ error, children }: { error: unknown; children?: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (error !== null && error !== undefined) ref.current?.focus();
  }, [error]);
  if (error === null || error === undefined) return null;
  return (
    <div ref={ref} tabIndex={-1} className="msg msg-error panel-error" role="alert" data-testid="panel-error">
      ✗ {children ?? (typeof error === 'string' ? error : messageFor(error))}
    </div>
  );
}
