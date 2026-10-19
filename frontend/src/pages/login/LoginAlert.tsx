import { AlertIcon } from './icons';

// The notice (role=status) and the login error (role=alert) as one inline alert style.
export function LoginAlert({ kind, text }: { kind: 'warn' | 'error'; text: string }) {
  return (
    <div className={`login-alert login-alert-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <AlertIcon />
      <span>{text}</span>
    </div>
  );
}
