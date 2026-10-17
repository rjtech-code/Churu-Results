import { CANDIDATE_CATEGORIES, EDUCATION_HINDI } from '../api/adminTypes';
import type { CandidateCategory, CandidateDetails, Education } from '../api/adminTypes';

const EDUCATIONS = Object.keys(EDUCATION_HINDI) as Education[];

/** "15/05/1980" from the stored YYYY-MM-DD. */
const dmy = (iso: string) => iso.split('-').reverse().join('/');

/** One line for a list: "जन्म 15/05/1980 · स्नातक · 98765 43210", or "—". */
export function detailsSummary(d: CandidateDetails): string {
  const parts = [
    d.dob !== null ? `जन्म ${dmy(d.dob)}` : d.ageStated !== null ? `उम्र ${String(d.ageStated)}` : null,
    d.education !== null ? EDUCATION_HINDI[d.education] : null,
    d.mobile,
    d.candidateCategory,
  ].filter((p) => p !== null);
  return parts.length === 0 ? '—' : parts.join(' · ');
}

/**
 * The optional candidate details: date of birth OR age, education (9 values), mobile, the
 * candidate's own category (GEN/SC/ST/OBC). All may stay
 * empty. The server checks every value (Hindi message on a mistake).
 */
export function CandidateDetailsFields({
  idPrefix,
  label,
  value,
  disabled = false,
  onChange,
}: {
  idPrefix: string;
  /** Accessible name prefix, e.g. "पंक्ति 2". */
  label: string;
  value: CandidateDetails;
  disabled?: boolean;
  onChange: (patch: Partial<CandidateDetails>) => void;
}) {
  return (
    <div className="cand-details">
      <span className="field-inline">
        <label htmlFor={`${idPrefix}-dob`}>जन्म तिथि</label>
        <input
          id={`${idPrefix}-dob`}
          aria-label={`${label} जन्म तिथि`}
          type="date"
          disabled={disabled}
          value={value.dob ?? ''}
          onChange={(e) => {
            onChange({ dob: e.target.value === '' ? null : e.target.value, ageStated: null });
          }}
        />
      </span>
      <span className="field-inline">
        <label htmlFor={`${idPrefix}-age`}>या उम्र</label>
        <input
          id={`${idPrefix}-age`}
          aria-label={`${label} उम्र`}
          className="num num-small"
          inputMode="numeric"
          disabled={disabled || value.dob !== null}
          value={value.ageStated === null ? '' : String(value.ageStated)}
          onChange={(e) => {
            const t = e.target.value.replace(/\D/g, '').slice(0, 3);
            onChange({ ageStated: t === '' ? null : Number(t) });
          }}
        />
      </span>
      <span className="field-inline">
        <label htmlFor={`${idPrefix}-edu`}>शिक्षा</label>
        <select
          id={`${idPrefix}-edu`}
          aria-label={`${label} शिक्षा`}
          disabled={disabled}
          value={value.education ?? ''}
          onChange={(e) => {
            onChange({ education: e.target.value === '' ? null : (e.target.value as Education) });
          }}
        >
          <option value="">— चुनें —</option>
          {EDUCATIONS.map((ed) => (
            <option key={ed} value={ed}>
              {EDUCATION_HINDI[ed]}
            </option>
          ))}
        </select>
      </span>
      <span className="field-inline">
        <label htmlFor={`${idPrefix}-mobile`}>मोबाइल</label>
        <input
          id={`${idPrefix}-mobile`}
          aria-label={`${label} मोबाइल`}
          inputMode="tel"
          maxLength={16}
          disabled={disabled}
          value={value.mobile ?? ''}
          onChange={(e) => {
            onChange({ mobile: e.target.value === '' ? null : e.target.value });
          }}
        />
      </span>
      <span className="field-inline">
        <label htmlFor={`${idPrefix}-category`}>Category / श्रेणी</label>
        <select
          id={`${idPrefix}-category`}
          aria-label={`${label} Category`}
          disabled={disabled}
          value={value.candidateCategory ?? ''}
          onChange={(e) => {
            onChange({
              candidateCategory: e.target.value === '' ? null : (e.target.value as CandidateCategory),
            });
          }}
        >
          <option value="">— चुनें —</option>
          {CANDIDATE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </span>
    </div>
  );
}
