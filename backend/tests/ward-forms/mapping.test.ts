// Pure mapping of the official ward forms: numbers only from the result engine, blanks (null) for
// anything the system does not have, never a guess.
import { describe, expect, it } from 'vitest';
import { mapPart2 } from '../../src/services/ward-forms/map-part2.js';
import { mapPrarup7 } from '../../src/services/ward-forms/map-prarup7.js';
import { PART2 } from '../../src/services/ward-forms/templates/part2.template.js';
import { RULE_NUMBER_BLANK } from '../../src/services/ward-forms/templates/prarup7-levels.js';
import { NOTA_VOTES, PS_BODY, formSource, prarup7For, votesFor } from './source.js';

const T = prarup7For('ZP');
const PS = prarup7For('PS');

describe('Part-II mapping', () => {
  it('lists candidates in ballot order with the engine votes, then NOTA and the engine total', () => {
    const src = formSource({ candidates: 3 });
    expect(mapPart2(src, PART2)).toEqual({
      rows: [
        { serial: '1.', name: 'उम्मीदवार 1', votes: String(votesFor(1)) },
        { serial: '2.', name: 'उम्मीदवार 2', votes: String(votesFor(2)) },
        { serial: '3.', name: 'उम्मीदवार 3', votes: String(votesFor(3)) },
      ],
      nota: String(NOTA_VOTES),
      total: String(src.result.totalValidVotes),
    });
    expect(src.result.totalValidVotes).toBe(votesFor(1) + votesFor(2) + votesFor(3) + NOTA_VOTES);
  });
});

describe('Prarup-7 mapping', () => {
  it('fills the saved details, the party in brackets and the votes', () => {
    const d = mapPrarup7(
      formSource({
        reservation: 'सामान्य महिला',
        parties: ['इंडियन नेशनल कॉंग्रेस', null],
        details: [
          {
            address: 'ग्राम पोस्ट- साण्डन',
            candidateCategory: 'GEN',
            education: 'POST_GRADUATE',
            ageStated: 51,
            occupation: 'स्वयं का व्यवसाय',
          },
        ],
      }),
      T,
    );
    expect(d.wardNo).toBe('5');
    expect(d.reservation).toBe('(सामान्य महिला)');
    expect(d.contested).toBe(true);
    expect(d.rows[0]).toEqual({
      uncontested: null,
      contested: '1. उम्मीदवार 1\n(इंडियन नेशनल कॉंग्रेस)',
      particulars: {
        address: 'ग्राम पोस्ट- साण्डन',
        category: 'सामान्य',
        education: 'स्नातकोत्तर',
        age: '51',
        occupation: 'स्वयं का व्यवसाय',
        heldPanchSarpanch: null,
      },
      votes: String(votesFor(1)),
    });
    expect(d.rows[1]?.contested).toBe(`2. उम्मीदवार 2\n(${T.labels.independent})`);
  });

  it('leaves every unknown detail blank (null), never guessed', () => {
    const d = mapPrarup7(formSource({ reservation: 'अनुसूचित जाति', genders: ['O', 'M'] }), T);
    expect(d.rows[0]?.particulars).toEqual({
      address: null,
      category: null,
      education: null,
      age: null,
      occupation: null,
      heldPanchSarpanch: null,
    });
    // The seat is SC, but the winner's own category is not saved: blank, not inferred.
    expect(d.declaration.category).toBeNull();
    // Gender "O": the form offers only F/M.
    expect(d.declaration.gender).toBeNull();
  });

  it('column (च) is blank on every row, NOTA included', () => {
    const d = mapPrarup7(formSource({ candidates: 4 }), T);
    expect(d.rows).toHaveLength(5);
    for (const row of d.rows) expect(row.particulars.heldPanchSarpanch).toBeNull();
  });

  it('prints the NOTA row as on the form: its number, dashes in (क)-(ङ), the NOTA votes', () => {
    const d = mapPrarup7(formSource({ candidates: 2 }), T);
    expect(d.rows[2]).toEqual({
      uncontested: null,
      contested: `3. ${T.text.notaName}\n${T.text.notaNote}`,
      particulars: {
        address: T.text.none,
        category: T.text.none,
        education: T.text.none,
        age: T.text.none,
        occupation: T.text.none,
        heldPanchSarpanch: null,
      },
      votes: String(NOTA_VOTES),
    });
  });

  it('rejected votes once for the ward: blank when not recorded, 0 printed as 0', () => {
    expect(mapPrarup7(formSource({ rejected: 3 }), T).rejected).toBe('3');
    expect(mapPrarup7(formSource({ rejected: 0 }), T).rejected).toBe('0');
    expect(mapPrarup7(formSource({ rejected: null }), T).rejected).toBeNull();
  });

  it('the declaration names the engine winner with party and address, padded ward number', () => {
    const d = mapPrarup7(
      formSource({
        parties: ['भारतीय जनता पार्टी'],
        genders: ['F'],
        details: [{ address: 'अगुना बास', candidateCategory: 'OBC' }],
      }),
      T,
    );
    expect(d.declaration).toEqual({
      office: 'जिला परिषद, चूरू',
      nameAndAddress: ['उम्मीदवार 1', '(भारतीय जनता पार्टी)', 'अगुना बास'],
      gender: 'F',
      category: 'OBC',
    });
    expect(d.wardNoPadded).toBe('05');
  });

  it('header: district, ZP ward count, PS names, election date (blank until set)', () => {
    expect(mapPrarup7(formSource(), T).header).toEqual({
      bodyName: 'चूरू',
      wardCount: '39',
      panchayatSamitis: 'बीदासर, सुजानगढ़',
      district: 'चूरू',
      electionDate: null,
    });
    const set = mapPrarup7(formSource({ electionDate: '2026-11-20', panchayatSamitis: [] }), T);
    expect(set.header.electionDate).toBe('20.11.2026');
    expect(set.header.panchayatSamitis).toBeNull();
    expect(T.formats.date('2020-12-08')).toBe('08.12.2020');
  });

  it('uncontested: the winner in column 2, no NOTA row, vote and rejected columns blank', () => {
    const d = mapPrarup7(formSource({ unopposed: true, details: [{ address: 'पता' }] }), T);
    expect(d.contested).toBe(false);
    expect(d.rows).toHaveLength(1);
    expect(d.rows[0]).toMatchObject({
      uncontested: `1. उम्मीदवार 1\n(${T.labels.independent})`,
      contested: null,
      votes: null,
      particulars: { address: 'पता', heldPanchSarpanch: null },
    });
    expect(d.rejected).toBeNull();
    expect(d.declaration.nameAndAddress[0]).toBe('उम्मीदवार 1');
  });
});

