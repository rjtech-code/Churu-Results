import { useEffect, useState } from 'react';
import { api } from '../../api/api';
import { PageIntro, Section } from '../../components/AdminParts';
import { ErrorBox, SuccessBox, WarningBox } from '../../components/ErrorBox';
import { useApiData } from '../../components/useApiData';
import { useAuth } from '../../auth/AuthContext';
import '../../styles/admin.css';

interface Profile {
  username: string;
  fullName: string | null;
  /** Masked, e.g. c*****u@gmail.com; null = not set. */
  email: string | null;
}
type Purpose = 'USERNAME' | 'PASSWORD';

const NO_EMAIL = 'ईमेल सेट नहीं है, कृपया प्रशासक से संपर्क करें';

function TextField(props: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: 'text' | 'password';
  autoComplete?: string;
  inputMode?: 'numeric';
}) {
  return (
    <div className="field">
      <label htmlFor={props.id}>{props.label}</label>
      <input
        id={props.id}
        type={props.type ?? 'text'}
        autoComplete={props.autoComplete ?? 'off'}
        inputMode={props.inputMode}
        value={props.value}
        onChange={(e) => {
          props.onChange(e.target.value);
        }}
      />
    </div>
  );
}

/** "OTP भेजें": sends a 6-digit code to the saved email; can be pressed again after 60 seconds. */
function SendOtpButton({ purpose, email }: { purpose: Purpose; email: string | null }) {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => {
      setWait(wait - 1);
    }, 1000);
    return () => {
      clearTimeout(t);
    };
  }, [wait]);

  if (email === null) return <WarningBox text={NO_EMAIL} />;
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ email: string }>('POST', '/api/profile/send-otp', { purpose });
      setSentTo(res.email);
      setWait(60);
    } catch (err) {
      setError(err);
      setSentTo(null);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="field">
      <button
        type="button"
        className="btn btn-secondary btn-big"
        disabled={busy || wait > 0}
        onClick={() => void send()}
      >
        {wait > 0 ? `OTP दोबारा भेजें (${String(wait)} सेकंड)` : 'OTP भेजें'}
      </button>
      <SuccessBox text={sentTo === null ? null : `OTP ${sentTo} पर भेजा गया (10 मिनट तक मान्य)`} />
      <ErrorBox error={error} />
    </div>
  );
}

/** One small form: fields + a save button; shows the server's error or a success line. */
function useSave(save: () => Promise<void>, done: string) {
  const [error, setError] = useState<unknown>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      await save();
      setOk(done);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return {
    error,
    ok,
    busy,
    run,
    clear: () => {
      setOk(null);
      setError(null);
    },
  };
}

