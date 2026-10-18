import { useState } from 'react';
import type { PartiesPreview, Party } from '../../api/adminTypes';
import type { Issue } from '../../api/adminTypes';
import { api } from '../../api/api';
import { IssueList, PageIntro, Section, issuesOf } from '../../components/AdminParts';
import { ErrorBox, SuccessBox } from '../../components/ErrorBox';
import { UploadFlow } from '../../components/UploadFlow';
import { useApiData } from '../../components/useApiData';
import '../../styles/admin.css';

const EMPTY = { nameHindi: '', nameEnglish: '', shortName: '', symbol: '' };

/** DM "पार्टी सूची": upload the parties Excel, or add one party. */
export function PartiesPage() {
  const { data, error, reload } = useApiData(
    () => api<{ parties: Party[] }>('GET', '/api/admin/parties'),
    [],
  );
  const [form, setForm] = useState(EMPTY);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<unknown>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [added, setAdded] = useState<string | null>(null);
  const complete = Object.values(form).every((v) => v.trim() !== '');

  const add = async () => {
    if (adding) return;
    setAdding(true);
    setAddError(null);
    try {
      await api('POST', '/api/admin/parties/add', form);
    } catch (err) {
      const list = issuesOf(err);
      if (list === null) setAddError(err);
      else setIssues(list);
      return;
    } finally {
      setAdding(false);
    }
    setAdded(`पार्टी "${form.shortName}" जुड़ गई`);
    setForm(EMPTY);
    reload();
  };

  const field = (key: keyof typeof EMPTY, label: string) => (
    <div className="field">
      <label htmlFor={`party-${key}`}>{label}</label>
      <input
        id={`party-${key}`}
        value={form[key]}
        onChange={(e) => {
          setForm({ ...form, [key]: e.target.value });
          setAdded(null);
          setIssues([]);
          setAddError(null);
        }}
      />
    </div>
  );

  return (
    <>
      <PageIntro title="पार्टी सूची" hint="यहाँ पार्टियों की Excel फ़ाइल चुनें, या नीचे एक पार्टी जोड़ें।" />
      <UploadFlow<PartiesPreview>
        checkPath="/api/admin/parties/check"
        savePath="/api/admin/parties/save"
        templateHref="/api/admin/templates/parties.xlsx"
        successText="सूची सेव हो गई"
        saveExplain={(p) => `${p.toInsert.length} नई पार्टियाँ सूची में जुड़ेंगी।`}
        onSaved={reload}
        askPassword={false}
        renderPreview={(p) => (
          <>
            <p className="big">
              नई पार्टियाँ: {p.toInsert.length} · पहले से मौजूद: {p.unchanged.length}
            </p>
            {p.toInsert.length > 0 && (
              <table className="list">
                <thead>
                  <tr>
                    <th>छोटा नाम</th>
                    <th>हिंदी नाम</th>
                    <th>अंग्रेज़ी नाम</th>
                    <th>चुनाव चिह्न</th>
                  </tr>
                </thead>
                <tbody>
                  {p.toInsert.map((x) => (
                    <tr key={x.shortName}>
                      <td>{x.shortName}</td>
                      <td>{x.nameHindi}</td>
                      <td>{x.nameEnglish}</td>
                      <td>{x.symbol}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      />

      <Section title="एक पार्टी जोड़ें">
        <div className="form-grid">
          {field('nameHindi', 'हिंदी नाम')}
          {field('nameEnglish', 'अंग्रेज़ी नाम')}
          {field('shortName', 'छोटा नाम (जैसे BJP)')}
          {field('symbol', 'चुनाव चिह्न')}
        </div>
        <IssueList title="पार्टी नहीं जुड़ी" issues={issues} />
        <SuccessBox text={added} />
        <ErrorBox error={addError} />
        <button
          type="button"
          className="btn btn-secondary btn-big"
          disabled={!complete || adding}
          onClick={() => void add()}
        >
          {adding ? 'जुड़ रही है…' : 'पार्टी जोड़ें'}
        </button>
      </Section>

      <Section title={`सूची में पार्टियाँ (${data?.parties.length ?? 0})`}>
        <ErrorBox error={error} />
        {data && data.parties.length > 0 && (
          <table className="list" data-testid="party-list">
            <thead>
              <tr>
                <th>छोटा नाम</th>
                <th>हिंदी नाम</th>
                <th>अंग्रेज़ी नाम</th>
                <th>चुनाव चिह्न</th>
              </tr>
            </thead>
            <tbody>
              {data.parties.map((p) => (
                <tr key={p.id}>
                  <td>{p.short_name}</td>
                  <td>{p.name_hindi}</td>
                  <td>{p.name_english}</td>
                  <td>{p.symbol}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </>
  );
}
