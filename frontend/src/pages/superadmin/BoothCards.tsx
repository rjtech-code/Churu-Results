import { useState } from 'react';
import { api } from '../../api/api';
import { fmt } from '../../api/superadminTypes';
import type { BoothWards, Overview, PanelBooth } from '../../api/superadminTypes';
import { useApiData } from '../../components/useApiData';
import { ActionButton, ConfirmDialog, TaskCard } from './parts';

type PsList = Overview['panchayatSamitis'];
const WARD_CLOSED = 'counting data है';

function PsSelect({
  id,
  ps,
  value,
  onChange,
}: {
  id: string;
  ps: PsList;
  value: number;
  onChange: (id: number) => void;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>Panchayat Samiti</label>
      <select
        id={id}
        className="sa-input"
        value={value}
        onChange={(e) => {
          onChange(Number(e.target.value));
        }}
      >
        {ps.map((p) => (
          <option key={p.id} value={p.id}>
            {p.nameHindi === p.nameEnglish ? p.nameEnglish : `${p.nameHindi} — ${p.nameEnglish}`}
          </option>
        ))}
      </select>
    </div>
  );
}

const EMPTY = {
  psWardNo: '',
  zpWardNo: '',
  boothNo: '',
  nameHindi: '',
  nameEnglish: '',
  votersMale: '',
  votersFemale: '',
  votersOther: '0',
};
type Form = typeof EMPTY;
const NUMBER_FIELDS: readonly [keyof Form, string][] = [
  ['boothNo', 'Booth no.'],
  ['votersMale', 'Male voters'],
  ['votersFemale', 'Female voters'],
  ['votersOther', 'Other voters'],
];
const whole = (t: string) => /^\d{1,7}$/.test(t.trim());