/** DM "मेरी प्रोफ़ाइल": name (no password, no OTP), username and password (OTP by email only). */
export function ProfilePage() {
  const { refresh } = useAuth();
  const { data, error, reload } = useApiData(() => api<Profile>('GET', '/api/profile'), []);

  const [name, setName] = useState({ fullName: '' });
  const [uname, setUname] = useState({ newUsername: '', otp: '' });
  const [pw, setPw] = useState({ otp: '', newPassword: '', confirmPassword: '' });

  const nameSave = useSave(async () => {
    await api('POST', '/api/profile/name', name);
    setName({ fullName: '' });
    reload();
    await refresh();
  }, 'नाम बदल गया');
  const unameSave = useSave(async () => {
    await api('POST', '/api/profile/username', uname);
    setUname({ newUsername: '', otp: '' });
    reload();
    await refresh();
  }, 'यूज़रनेम बदल गया। अगली बार नए यूज़रनेम से लॉगिन करें।');
  const pwSave = useSave(async () => {
    await api('POST', '/api/profile/password', pw);
    setPw({ otp: '', newPassword: '', confirmPassword: '' });
  }, 'पासवर्ड बदल गया। बाकी सभी जगह से लॉगआउट कर दिया गया है।');

  if (!data) {
    return (
      <>
        <PageIntro title="मेरी प्रोफ़ाइल" hint="" />
        <ErrorBox error={error} />
      </>
    );
  }
  const otpOk = (v: string) => /^\d{6}$/.test(v);

  return (
    <>
      <PageIntro
        title="मेरी प्रोफ़ाइल"
        hint="नाम सीधे बदला जा सकता है। यूज़रनेम या पासवर्ड बदलने के लिए आपकी ईमेल पर OTP आएगा।"
      />

      <Section title="मेरी जानकारी">
        <table className="list" data-testid="profile-info">
          <tbody>
            <tr>
              <th>नाम</th>
              <td>{data.fullName ?? '—'}</td>
            </tr>
            <tr>
              <th>यूज़रनेम</th>
              <td>{data.username}</td>
            </tr>
            <tr>
              <th>ईमेल</th>
              <td>{data.email ?? 'सेट नहीं है'}</td>
            </tr>
          </tbody>
        </table>
        <p className="hint">ईमेल इस पेज से नहीं बदली जा सकती।</p>
      </Section>

      <Section title="नाम बदलें">
        <TextField
          id="p-name"
          label="नया नाम"
          value={name.fullName}
          onChange={(v) => {
            setName({ ...name, fullName: v });
            nameSave.clear();
          }}
        />
        <ErrorBox error={nameSave.error} />
        <SuccessBox text={nameSave.ok} />
        <button
          type="button"
          className="btn btn-big"
          disabled={nameSave.busy || name.fullName.trim().length < 2}
          onClick={() => void nameSave.run()}
        >
          नाम सेव करें
        </button>
      </Section>

      <Section title="यूज़रनेम बदलें">
        <TextField
          id="p-uname"
          label="नया यूज़रनेम (छोटे अंग्रेज़ी अक्षर, अंक और _ ; 4-30 अक्षर)"
          value={uname.newUsername}
          onChange={(v) => {
            setUname({ ...uname, newUsername: v.trim() });
            unameSave.clear();
          }}
        />
        <SendOtpButton purpose="USERNAME" email={data.email} />
        {data.email !== null && (
          <>
            <TextField
              id="p-uname-otp"
              label="ईमेल पर आया OTP (6 अंक)"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={uname.otp}
              onChange={(v) => {
                setUname({ ...uname, otp: v.replace(/\D/g, '').slice(0, 6) });
              }}
            />
            <ErrorBox error={unameSave.error} />
            <SuccessBox text={unameSave.ok} />
            <button
              type="button"
              className="btn btn-big"
              disabled={unameSave.busy || uname.newUsername === '' || !otpOk(uname.otp)}
              onClick={() => void unameSave.run()}
            >
              यूज़रनेम सेव करें
            </button>
          </>
        )}
      </Section>

      <Section title="पासवर्ड बदलें">
        <SendOtpButton purpose="PASSWORD" email={data.email} />
        {data.email !== null && (
          <>
            <TextField
              id="p-pw-otp"
              label="ईमेल पर आया OTP (6 अंक)"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={pw.otp}
              onChange={(v) => {
                setPw({ ...pw, otp: v.replace(/\D/g, '').slice(0, 6) });
                pwSave.clear();
              }}
            />
            <TextField
              id="p-pw-new"
              label="नया पासवर्ड (कम से कम 10 अक्षर, अक्षर और अंक दोनों)"
              type="password"
              autoComplete="new-password"
              value={pw.newPassword}
              onChange={(v) => {
                setPw({ ...pw, newPassword: v });
              }}
            />
            <TextField
              id="p-pw-confirm"
              label="नया पासवर्ड दोबारा"
              type="password"
              autoComplete="new-password"
              value={pw.confirmPassword}
              onChange={(v) => {
                setPw({ ...pw, confirmPassword: v });
              }}
            />
            <ErrorBox error={pwSave.error} />
            <SuccessBox text={pwSave.ok} />
            <button
              type="button"
              className="btn btn-big"
              disabled={pwSave.busy || !otpOk(pw.otp) || pw.newPassword === '' || pw.confirmPassword === ''}
              onClick={() => void pwSave.run()}
            >
              पासवर्ड सेव करें
            </button>
          </>
        )}
      </Section>
    </>
  );
}
