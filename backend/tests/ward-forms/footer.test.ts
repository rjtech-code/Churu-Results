// Prarup-7 footer (Nov 2026): rule numbers, स्थान / दिनांक from the single date source, the RO's
// name, and a fixed band for the handwritten signature. No database.
import { describe, expect, it } from 'vitest';
import { roNameFor } from '../../src/modules/reports/ward-forms.routes.js';
import { openPage } from '../../src/services/pdf/document.js';
import { mapPrarup7 } from '../../src/services/ward-forms/map-prarup7.js';
import { prarup7Parts, renderPrarup7 } from '../../src/services/ward-forms/render-prarup7.js';
import { ZP_LEVEL } from '../../src/services/ward-forms/templates/prarup7-levels.js';
import type { AuthUser } from '../../src/types/auth.js';
import { formSource, pageCount, prarup7For } from './source.js';

const MM = 72 / 25.4;
const user = (role: AuthUser['role'], fullName: string | null): AuthUser => ({
  id: 1,
  username: 'ro_login_name',
  fullName,
  role,
  panchayatSamitiId: null,
  panchayatSamitiName: null,
});

describe('Prarup-7 rule numbers', () => {
  it('PS header blank has 52, 59, 60, 61; ZP unchanged', () => {
    expect(prarup7For('PS').text.rules).toBe('(नियम 52, 59, 60, 61 देखिये)');
    expect(prarup7For('ZP').text.rules).toBe('(नियम 52, 59, 60, 61 देखिये)');
    expect(ZP_LEVEL.rules).toEqual({ form: '52, 59, 60, 61', uncontested: '29(2)', lot: '51' });
  });
});

describe('Prarup-7 footer data', () => {
  it.each(['PS', 'ZP'] as const)(
    '%s: स्थान = the district, दिनांक = the header election date (same source, same format)',
    (kind) => {
      const t = prarup7For(kind);
      const d = mapPrarup7(formSource({ kind, electionDate: '2026-11-20' }), t, 'श्री रामलाल');
      expect(d.place).toBe('चूरू');
      expect(d.date).toBe('20.11.2026');
      expect(d.date).toBe(d.header.electionDate);
      expect(d.roName).toBe('श्री रामलाल');
      expect([t.text.place, t.text.date]).toEqual(['स्थान :', 'दिनांक :']);
    },
  );

  it('no election date set: दिनांक stays blank (never a made-up date)', () => {
    const d = mapPrarup7(formSource({ electionDate: null }), prarup7For('ZP'), null);
    expect([d.date, d.header.electionDate]).toEqual([null, null]);
  });

  it('missing or empty RO name: a blank line (null), extra spaces collapsed', () => {
    const t = prarup7For('PS');
    for (const name of [null, '', '   ']) {
      expect(mapPrarup7(formSource({ kind: 'PS' }), t, name).roName).toBeNull();
    }
    expect(mapPrarup7(formSource({ kind: 'PS' }), t, '  श्री   रामलाल ').roName).toBe(
      'श्री रामलाल',
    );
  });

  it('the route: an RO download prints the RO full name (never the username); a DM download leaves it blank', () => {
    expect(roNameFor(user('PS_RO', 'श्री रामलाल'))).toBe('श्री रामलाल');
    expect(roNameFor(user('ZP_RO', 'श्रीमती सुनीता'))).toBe('श्रीमती सुनीता');
    expect(roNameFor(user('PS_RO', null))).toBeNull();
    expect(roNameFor(user('DM', 'जिला कलक्टर'))).toBeNull();
  });
});

describe('Prarup-7 footer layout', () => {
  it('signature band of 18-22 mm, never shrunk by the fit steps; the footer is the last block', async () => {
    for (const kind of ['PS', 'ZP'] as const) {
      const t = prarup7For(kind);
      expect(t.signatureSpace).toBeGreaterThanOrEqual(18 * MM);
      expect(t.signatureSpace).toBeLessThanOrEqual(22 * MM);
      const d = mapPrarup7(formSource({ kind }), t, 'श्री रामलाल');
      const page = await openPage(t.page, t.latin, t.title);
      for (const step of t.fitSteps) {
        const [, second] = prarup7Parts(d, t, page, step);
        const footer = second.at(-1);
        // The band plus at least the five officer lines.
        expect(footer?.height ?? 0).toBeGreaterThan(
          t.signatureSpace + 5 * t.style.footer.size * 0.5,
        );
      }
    }
  });

  it.each(['PS', 'ZP'] as const)(
    '%s: a very long RO name wraps; the form stays on its pages',
    async (kind) => {
      const t = prarup7For(kind);
      const long = 'श्री राजेन्द्र कुमार शर्मा उपखण्ड अधिकारी एवं रिटर्निंग अधिकारी '.repeat(6);
      const short = mapPrarup7(formSource({ kind }), t, 'नाम');
      const wrapped = mapPrarup7(formSource({ kind }), t, long);
      const page = await openPage(t.page, t.latin, t.title);
      const step = t.fitSteps[0] ?? { spacing: 1, font: 1 };
      const h = (d: typeof short) => prarup7Parts(d, t, page, step)[1].at(-1)?.height ?? 0;
      expect(h(wrapped)).toBeGreaterThan(h(short)); // more lines, not wider
      expect(pageCount(await renderPrarup7(wrapped, t))).toBe(1);
    },
  );

  it('candidate rows and votes are unchanged by the RO name', () => {
    const t = prarup7For('ZP');
    const src = formSource({ candidates: 5 });
    const a = mapPrarup7(src, t, null);
    const b = mapPrarup7(src, t, 'श्री रामलाल');
    expect(b.rows).toEqual(a.rows);
    expect(b.rejected).toBe(a.rejected);
    expect(b.declaration).toEqual(a.declaration);
  });
});
