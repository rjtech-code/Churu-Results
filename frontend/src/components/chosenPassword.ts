// Hints for a password the DM types for an RO. The SAME rules as the server
// (backend/src/services/master-data/accounts.ts, checkChosenPassword); the server decides, this
// only explains on screen, in the same Hindi words, before the DM presses the button.
import { ERROR_MESSAGES } from '../api/errors';

export type ChosenPasswordProblem =
  | 'PASSWORD_TOO_SHORT'
  | 'PASSWORD_TOO_LONG'
  | 'PASSWORD_NEEDS_LETTER_AND_DIGIT'
  | 'PASSWORD_HAS_USERNAME'
  | 'PASSWORD_TOO_COMMON'
  | 'PASSWORD_MISMATCH';

const WEAK_PASSWORDS = new Set([
  'password',
  'passwd',
  'pass',
  'admin',
  'administrator',
  'churu',
  'churu2026',
  'chunav',
  'chunav2026',
  'election',
  'election2026',
  'nirvachan',
  'rajasthan',
  'india',
  'bharat',
  'welcome',
  'qwerty',
  'qwertyuiop',
  'asdf',
  'asdfgh',
  'abcd',
  'abc',
  'abcdef',
  'letmein',
  'test',
  'user',
  'login',
  'dm',
  'ro',
  'iloveyou',
  'secret',
  '123456',
  '1234567890',
]);

const LEET: Readonly<Record<string, string>> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '@': 'a',
  $: 's',
  '!': 'i',
};

export function isWeakPassword(password: string): boolean {
  const lower = password.toLowerCase();
  const swap = (t: string) => t.replace(/[01345@$!]/g, (ch) => LEET[ch] ?? ch);
  const lettersOnlyEdges = (t: string) => t.replace(/^[^a-z]+|[^a-z]+$/g, '');
  const core = lower.replace(/^[\d\W_]+|[\d\W_]+$/g, '');
  const variants = [lower, lettersOnlyEdges(lower), swap(core), swap(lower), lettersOnlyEdges(swap(lower))];
  return variants.some((v) => v !== '' && WEAK_PASSWORDS.has(v));
}

export function chosenPasswordProblems(
  password: string,
  confirm: string,
  username: string,
): ChosenPasswordProblem[] {
  const problems: ChosenPasswordProblem[] = [];
  if (password.length < 10) problems.push('PASSWORD_TOO_SHORT');
  if (password.length > 128) problems.push('PASSWORD_TOO_LONG');
  if (!/\p{L}/u.test(password) || !/\p{Nd}/u.test(password)) problems.push('PASSWORD_NEEDS_LETTER_AND_DIGIT');
  if (username !== '' && password.toLowerCase().includes(username.toLowerCase()))
    problems.push('PASSWORD_HAS_USERNAME');
  if (isWeakPassword(password)) problems.push('PASSWORD_TOO_COMMON');
  if (password !== confirm) problems.push('PASSWORD_MISMATCH');
  return problems;
}

export function problemText(p: ChosenPasswordProblem): string {
  const m = ERROR_MESSAGES[p];
  return typeof m === 'string' ? m : p;
}
