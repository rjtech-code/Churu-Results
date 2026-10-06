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
