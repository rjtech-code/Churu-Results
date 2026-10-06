// Reasons for edit, void, postal edit and correction: a standard reason plus details.
// The text sent to the API is "<reason> — <details>" (or the reason alone) and must stay 10-500 chars.
import { useId } from 'react';

export const REASON_MIN = 10;
export const REASON_MAX = 500;
export const OTHER_REASON = 'अन्य';
export const STANDARD_REASONS = [
  'पर्ची पढ़ने में गलती',
  'टाइपिंग में गलती',
  'गलत बूथ चुना गया',
  'पर्ची बाद में संशोधित हुई',
  OTHER_REASON,
] as const;
const SEPARATOR = ' — ';

export interface ReasonValue {
  choice: string;
  details: string;
}
export const emptyReason: ReasonValue = { choice: '', details: '' };

/** The text sent to the API. */
export function reasonText(v: ReasonValue): string {
  const details = v.details.trim();
  return details === '' ? v.choice : `${v.choice}${SEPARATOR}${details}`;
}

/** Longest details that keep the whole text within REASON_MAX. */
export function detailsMax(choice: string): number {
  return REASON_MAX - (choice === '' ? 0 : choice.length + SEPARATOR.length);
}

export function reasonProblem(v: ReasonValue): string | null {
  if (v.choice === '') return 'कारण चुनें (सूची से)';
  const details = v.details.trim();
  if (v.choice === OTHER_REASON && details.length < REASON_MIN) {
    return `"${OTHER_REASON}" चुनने पर कारण का विवरण कम से कम ${REASON_MIN} अक्षर का लिखें`;
  }
  const len = reasonText(v).length;
  if (len < REASON_MIN) return `कारण कम से कम ${REASON_MIN} अक्षर का होना चाहिए — विवरण जोड़ें`;
  if (len > REASON_MAX) return `कारण (विवरण सहित) ${REASON_MAX} अक्षर से अधिक नहीं`;
  return null;
}

export function ReasonField({
  id,
  value,
  onChange,
  label = 'कारण (अनिवार्य)',
}: {
  id: string;
  value: ReasonValue;
  onChange: (v: ReasonValue) => void;
  label?: string;
}) {
  const detailsId = useId();
  const other = value.choice === OTHER_REASON;
  return (
    <div className="field reason-field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={value.choice}
        onChange={(e) => {
          onChange({ ...value, choice: e.target.value });
        }}
      >
        <option value="">— कारण चुनें —</option>
        {STANDARD_REASONS.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      <label htmlFor={detailsId}>{other ? 'विवरण (अनिवार्य, कम से कम 10 अक्षर)' : 'विवरण (वैकल्पिक)'}</label>
      <textarea
        id={detailsId}
        rows={2}
        maxLength={detailsMax(value.choice)}
        value={value.details}
        onChange={(e) => {
          onChange({ ...value, details: e.target.value });
        }}
      />
      <small>
        {reasonText(value).length}/{REASON_MAX}
      </small>
    </div>
  );
}
