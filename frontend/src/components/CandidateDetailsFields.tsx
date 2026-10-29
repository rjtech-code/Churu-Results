import { useState } from 'react';
import {
  CANDIDATE_CATEGORIES,
  EDUCATION_HINDI,
  MAX_ADDRESS_LENGTH,
  MAX_OCCUPATION_LENGTH,
} from '../api/adminTypes';
import '../styles/candidates.css';
import type { CandidateCategory, CandidateDetails, Education } from '../api/adminTypes';

const EDUCATIONS = Object.keys(EDUCATION_HINDI) as Education[];

/** "15/05/1980" from the stored YYYY-MM-DD (text already typed as DD/MM/YYYY stays as it is). */
const dmy = (dob: string) => (/^\d{4}-\d{2}-\d{2}$/.test(dob) ? dob.split('-').reverse().join('/') : dob);
/** What the server accepts as typed: D/M/YYYY with / . or - (it checks the real date and age). */
const DOB_TYPED = /^\d{1,2}[/.-]\d{1,2}[/.-]\d{4}$/;

/** Every optional detail filled (the "पूरी जानकारी" count). */
export function detailsComplete(d: CandidateDetails): boolean {
  return (
    (d.dob !== null || d.ageStated !== null) &&
    d.education !== null &&
    d.mobile !== null &&
    d.candidateCategory !== null &&
    d.address !== null &&
    d.occupation !== null
  );
}

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

/** A free-text detail input (address, occupation): empty = null. */
function TextDetail({
  id,
  label,
  ariaLabel,
  value,
  maxLength,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  ariaLabel: string;
  value: string | null;
  maxLength: number;
  disabled: boolean;
  onChange: (value: string | null) => void;
}) {
  return (
    <span className="cd-field cd-wide">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        aria-label={ariaLabel}
        maxLength={maxLength}
        disabled={disabled}
        value={value ?? ''}
        onChange={(e) => {
          onChange(e.target.value === '' ? null : e.target.value);
        }}
      />
    </span>
  );
}

/**
 * Date of birth typed as DD/MM/YYYY (like the Excel import). While it is being typed the text is
 * kept as it is; the server reads DD/MM/YYYY or YYYY-MM-DD and checks the real date and the age.
 */
function DobField({
  id,
  ariaLabel,
  value,
  disabled,
  onChange,
}: {
  id: string;
  ariaLabel: string;
  value: string | null;
  disabled: boolean;
  onChange: (dob: string | null) => void;
}) {
  const [text, setText] = useState(() => (value === null ? '' : dmy(value)));
  const bad = text !== '' && !DOB_TYPED.test(text);
  return (
    <span className="cd-field cd-dob">
      <label htmlFor={id}>जन्म तिथि</label>
      <input
        id={id}
        aria-label={ariaLabel}
        aria-invalid={bad}
        inputMode="numeric"
        placeholder="DD/MM/YYYY"
        maxLength={10}
        disabled={disabled}
        value={text}
        onChange={(e) => {
          const t = e.target.value.replace(/[^\d/.-]/g, '');
          setText(t);
          onChange(t === '' ? null : t);
        }}
      />
      {bad && <span className="cd-err">DD/MM/YYYY में लिखें</span>}
    </span>
  );
}

/**
 * The optional candidate details: date of birth OR age, education (9 values), mobile, the
 * candidate's own category (GEN/SC/ST/OBC), address and occupation. All may stay empty. The
 * server checks every value (Hindi message on a mistake).
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
    <div className="cd-grid">
      <DobField
        id={`${idPrefix}-dob`}
        ariaLabel={`${label} जन्म तिथि`}
        value={value.dob}
        disabled={disabled}
        onChange={(dob) => {
          onChange({ dob, ageStated: null });
        }}
      />
      <span className="cd-field cd-age">
        <label htmlFor={`${idPrefix}-age`}>या उम्र</label>
        <input
          id={`${idPrefix}-age`}
          aria-label={`${label} उम्र`}
          inputMode="numeric"
          disabled={disabled || value.dob !== null}
          value={value.ageStated === null ? '' : String(value.ageStated)}
          onChange={(e) => {
            const t = e.target.value.replace(/\D/g, '').slice(0, 3);
            onChange({ ageStated: t === '' ? null : Number(t) });
          }}
        />
      </span>
      <span className="cd-field">
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
      <span className="cd-field">
        <label htmlFor={`${idPrefix}-mobile`}>मोबाइल</label>
        <input
          id={`${idPrefix}-mobile`}
          aria-label={`${label} मोबाइल`}
          inputMode="tel"
          maxLength={16}
          placeholder="10 अंक"
          disabled={disabled}
          value={value.mobile ?? ''}
          onChange={(e) => {
            onChange({ mobile: e.target.value === '' ? null : e.target.value });
          }}
        />
      </span>
      <span className="cd-field">
        <label htmlFor={`${idPrefix}-category`}>Category</label>
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
      <TextDetail
        id={`${idPrefix}-address`}
        label="पता"
        ariaLabel={`${label} पता`}
        value={value.address}
        maxLength={MAX_ADDRESS_LENGTH}
        disabled={disabled}
        onChange={(address) => {
          onChange({ address });
        }}
      />
      <TextDetail
        id={`${idPrefix}-occupation`}
        label="व्यवसाय"
        ariaLabel={`${label} व्यवसाय`}
        value={value.occupation}
        maxLength={MAX_OCCUPATION_LENGTH}
        disabled={disabled}
        onChange={(occupation) => {
          onChange({ occupation });
        }}
      />
    </div>
  );
}