/** Every printed word of a template (all strings of its text, nested lists included). */
function allText(v: unknown): string[] {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.flatMap(allText);
  if (typeof v === 'object' && v !== null) return Object.values(v).flatMap(allText);
  return [];
}

describe('Prarup-7 levels: one template, Zila Parishad and Panchayat Samiti words', () => {
  it('ZP keeps the printed wording, rule numbers and RO block', () => {
    expect(T.text.rules).toBe('(नियम 52, 59, 60, 61 देखिये)');
    expect(T.text.heading).toBe(
      'जिला परिषद् के सदस्य के पद के लिए निर्वाचन के परिणामों को दर्शित करने वाली विवरणी',
    );
    expect(T.text.columns.uncontested).toMatch(/^नियम 29\(2\) के अधीन/);
    expect(T.text.columns.lot).toBe('नियम 51 के अधीन लॉट का यदि कोई हो, परिणाम');
    expect(T.text.signature).toEqual([
      'रिटर्निंग अधिकारी',
      'जिला परिषद् निर्वाचन',
      '(जिला कलक्टर एवं जिला मजिस्ट्रेट)',
    ]);
    expect(mapPrarup7(formSource(), T).signaturePlace).toBe('चूरू');
  });

  it('PS: Panchayat Samiti words, rule numbers left as dots, no Zila Parishad wording anywhere', () => {
    expect(PS.text.heading).toBe(
      'पंचायत समिति के सदस्य के पद के लिए निर्वाचन के परिणामों को दर्शित करने वाली विवरणी',
    );
    expect(PS.text.office).toBe('पंचायत समिति के सदस्य');
    expect(PS.text.rules).toBe(`(नियम ${RULE_NUMBER_BLANK} देखिये)`);
    expect(PS.text.columns.uncontested).toMatch(new RegExp(`^नियम ${RULE_NUMBER_BLANK} के अधीन`));
    expect(PS.text.columns.lot).toMatch(new RegExp(`^नियम ${RULE_NUMBER_BLANK} के अधीन`));
    expect(PS.text.declarationColumns[1]).toBe('कार्यालय का नाम सदस्य, पंचायत समिति');
    expect(allText(PS.text).filter((t) => t.includes('परिषद'))).toEqual([]);
    expect(allText(PS.text).filter((t) => /\d{2}/.test(t))).toEqual([]);
  });

  it('PS header: its own name and its ward count; no "PS names of this ward" item', () => {
    const d = mapPrarup7(formSource({ kind: 'PS' }), PS);
    expect(PS.text.header.map((h) => [h.label, h.value])).toEqual([
      ['पंचायत समिति :-', 'bodyName'],
      ['कुल निर्वाचन मण्डल :-', 'wardCount'],
      ['जिला :-', 'district'],
      ['निर्वाचन की तारीख :-', 'electionDate'],
    ]);
    expect(d.header).toMatchObject({
      bodyName: PS_BODY.name,
      wardCount: String(PS_BODY.wardCount),
      district: 'चूरू',
    });
  });

  it('PS declaration: the PS office; the RO designation and place left blank', () => {
    const d = mapPrarup7(formSource({ kind: 'PS' }), PS);
    expect(d.declaration.office).toBe(`पंचायत समिति, ${PS_BODY.name}`);
    expect(d.signaturePlace).toBeNull();
    expect(PS.text.signature).toEqual(['रिटर्निंग अधिकारी', 'पंचायत समिति निर्वाचन', '']);
  });

  it('PS keeps the shared rules: column (च) blank, uncontested layout', () => {
    for (const row of mapPrarup7(formSource({ kind: 'PS', candidates: 3 }), PS).rows) {
      expect(row.particulars.heldPanchSarpanch).toBeNull();
    }
    const u = mapPrarup7(formSource({ kind: 'PS', unopposed: true }), PS);
    expect([u.contested, u.rows.length, u.rejected, u.rows[0]?.votes]).toEqual([
      false,
      1,
      null,
      null,
    ]);
  });
});