/** Add one booth: PS → PS ward → ZP ward (wards with counting data cannot be picked). */
export function BoothAddCard({ ov, onChanged }: { ov: Overview; onChanged: () => void }) {
  const [psId, setPsId] = useState(ov.panchayatSamitis[0]?.id ?? 0);
  const [form, setForm] = useState<Form>(EMPTY);
  const [open, setOpen] = useState(false);
  const wards = useApiData(
    () => api<BoothWards>('GET', `/api/superadmin/wards?psId=${String(psId)}`),
    [psId],
  );
  const set = (key: keyof Form) => (v: string) => {
    setForm((f) => ({ ...f, [key]: v }));
  };
  const missing =
    form.psWardNo === '' || form.zpWardNo === ''
      ? 'PS ward और ZP ward चुनें'
      : !whole(form.boothNo) || Number(form.boothNo) < 1
        ? 'Booth no. लिखें'
        : form.nameHindi.trim() === ''
          ? 'Booth का Hindi name लिखें'
          : !NUMBER_FIELDS.every(([k]) => whole(form[k]))
            ? 'Voters की संख्या लिखें (0 भी चलेगा)'
            : null;
  const total = Number(form.votersMale || 0) + Number(form.votersFemale || 0) + Number(form.votersOther || 0);

  if (ov.panchayatSamitis.length === 0) {
    return (
      <TaskCard title="Booth जोड़ें" icon="➕" intro={<p>पहले मास्टर डेटा (Geography) डालें।</p>}>
        {null}
      </TaskCard>
    );
  }
  return (
    <TaskCard
      title="Booth जोड़ें"
      icon="➕"
      testId="card-booth-add"
      intro={<p>छूटा हुआ booth जोड़ें। सिर्फ़ उन्हीं wards में, जहाँ अभी counting शुरू नहीं हुई।</p>}
    >
      <PsSelect
        id="sa-add-ps"
        ps={ov.panchayatSamitis}
        value={psId}
        onChange={(id) => {
          setPsId(id);
          setForm(EMPTY);
        }}
      />
      <div className="sa-grid">
        {(['psWardNo', 'zpWardNo'] as const).map((key) => {
          const list = key === 'psWardNo' ? wards.data?.psWards : wards.data?.zpWards;
          return (
            <div className="field" key={key}>
              <label htmlFor={`sa-add-${key}`}>{key === 'psWardNo' ? 'PS ward' : 'ZP ward'}</label>
              <select
                id={`sa-add-${key}`}
                className="sa-input"
                value={form[key]}
                onChange={(e) => {
                  set(key)(e.target.value);
                }}
              >
                <option value="">— चुनें —</option>
                {(list ?? []).map((w) => (
                  <option key={w.wardNo} value={w.wardNo} disabled={!w.open}>
                    Ward {w.wardNo}
                    {w.open ? '' : ` (${WARD_CLOSED})`}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
        <div className="field sa-span2">
          <label htmlFor="sa-add-nameHindi">Booth name (Hindi)</label>
          <input
            id="sa-add-nameHindi"
            className="sa-input"
            value={form.nameHindi}
            onChange={(e) => {
              set('nameHindi')(e.target.value);
            }}
          />
        </div>
        <div className="field sa-span2">
          <label htmlFor="sa-add-nameEnglish">Booth name (English, optional)</label>
          <input
            id="sa-add-nameEnglish"
            className="sa-input"
            value={form.nameEnglish}
            onChange={(e) => {
              set('nameEnglish')(e.target.value);
            }}
          />
        </div>
        {NUMBER_FIELDS.map(([key, label]) => (
          <div className="field" key={key}>
            <label htmlFor={`sa-add-${key}`}>{label}</label>
            <input
              id={`sa-add-${key}`}
              className="sa-input"
              inputMode="numeric"
              value={form[key]}
              onChange={(e) => {
                set(key)(e.target.value);
              }}
            />
          </div>
        ))}
      </div>
      <ActionButton
        label="Booth जोड़ें"
        reason={ov.booths.reason ?? missing}
        onClick={() => {
          setOpen(true);
        }}
      />
      {open && (
        <ConfirmDialog
          title="Booth जोड़ें"
          summary={
            <p>
              Booth <strong>{form.boothNo}</strong> — {form.nameHindi} · PS ward {form.psWardNo} · ZP ward{' '}
              {form.zpWardNo} · कुल voters {fmt(total)}। पहले backup बनेगा।
            </p>
          }
          askPassword={false}
          confirmLabel="हाँ, जोड़ें"
          run={async () => {
            const r = await api<{ backupFile: string }>('POST', '/api/superadmin/booths/add', {
              psId,
              boothNo: Number(form.boothNo),
              nameHindi: form.nameHindi,
              nameEnglish: form.nameEnglish.trim() === '' ? null : form.nameEnglish,
              psWardNo: Number(form.psWardNo),
              zpWardNo: Number(form.zpWardNo),
              votersMale: Number(form.votersMale),
              votersFemale: Number(form.votersFemale),
              votersOther: Number(form.votersOther),
            });
            const no = form.boothNo;
            setForm(EMPTY);
            return { title: `Booth ${no} जुड़ गया`, lines: [], backupFile: r.backupFile };
          }}
          onClose={(changed) => {
            setOpen(false);
            if (changed) {
              wards.reload();
              onChanged();
            }
          }}
        />
      )}
    </TaskCard>
  );
}

/** Delete one booth: search, pick, type its number. */
export function BoothDeleteCard({ ov, onChanged }: { ov: Overview; onChanged: () => void }) {
  const [psId, setPsId] = useState(ov.panchayatSamitis[0]?.id ?? 0);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<PanelBooth | null>(null);
  const [open, setOpen] = useState(false);
  const booths = useApiData(
    () => api<{ booths: PanelBooth[] }>('GET', `/api/superadmin/booths?psId=${String(psId)}`),
    [psId],
  );
  const q = query.trim().toLowerCase();
  const matches = (booths.data?.booths ?? [])
    .filter((b) => q === '' || String(b.boothNo) === q || b.nameHindi.toLowerCase().includes(q))
    .slice(0, 8);

  if (ov.panchayatSamitis.length === 0) return null;
  return (
    <TaskCard
      title="Booth हटाएँ"
      icon="🗑️"
      danger
      testId="card-booth-delete"
      intro={<p>गलती से जुड़ा booth हटाएँ। जिस booth के ward में counting data है, वह नहीं हटेगा।</p>}
    >
      <div className="sa-grid">
        <PsSelect
          id="sa-del-ps"
          ps={ov.panchayatSamitis}
          value={psId}
          onChange={(id) => {
            setPsId(id);
            setPicked(null);
          }}
        />
        <div className="field">
          <label htmlFor="sa-del-q">Booth no. या नाम से खोजें</label>
          <input
            id="sa-del-q"
            className="sa-input"
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPicked(null);
            }}
          />
        </div>
      </div>
      <ul className="sa-booth-list" aria-label="Booths">
        {matches.map((b) => (
          <li key={b.id}>
            <label className={`sa-booth${b.canDelete ? '' : ' sa-booth-closed'}`}>
              <input
                type="radio"
                name="sa-del-booth"
                checked={picked?.id === b.id}
                onChange={() => {
                  setPicked(b);
                }}
              />
              <span>
                <strong>Booth {b.boothNo}</strong> — {b.nameHindi}
                <span className="sa-booth-meta">
                  PS ward {b.psWardNo} · ZP ward {b.zpWardNo}
                  {b.canDelete ? '' : ` · ${WARD_CLOSED}`}
                </span>
              </span>
            </label>
          </li>
        ))}
        {booths.data && matches.length === 0 && <li className="muted">कोई booth नहीं मिला</li>}
      </ul>
      <ActionButton
        label={picked ? `Booth ${String(picked.boothNo)} हटाएँ` : 'Booth हटाएँ'}
        kind="danger"
        reason={
          ov.booths.reason ??
          (picked === null
            ? 'पहले ऊपर से booth चुनें'
            : picked.canDelete
              ? null
              : 'इस booth के ward में counting data है — इसे नहीं हटा सकते')
        }
        onClick={() => {
          setOpen(true);
        }}
      />
      {open && picked && (
        <ConfirmDialog
          title={`Booth ${String(picked.boothNo)} हटाएँ`}
          danger
          summary={
            <p>
              <strong>Booth {picked.boothNo}</strong> — {picked.nameHindi} (PS ward {picked.psWardNo}, ZP ward{' '}
              {picked.zpWardNo}, voters {picked.votersTotal === null ? '—' : fmt(picked.votersTotal)}) हट
              जाएगा। पहले backup बनेगा।
            </p>
          }
          word={String(picked.boothNo)}
          askPassword={ov.confirmedUntil === null}
          confirmLabel="Booth हटाएँ"
          run={async (password) => {
            const r = await api<{ backupFile: string }>(
              'POST',
              `/api/superadmin/booths/${String(picked.id)}/delete`,
              { confirmText: String(picked.boothNo), ...(password ? { password } : {}) },
            );
            return { title: `Booth ${String(picked.boothNo)} हट गया`, lines: [], backupFile: r.backupFile };
          }}
          onClose={(changed) => {
            setOpen(false);
            if (changed) {
              setPicked(null);
              booths.reload();
              onChanged();
            }
          }}
        />
      )}
    </TaskCard>
  );
}
