import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Credentials, Seat } from '../../api/adminTypes';
import { api } from '../../api/api';
import { OneTimePassword, PageIntro } from '../../components/AdminParts';
import { ErrorBox, SuccessBox } from '../../components/ErrorBox';
import { PasswordDialog } from '../../components/PasswordDialog';
import { useApiData } from '../../components/useApiData';
import { seatState } from './UsersPage';
import '../../styles/admin.css';

type Action = 'create' | 'replace' | 'reset' | 'disable' | 'enable' | 'unlock';

const ACTIONS: Record<Action, { label: string; explain: string; danger: boolean; needsName: boolean }> = {
  create: { label: 'नया RO बनाएँ', explain: 'इस पद के लिए नया खाता बनेगा।', danger: false, needsName: true },
  replace: {
    label: 'RO बदलें',
    explain: 'पुराना खाता बंद होगा (वह तुरंत लॉगआउट होगा) और नए RO का नया खाता बनेगा।',
    danger: true,
    needsName: true,
  },
  reset: {
    label: 'पासवर्ड बदलें',
    explain: 'इस RO का नया पासवर्ड बनेगा; पुराना पासवर्ड काम नहीं करेगा और वह लॉगआउट होगा।',
    danger: true,
    needsName: false,
  },
  disable: {
    label: 'बंद करें',
    explain: 'यह खाता बंद होगा; RO लॉगिन नहीं कर सकेगा।',
    danger: true,
    needsName: false,
  },
  enable: { label: 'चालू करें', explain: 'यह खाता फिर से चालू होगा।', danger: false, needsName: false },
  unlock: {
    label: 'लॉक खोलें',
    explain: 'गलत पासवर्ड से लगा लॉक हटेगा; पासवर्ड वही रहेगा।',
    danger: false,
    needsName: false,
  },
};

/** One post: the account and every action on it (each needs the DM's password). */
export function UserSeatPage() {
  const { seat = '' } = useParams();
  const { data, error, reload } = useApiData(() => api<{ seats: Seat[] }>('GET', '/api/admin/users'), []);
  const [action, setAction] = useState<Action | null>(null);
  const [fullName, setFullName] = useState('');
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const current = data?.seats.find((s) => s.seat === seat) ?? null;
  const account = current?.account ?? null;

  const run = async (a: Action, password: string) => {
    const base = account ? `/api/admin/users/${account.id}` : '';
    if (a === 'create') {
      setCredentials(
        await api<Credentials>('POST', '/api/admin/users/create', {
          seat,
          fullName: fullName.trim(),
          password,
        }),
      );
    } else if (a === 'replace') {
      setCredentials(
        await api<Credentials>('POST', `${base}/replace`, { fullName: fullName.trim(), password }),
      );
    } else if (a === 'reset') {
      setCredentials(await api<Credentials>('POST', `${base}/reset-password`, { password }));
    } else {
      await api('POST', `${base}/${a}`, { password });
      setDone(a === 'disable' ? 'खाता बंद हो गया' : a === 'enable' ? 'खाता चालू हो गया' : 'लॉक खुल गया');
    }
    setAction(null);
    reload();
  };

  const available: Action[] =
    account === null
      ? ['create']
      : [
          'reset',
          ...(account.locked ? (['unlock'] as const) : []),
          account.isActive ? 'disable' : 'enable',
          'replace',
        ];

  return (
    <>
      <p className="backlink">
        <Link to="/admin/users">← RO सूची</Link>
      </p>
      <PageIntro
        title={current ? `${current.label} — RO खाता` : 'RO खाता'}
        hint="नीचे से एक काम चुनें। हर काम के लिए आपका पासवर्ड लगेगा।"
      />
      <ErrorBox error={error} />
      {credentials ? (
        <OneTimePassword
          username={credentials.username}
          password={credentials.password}
          onDone={() => {
            setCredentials(null);
          }}
        />
      ) : (
        current && (
          <>
            <dl className="facts">
              <dt>नाम</dt>
              <dd>{account?.fullName ?? '—'}</dd>
              <dt>यूज़रनेम</dt>
              <dd>{account?.username ?? '—'}</dd>
              <dt>स्थिति</dt>
              <dd data-testid="seat-state">{seatState(current)}</dd>
            </dl>
            {current.olderAccounts > 0 && (
              <p className="muted">
                इस पद के {current.olderAccounts} पुराने (बंद) खाते रिकॉर्ड के लिए रखे गए हैं।
              </p>
            )}
            <SuccessBox text={done} />
            <div className="actions action-list">
              {available.map((a) => (
                <button
                  key={a}
                  type="button"
                  className={`btn btn-big ${a === 'create' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => {
                    setDone(null);
                    setFullName('');
                    setAction(a);
                  }}
                >
                  {ACTIONS[a].label}
                </button>
              ))}
            </div>
          </>
        )
      )}
      {action && (
        <PasswordDialog
          title={`${current?.label ?? ''} — ${ACTIONS[action].label}`}
          explain={ACTIONS[action].explain}
          confirmLabel={ACTIONS[action].label}
          danger={ACTIONS[action].danger}
          canConfirm={!ACTIONS[action].needsName || fullName.trim().length >= 2}
          onConfirm={(password) => run(action, password)}
          onCancel={() => {
            setAction(null);
          }}
        >
          {ACTIONS[action].needsName && (
            <div className="field">
              <label htmlFor="ro-full-name">नए RO का पूरा नाम</label>
              <input
                id="ro-full-name"
                maxLength={100}
                value={fullName}
                onChange={(e) => {
                  setFullName(e.target.value);
                }}
              />
            </div>
          )}
        </PasswordDialog>
      )}
    </>
  );
}
