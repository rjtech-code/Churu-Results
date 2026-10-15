// The SAME cleaning rule as the server (backend/src/services/master-data/accounts.ts, normalizePhone):
// spaces, - and a +91 / 91 / 0 prefix go; 10 digits starting 6-9 remain. The server decides.
export const PHONE_ERROR = 'कृपया 10 अंकों का सही मोबाइल नंबर लिखें';

export function normalizePhone(raw: string): string | null {
  let t = raw.replace(/[\s\-().]/g, '');
  if (t.startsWith('+91')) t = t.slice(3);
  else if (/^91\d{10}$/.test(t)) t = t.slice(2);
  else if (/^0\d{10}$/.test(t)) t = t.slice(1);
  return /^[6-9]\d{9}$/.test(t) ? t : null;
}
