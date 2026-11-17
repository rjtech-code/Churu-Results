// "RO लॉगिन खोलें": the counting logins that are locked right now, and one action to open them.
//
// An officer who types their password wrong five times is locked out for fifteen minutes. Until now
// that could only be cleared with a terminal script; on counting day the DM has the officer standing
// in front of them, so the DM clears it here. It UNLOCKS only — the officer's own password is never
// touched, read or shown (changing a password is a separate action on the RO सूची page).
import { useState } from 'react';
import type { LockedAccount } from '../api/adminTypes';
import { api } from '../api/api';
import { ErrorBox, SuccessBox } from './ErrorBox';
import { PasswordDialog } from './PasswordDialog';
import { useApiData } from './useApiData';

const ROLE_HI: Readonly<Record<LockedAccount['role'], string>> = {
  PS_RO: 'पंचायत समिति RO',
  ZP_RO: 'ज़िला परिषद RO',
  DM: 'DM',
};

/** "आज 14:05" / "16.11.2026, 14:05". */
function when(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const time = at.toLocaleTimeString('hi-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
  const today = new Date();
  const sameDay =
    at.getDate() === today.getDate() &&
    at.getMonth() === today.getMonth() &&
    at.getFullYear() === today.getFullYear();
  return sameDay
    ? `आज ${time}`
    : `${at.toLocaleDateString('hi-IN', { day: '2-digit', month: '2-digit', year: 'numeric' })}, ${time}`;
}

function stateOf(a: LockedAccount): string {
  if (a.locked) {
    const since = a.lockedSince === null ? '' : ` · ${when(a.lockedSince)} से`;
    const until = a.lockedUntil === null ? '' : `, ${when(a.lockedUntil)} तक`;
    return `लॉक${since}${until}`;
  }
  return `${String(a.failedLogins)} गलत कोशिश (लॉक नहीं)`;
}

export function LockedLogins() {
  const { data, error, reload } = useApiData(
    () => api<{ accounts: LockedAccount[] }>('GET', '/api/admin/users/locked'),
    [],
  );
  const [unlocking, setUnlocking] = useState<LockedAccount | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);
  const accounts = data?.accounts ?? [];

  const run = async (account: LockedAccount, password: string) => {
    setActionError(null);
    try {
      await api('POST', `/api/admin/users/${String(account.id)}/unlock`, { password });
      setDone(`${account.fullName ?? account.username} का लॉगिन खोल दिया गया`);
      setUnlocking(null);
      reload();
    } catch (err) {
      setActionError(err);
    }
  };

  return (
    <section className="locked-logins" aria-label="लॉक लॉगिन" data-testid="locked-logins">
      <div className="locked-head">
        <h3>RO लॉगिन खोलें</h3>
        <p className="page-hint">
          पाँच बार गलत पासवर्ड पर खाता 15 मिनट के लिए लॉक हो जाता है। यहाँ से वही लॉक हटता है — पासवर्ड वही रहता है,
          बदलता नहीं।
        </p>
      </div>
      <ErrorBox error={error ?? actionError} />
      <SuccessBox text={done} />
      {accounts.length === 0 ? (
        <p className="locked-none" data-testid="locked-none">
          ✔ अभी कोई लॉगिन लॉक नहीं है।
        </p>
      ) : (
        <ul className="locked-list">
          {accounts.map((a) => (
            <li key={a.id} className={a.locked ? 'locked-row locked-now' : 'locked-row'}>
              <span className="locked-who">
                <span className="locked-name">{a.fullName ?? a.username}</span>
                <span className="locked-role">
                  {ROLE_HI[a.role]}
                  {a.psName === null ? '' : ` — ${a.psName}`} · {a.username}
                </span>
              </span>
              <span className="locked-state">
                <span aria-hidden="true">{a.locked ? '🔒' : '•'}</span> {stateOf(a)}
              </span>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setUnlocking(a);
                }}
              >
                लॉगिन खोलें
              </button>
            </li>
          ))}
        </ul>
      )}
      {unlocking !== null && (
        <PasswordDialog
          title={`${unlocking.fullName ?? unlocking.username} — लॉगिन खोलें`}
          explain="लॉक और गलत कोशिशों की गिनती हट जाएगी। पासवर्ड वही रहेगा; अधिकारी तुरंत अपने उसी पासवर्ड से लॉगिन कर सकेंगे।"
          confirmLabel="लॉगिन खोलें"
          onConfirm={(password) => run(unlocking, password)}
          onCancel={() => {
            setUnlocking(null);
          }}
        />
      )}
    </section>
  );
}
