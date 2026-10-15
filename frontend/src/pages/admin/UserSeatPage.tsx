import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Credentials, Seat } from '../../api/adminTypes';
import { api } from '../../api/api';
import { OneTimePassword, PageIntro } from '../../components/AdminParts';
import { ErrorBox, SuccessBox } from '../../components/ErrorBox';
import { CredentialsDialog } from '../../components/CredentialsDialog';
import { PasswordDialog } from '../../components/PasswordDialog';
import { PHONE_ERROR, normalizePhone } from '../../components/phone';
import { useApiData } from '../../components/useApiData';
import { seatState } from './UsersPage';
import '../../styles/admin.css';

type Action = 'create' | 'replace' | 'phone' | 'disable' | 'enable' | 'unlock';

const ACTIONS: Record<
  Action,
  { label: string; explain: string; danger: boolean; needsName: boolean; needsPhone?: boolean }
> = {
  create: {
    label: 'नया RO बनाएँ',
    explain: 'इस पद के लिए नया खाता बनेगा।',
    danger: false,
    needsName: true,
    needsPhone: true,
  },
  replace: {
    label: 'RO बदलें',
    explain: 'पुराना खाता बंद होगा (वह तुरंत लॉगआउट होगा) और नए RO का नया खाता बनेगा।',
    danger: true,
    needsName: true,
    needsPhone: true,
  },
  phone: {
    label: 'मोबाइल जोड़ें',
    explain: 'RO का मोबाइल नंबर सहेजा जाएगा। यह केवल आपको दिखेगा।',
    danger: false,
    needsName: false,
    needsPhone: true,
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
  const [phone, setPhone] = useState('');
  const [editing, setEditing] = useState(false);
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const current = data?.seats.find((s) => s.seat === seat) ?? null;
  const account = current?.account ?? null;

  const run = async (a: Action, password: string, cleanPhone: string) => {
    const base = account ? `/api/admin/users/${account.id}` : '';
    if (a === 'create') {
      setCredentials(
        await api<Credentials>('POST', '/api/admin/users/create', {
          seat,
          fullName: fullName.trim(),
          phone: cleanPhone,
          password,
        }),
      );
    } else if (a === 'replace') {
      setCredentials(
        await api<Credentials>('POST', `${base}/replace`, {
          fullName: fullName.trim(),
          phone: cleanPhone,
          password,
        }),
      );
    } else if (a === 'phone') {
      await api('POST', `${base}/phone`, { phone: cleanPhone, password });
      setDone('मोबाइल नंबर सहेज लिया गया');
    } else {
      await api('POST', `${base}/${a}`, { password });
      setDone(a === 'disable' ? 'खाता बंद हो गया' : a === 'enable' ? 'खाता चालू हो गया' : 'लॉक खुल गया');
    }
    setAction(null);
    reload();
  };

  const actionLabel = (a: Action) => (a === 'phone' && account?.phone ? 'मोबाइल बदलें' : ACTIONS[a].label);

  const available: Action[] =
    account === null
      ? ['create']
      : [
          ...(account.locked ? (['unlock'] as const) : []),
          account.isActive ? 'disable' : 'enable',
          'replace',
          'phone',
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
              <dt>मोबाइल नंबर</dt>
              <dd data-testid="seat-phone">{account?.phone ?? '—'}</dd>
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
              {account !== null && (
                <button
                  type="button"
                  className="btn btn-big btn-primary"
                  onClick={() => {
                    setDone(null);
                    setEditing(true);
                  }}
                >
                  बदलें
                </button>
              )}
              {available.map((a) => (
                <button
                  key={a}
                  type="button"
                  className={`btn btn-big ${a === 'create' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => {
                    setDone(null);
                    setFullName('');
                    setPhone('');
                    setAction(a);
                  }}
                >
                  {actionLabel(a)}
                </button>
              ))}
            </div>
          </>
        )
      )}
      {editing && account !== null && (
        <CredentialsDialog
          userId={account.id}
          currentUsername={account.username}
          currentPhone={account.phone}
          title={`${current?.label ?? ''} — बदलें`}
          onSaved={(saved) => {
            setEditing(false);
            if (saved.credentialsChanged === false) setDone('मोबाइल नंबर सहेज लिया गया');
            else if (saved.password === null) setDone('यूज़रनेम बदल गया');
            else setCredentials({ username: saved.username, password: saved.password });
            reload();
          }}
          onCancel={() => {
            setEditing(false);
          }}
        />
      )}
      {action && (
        <PasswordDialog
          title={`${current?.label ?? ''} — ${actionLabel(action)}`}
          explain={ACTIONS[action].explain}
          confirmLabel={actionLabel(action)}
          danger={ACTIONS[action].danger}
          canConfirm={
            (!ACTIONS[action].needsName || fullName.trim().length >= 2) &&
            (ACTIONS[action].needsPhone !== true || normalizePhone(phone) !== null)
          }
          onConfirm={(password) => run(action, password, normalizePhone(phone) ?? '')}
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
          {ACTIONS[action].needsPhone === true && (
            <div className="field">
              <label htmlFor="ro-phone">मोबाइल नंबर</label>
              <input
                id="ro-phone"
                inputMode="tel"
                maxLength={20}
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                }}
              />
              {phone !== '' && normalizePhone(phone) === null && <p className="field-error">{PHONE_ERROR}</p>}
            </div>
          )}
        </PasswordDialog>
      )}
    </>
  );
}
