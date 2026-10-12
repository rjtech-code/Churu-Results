import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { BoothRow, EditWard } from '../../api/adminTypes';
import { api } from '../../api/api';
import { PageIntro, Section } from '../../components/AdminParts';
import { ErrorBox, SuccessBox } from '../../components/ErrorBox';
import { PasswordDialog } from '../../components/PasswordDialog';
import { useApiData } from '../../components/useApiData';
import '../../styles/admin.css';

const numberOrEmpty = (v: number | null) => (v === null ? '' : String(v));
const parse = (s: string) => (s === '' ? 0 : Number(s));

function ReasonInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="field">
      <label htmlFor="change-reason">बदलाव का कारण (कम से कम 10 अक्षर, रिकॉर्ड में रहेगा)</label>
      <textarea
        id="change-reason"
        rows={2}
        maxLength={500}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
      />
    </div>
  );
}

/** One booth: name, registered voters (total computed), and moving it to another ward. */
export function BoothEditPage() {
  const { psId = '', boothId = '' } = useParams();
  const { data, error, reload, loadedAt } = useApiData(async () => {
    const [b, w] = await Promise.all([
      api<{ booths: BoothRow[] }>('GET', `/api/admin/booths?psId=${encodeURIComponent(psId)}`),
      api<{ wards: EditWard[] }>('GET', `/api/admin/wards?psId=${encodeURIComponent(psId)}`),
    ]);
    return { booth: b.booths.find((x) => String(x.id) === boothId) ?? null, wards: w.wards };
  }, [psId, boothId]);
  const [done, setDone] = useState<string | null>(null);

  if (error) return <ErrorBox error={error} />;
  if (!data) return <p className="loading">लोड हो रहा है…</p>;
  if (!data.booth) return <p className="msg msg-error">✗ बूथ नहीं मिला</p>;
  return (
    <BoothForm
      // Fresh data (after a save) starts the form again from the saved values.
      key={loadedAt?.getTime() ?? 0}
      psId={psId}
      booth={data.booth}
      wards={data.wards}
      done={done}
      onSaved={(text) => {
        setDone(text);
        reload();
      }}
      onEdit={() => {
        setDone(null);
      }}
    />
  );
}

