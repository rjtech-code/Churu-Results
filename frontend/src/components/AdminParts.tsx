// Small building blocks of the Part 13 pages (DM tools and the RO's candidate lists): one heading
// and one line of instruction per page, numbered steps, Hindi problem lists, status badges, and the
// one-time password box.
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { LIST_STATUS_HINDI } from '../api/adminTypes';
import type { Issue, ListStatus } from '../api/adminTypes';
import { ApiError } from '../api/api';

/** Short Hindi heading and one line saying what to do here. */
export function PageIntro({ title, hint }: { title: string; hint: string }) {
  return (
    <>
      <h1>{title}</h1>
      <p className="page-hint">{hint}</p>
    </>
  );
}

/** "1 फ़ाइल चुनें → 2 जाँच → 3 पूर्वावलोकन → 4 सेव", with the current step highlighted. */
export function StepBar({ steps, current }: { steps: readonly string[]; current: number }) {
  return (
    <ol className="steps" aria-label="चरण">
      {steps.map((label, i) => {
        const state = i < current ? 'done' : i === current ? 'current' : 'todo';
        return (
          <li key={label} className="step-item" aria-current={state === 'current' ? 'step' : undefined}>
            {i > 0 && (
              <span className="step-arrow" aria-hidden="true">
                →
              </span>
            )}
            <span className={`step step-${state}`}>
              <span className="step-no">{state === 'done' ? '✓' : i + 1}</span> {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Problems in red (each says what is wrong and how to fix it); warnings in amber. */
export function IssueList({
  title,
  issues,
  kind = 'error',
}: {
  title: string;
  issues: readonly Issue[];
  kind?: 'error' | 'warn';
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (kind === 'error' && issues.length > 0) ref.current?.focus();
  }, [issues, kind]);
  if (issues.length === 0) return null;
  return (
    <div
      ref={ref}
      tabIndex={-1}
      className={`issues ${kind === 'error' ? 'issues-error' : 'issues-warn'}`}
      role={kind === 'error' ? 'alert' : 'status'}
      data-testid={kind === 'error' ? 'issue-errors' : 'issue-warnings'}
    >
      <h2>
        {kind === 'error' ? '✗' : '!'} {title} ({issues.length})
      </h2>
      <ul>
        {issues.map((issue, i) => (
          <li key={i}>{issue.message}</li>
        ))}
      </ul>
    </div>
  );
}

/** The Hindi problem list inside a CHECK_FAILED answer (save re-checks everything). */
export function issuesOf(err: unknown): Issue[] | null {
  if (!(err instanceof ApiError) || err.code !== 'CHECK_FAILED') return null;
  const list = err.details.errors;
  return Array.isArray(list) ? (list as Issue[]) : null;
}

export function ListStatusBadge({ status }: { status: ListStatus }) {
  return <span className={`badge badge-list-${status.toLowerCase()}`}>{LIST_STATUS_HINDI[status]}</span>;
}

/**
 * A new password, shown once in large letters. "प्रिंट करें" prints only this box. The password
 * lives only in this component's props: it is never stored in the browser.
 */
export function OneTimePassword({
  username,
  password,
  onDone,
}: {
  username: string;
  password: string;
  onDone: () => void;
}) {
  const print = () => {
    document.body.classList.add('print-otp');
    window.print();
    document.body.classList.remove('print-otp');
  };
  const groups = password.match(/.{1,4}/g) ?? [password];
  return (
    <section className="otp-box" aria-label="नया पासवर्ड" data-testid="otp-box">
      <p className="otp-line">
        यूज़रनेम: <strong data-testid="otp-username">{username}</strong>
      </p>
      <p className="otp-line">
        पासवर्ड:{' '}
        <strong className="otp-password" data-testid="otp-password" data-password={password}>
          {groups.join(' ')}
        </strong>
      </p>
      <p className="msg msg-warn">
        ! यह पासवर्ड दोबारा नहीं दिखेगा। इसे अभी लिखें या प्रिंट करें और अधिकारी को स्वयं दें।
      </p>
      <div className="actions no-print">
        <button type="button" className="btn btn-secondary" onClick={print}>
          प्रिंट करें
        </button>
        <button type="button" className="btn btn-primary" onClick={onDone}>
          हो गया
        </button>
      </div>
    </section>
  );
}

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** The file's bytes as base64 (no data: URLs anywhere). */
export async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** Checks done in the browser before upload (the server checks everything again). */
export function fileProblem(file: File): string | null {
  if (!file.name.toLowerCase().endsWith('.xlsx')) return 'यह Excel (.xlsx) फ़ाइल नहीं है — सही फ़ाइल चुनें';
  if (file.size > MAX_UPLOAD_BYTES) return 'फ़ाइल 5 MB से बड़ी है — सही फ़ाइल चुनें';
  if (file.size === 0) return 'फ़ाइल खाली है — सही फ़ाइल चुनें';
  return null;
}

/** A labelled section with a heading (keeps pages uniform). */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="admin-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
