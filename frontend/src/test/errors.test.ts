import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/api';
import { ERROR_MESSAGES, messageFor } from '../api/errors';

const repo = resolve(import.meta.dirname, '../../..');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : [];
  });
}

/** Every error code the backend can put in {"error": ...}. */
function backendCodes(): Set<string> {
  const codes = new Set<string>();
  for (const file of files(join(repo, 'backend', 'src'))) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/ApiError\(\s*\d+\s*,\s*'([^']+)'/g)) codes.add(m[1] ?? '');
    for (const m of text.matchAll(/error:\s*'([^']+)'/g)) codes.add(m[1] ?? '');
    for (const m of text.matchAll(/error:\s*status === 413 \? '([^']+)' : '([^']+)'/g)) {
      codes.add(m[1] ?? '');
      codes.add(m[2] ?? '');
    }
  }
  return codes;
}

/** Every code listed in the README error-code tables. */
function readmeCodes(): Set<string> {
  const readme = readFileSync(join(repo, 'README.md'), 'utf8');
  const codes = new Set<string>();
  for (const table of readme.split(/\n\n/).filter((block) => /^\| Code \|/m.test(block))) {
    for (const m of table.matchAll(/^\| `([A-Z_]+)`/gm)) codes.add(m[1] ?? '');
  }
  return codes;
}

describe('error code table', () => {
  it('has a Hindi message for every error code the backend source can send', () => {
    const codes = backendCodes();
    expect(codes.size).toBeGreaterThan(30);
    const missing = [...codes].filter((c) => !(c in ERROR_MESSAGES));
    expect(missing).toEqual([]);
  });

  it('has a Hindi message for every code in the README error tables', () => {
    const codes = readmeCodes();
    expect(codes.size).toBeGreaterThan(30);
    expect([...codes].filter((c) => !(c in ERROR_MESSAGES))).toEqual([]);
  });

  it('fills in details (sum/sheet total, minutes left) and handles unknown codes', () => {
    expect(messageFor(new ApiError(400, 'SUM_MISMATCH', { sum: 9, sheetTotal: 10 }))).toBe(
      'मतों का जोड़ (9) पर्ची के योग (10) से मेल नहीं खाता',
    );
    expect(messageFor(new ApiError(423, 'ACCOUNT_LOCKED', { retryAfterSeconds: 61 }))).toContain('2 मिनट');
    expect(messageFor(new ApiError(500, 'SOMETHING_NEW', {}))).toBe('कुछ गड़बड़ हुई (SOMETHING_NEW)');
    expect(messageFor(new Error('x'))).toBe('कुछ गड़बड़ हुई');
  });
});