function BoothForm({
  psId,
  booth,
  wards,
  done,
  onSaved,
  onEdit,
}: {
  psId: string;
  booth: BoothRow;
  wards: EditWard[];
  done: string | null;
  onSaved: (text: string) => void;
  onEdit: () => void;
}) {
  const [name, setName] = useState(booth.nameHindi);
  const [male, setMale] = useState(numberOrEmpty(booth.voters.male));
  const [female, setFemale] = useState(numberOrEmpty(booth.voters.female));
  const [other, setOther] = useState(numberOrEmpty(booth.voters.other));
  const [psWard, setPsWard] = useState(String(booth.psWard.id));
  const [zpWard, setZpWard] = useState(String(booth.zpWard.id));
  const [reason, setReason] = useState('');
  const [dialog, setDialog] = useState<'details' | 'move' | null>(null);

  const total = parse(male) + parse(female) + parse(other);
  const open = (w: EditWard) => !w.locked && !w.hasEntries;
  const psWards = wards.filter((w) => w.kind === 'PS');
  const zpWards = wards.filter((w) => w.kind === 'ZP');
  const changedDetails =
    name.trim() !== booth.nameHindi ||
    parse(male) !== (booth.voters.male ?? -1) ||
    parse(female) !== (booth.voters.female ?? -1) ||
    total !== (booth.voters.total ?? -1);
  const moved = psWard !== String(booth.psWard.id) || zpWard !== String(booth.zpWard.id);
  const reasonOk = reason.trim().length >= 10;
  // Empty is not 0: a missing voter count must never be saved as 0 (rule 7 would then refuse
  // every entry of this booth). All three numbers must be typed.
  const votersFilled = male !== '' && female !== '' && other !== '';
  const numberInput = (id: string, label: string, value: string, set: (v: string) => void) => (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="num num-small"
        inputMode="numeric"
        disabled={!booth.canEditVoters}
        value={value}
        onChange={(e) => {
          set(e.target.value.replace(/\D/g, '').slice(0, 9));
        }}
      />
    </div>
  );

  const finish = (text: string) => {
    setDialog(null);
    onSaved(text);
  };

  return (
    <>
      <p className="backlink">
        <Link to={`/admin/booths?ps=${encodeURIComponent(psId)}`}>← बूथ / वार्ड</Link>
      </p>
      <PageIntro
        title={`बूथ ${booth.boothNo} — ${booth.nameHindi}`}
        hint="नाम या मतदाता संख्या बदलें, फिर कारण लिखकर सेव करें।"
      />
      <SuccessBox text={done} />

      <Section title="नाम और मतदाता">
        <div className="field">
          <label htmlFor="booth-name">बूथ का नाम (हिंदी में)</label>
          <input
            id="booth-name"
            className="wide"
            maxLength={300}
            disabled={!booth.canEditName}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </div>
        {!booth.canEditName && (
          <p className="muted">वार्ड लॉक है या मतगणना शुरू हो चुकी है, इसलिए नाम नहीं बदल सकता।</p>
        )}
        <div className="form-grid">
          {numberInput('voters-male', 'पुरुष मतदाता', male, setMale)}
          {numberInput('voters-female', 'महिला मतदाता', female, setFemale)}
          {numberInput('voters-other', 'अन्य मतदाता', other, setOther)}
        </div>
        <p>अभी दर्ज कुल मतदाता: {booth.voters.total ?? 'दर्ज नहीं'}</p>
        <p className="big" data-testid="voters-total">
          नया कुल मतदाता: {votersFilled ? total : '—'} (अपने आप जुड़ता है)
        </p>
        {!booth.canEditVoters && (
          <p className="muted">इस बूथ की मतगणना शुरू हो चुकी है, इसलिए मतदाता संख्या नहीं बदल सकती।</p>
        )}
        {!votersFilled && (
          <p className="msg msg-warn">! तीनों संख्याएँ भरें (शून्य हो तो 0 लिखें), तभी सेव होगा।</p>
        )}
        <button
          type="button"
          className="btn btn-primary btn-big"
          disabled={!changedDetails || name.trim() === '' || !votersFilled}
          onClick={() => {
            onEdit();
            setDialog('details');
          }}
        >
          सेव करें
        </button>
      </Section>

      <Section title="बूथ को दूसरे वार्ड में ले जाएँ">
        {booth.canMove ? (
          <>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="move-ps">PS वार्ड</label>
                <select
                  id="move-ps"
                  value={psWard}
                  onChange={(e) => {
                    setPsWard(e.target.value);
                  }}
                >
                  {psWards.map((w) => (
                    <option key={w.id} value={String(w.id)} disabled={!open(w) && w.id !== booth.psWard.id}>
                      वार्ड {w.wardNo}
                      {!open(w) ? ' (लॉक)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="move-zp">ZP वार्ड</label>
                <select
                  id="move-zp"
                  value={zpWard}
                  onChange={(e) => {
                    setZpWard(e.target.value);
                  }}
                >
                  {zpWards.map((w) => (
                    <option key={w.id} value={String(w.id)} disabled={!open(w) && w.id !== booth.zpWard.id}>
                      वार्ड {w.wardNo}
                      {!open(w) ? ' (लॉक)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-big"
              disabled={!moved}
              onClick={() => {
                onEdit();
                setDialog('move');
              }}
            >
              वार्ड बदलें
            </button>
          </>
        ) : (
          <p className="muted">
            यह बूथ अब दूसरे वार्ड में नहीं जा सकता (वार्ड लॉक है या मतगणना शुरू हो चुकी है)।
          </p>
        )}
      </Section>

      {dialog === 'details' && (
        <PasswordDialog
          title={`बूथ ${booth.boothNo} — बदलाव सेव करें?`}
          explain={`नाम "${name.trim()}" और कुल मतदाता ${total} सेव होंगे।`}
          confirmLabel="सेव करें"
          canConfirm={reasonOk}
          onConfirm={async (password) => {
            await api('POST', `/api/admin/booths/${booth.id}`, {
              nameHindi: name.trim(),
              votersMale: parse(male),
              votersFemale: parse(female),
              votersOther: parse(other),
              reason: reason.trim(),
              password,
            });
            finish('बदलाव सेव हो गया');
          }}
          onCancel={() => {
            setDialog(null);
          }}
        >
          <ReasonInput value={reason} onChange={setReason} />
        </PasswordDialog>
      )}
      {dialog === 'move' && (
        <PasswordDialog
          title={`बूथ ${booth.boothNo} — वार्ड बदलें?`}
          explain={`यह बूथ PS वार्ड ${psWards.find((w) => String(w.id) === psWard)?.wardNo ?? '?'} और ZP वार्ड ${zpWards.find((w) => String(w.id) === zpWard)?.wardNo ?? '?'} में चला जाएगा।`}
          confirmLabel="वार्ड बदलें"
          danger
          canConfirm={reasonOk}
          onConfirm={async (password) => {
            await api('POST', `/api/admin/booths/${booth.id}/move`, {
              psWardId: Number(psWard),
              zpWardId: Number(zpWard),
              reason: reason.trim(),
              password,
            });
            finish('बूथ दूसरे वार्ड में चला गया');
          }}
          onCancel={() => {
            setDialog(null);
          }}
        >
          <ReasonInput value={reason} onChange={setReason} />
        </PasswordDialog>
      )}
    </>
  );
}
