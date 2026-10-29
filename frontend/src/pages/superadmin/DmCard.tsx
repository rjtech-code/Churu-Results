import { useState } from 'react';
import { api } from '../../api/api';
import type { Overview } from '../../api/superadminTypes';
import { OneTimePassword } from '../../components/AdminParts';
import { ActionButton, ConfirmDialog, Problems, TaskCard } from './parts';

type Dialog = 'password' | 'unlock' | 'email' | null;
interface DmResult {
  ok: boolean;
  changed: boolean;
  problems: string[];
}

/** One card, three actions on the DM account. Only the new password needs the password. */
export function DmCard({ ov, onChanged }: { ov: Overview; onChanged: () => void }) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const [email, setEmail] = useState('');
  const dm = ov.dm;
  const close = (changed: boolean) => {
    setDialog(null);
    if (changed) onChanged();
  };
  const checked = <T extends DmResult>(r: T): T => {
    if (!r.ok) throw new Problems(r.problems);
    return r;
  };

  if (dm === null) {
    return (
      <TaskCard title="DM account" icon="👤" intro={<p>कोई active DM account नहीं है।</p>}>
        {null}
      </TaskCard>
    );
  }
  return (
    <TaskCard
      title="DM account"
      icon="👤"
      testId="card-dm"
      intro={
        <dl className="sa-facts">
          <div>
            <dt>Username</dt>
            <dd>{dm.username}</dd>
          </div>
          <div>
            <dt>नाम</dt>
            <dd>{dm.fullName ?? '—'}</dd>
          </div>
          <div>
            <dt>Email (OTP)</dt>
            <dd>{dm.email ?? 'नहीं है'}</dd>
          </div>
          <div>
            <dt>Login</dt>
            <dd className={dm.lockedNow ? 'sa-text-bad' : 'sa-text-ok'}>
              {dm.lockedNow ? '🔒 Locked' : '✓ खुला'}
              {dm.failedLogins > 0 ? ` · ${String(dm.failedLogins)} गलत प्रयास` : ''}
            </dd>
          </div>
        </dl>
      }
    >
      <div className="sa-row-actions">
        <ActionButton
          label="नया password बनाएँ"
          reason={null}
          onClick={() => {
            setDialog('password');
          }}
        />
        <ActionButton
          label="Lock हटाएँ"
          kind="secondary"
          reason={dm.lockedNow || dm.failedLogins > 0 ? null : 'Account locked नहीं है'}
          onClick={() => {
            setDialog('unlock');
          }}
        />
      </div>
      <div className="sa-inline">
        <div className="field">
          <label htmlFor="sa-dm-email">नया email</label>
          <input
            id="sa-dm-email"
            className="sa-input"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
            }}
          />
        </div>
        <ActionButton
          label="Email बदलें"
          kind="secondary"
          reason={email.trim() === '' ? 'पहले नया email लिखें' : null}
          onClick={() => {
            setDialog('email');
          }}
        />
      </div>

      {dialog === 'password' && (
        <ConfirmDialog
          title="DM का नया password"
          summary={
            <p>DM का पुराना password बंद हो जाएगा। नया password सिर्फ़ एक बार दिखेगा। Lock भी हट जाएगा।</p>
          }
          askPassword={ov.confirmedUntil === null}
          confirmLabel="नया password बनाएँ"
          run={async (password) => {
            const r = checked(
              await api<DmResult & { username: string; newPassword: string | null }>(
                'POST',
                '/api/superadmin/dm/reset-password',
                password ? { password } : {},
              ),
            );
            return {
              title: 'नया password बन गया',
              lines: [],
              extra:
                r.newPassword === null ? null : (
                  <OneTimePassword
                    username={r.username}
                    password={r.newPassword}
                    onDone={() => {
                      close(true);
                    }}
                  />
                ),
            };
          }}
          onClose={close}
        />
      )}
      {dialog === 'unlock' && (
        <ConfirmDialog
          title="DM का lock हटाएँ"
          summary={<p>गलत password से लगा lock हटेगा। Password नहीं बदलेगा।</p>}
          askPassword={false}
          confirmLabel="Lock हटाएँ"
          run={async () => {
            checked(await api<DmResult>('POST', '/api/superadmin/dm/unlock', {}));
            return { title: 'DM का lock हट गया', lines: [] };
          }}
          onClose={close}
        />
      )}
      {dialog === 'email' && (
        <ConfirmDialog
          title="DM का email बदलें"
          summary={
            <p>
              OTP अब <strong>{email.trim()}</strong> पर जाएगा।
            </p>
          }
          askPassword={false}
          confirmLabel="Email बदलें"
          run={async () => {
            checked(await api<DmResult>('POST', '/api/superadmin/dm/email', { email: email.trim() }));
            setEmail('');
            return { title: 'Email बदल गया', lines: [] };
          }}
          onClose={close}
        />
      )}
    </TaskCard>
  );
}
