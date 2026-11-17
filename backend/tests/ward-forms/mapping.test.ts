// Pure mapping of the official ward forms: numbers only from the result engine, blanks (null) for
// anything the system does not have, never a guess.
import { describe, expect, it } from 'vitest';
import { mapPart2 } from '../../src/services/ward-forms/map-part2.js';
import { mapBlankPrarup7, mapPrarup7 } from '../../src/services/ward-forms/map-prarup7.js';
import { PART2 } from '../../src/services/ward-forms/templates/part2.template.js';
import { RULE_NUMBER_BLANK } from '../../src/services/ward-forms/templates/prarup7-levels.js';
import { NOTA_VOTES, PS_BODY, formSource, prarup7For, votesFor } from './source.js';

const T = prarup7For('ZP');
const PS = prarup7For('PS');

describe('Part-II (प्रारूप–14) ward sheet mapping', () => {
  it('lists candidates in ballot order with the engine votes, then NOTA and the engine total', () => {
    const src = formSource({ candidates: 3, electionDate: '2026-11-20' });
    expect(mapPart2(src, PART2)).toEqual({
      kind: 'ZP',
      bodyName: 'चूरू',
      wardNo: '05',
      booth: null,
      rows: [
        { serial: '1', name: 'उम्मीदवार 1', votes: String(votesFor(1)) },
        { serial: '2', name: 'उम्मीदवार 2', votes: String(votesFor(2)) },
        { serial: '3', name: 'उम्मीदवार 3', votes: String(votesFor(3)) },
      ],
      notaSerial: '4',
      nota: String(NOTA_VOTES),
      total: String(src.result.totalValidVotes),
      date: '20.11.2026',
      place: 'चूरू',
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

  it('column (च): हाँ, नहीं, and BLANK when it was never recorded — on both forms, NOTA always blank', () => {
    const details = [
      { heldPanchSarpanch: 'YES' as const },
      { heldPanchSarpanch: 'NO' as const },
      {},
    ];
    for (const t of [T, PS]) {
      const d = mapPrarup7(formSource({ kind: t === PS ? 'PS' : 'ZP', candidates: 3, details }), t);
      expect(d.rows.map((r) => r.particulars.heldPanchSarpanch)).toEqual([
        'हाँ',
        'नहीं',
        // not recorded, and the NOTA row
        null,
        null,
      ]);
    }
  });

  it('column (च) is never guessed: a candidate without the detail prints nothing, not "नहीं"', () => {
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
    // The signed block: the officer's name, their designation, the office, then the body.
    expect(T.text.signature).toEqual([
      '{ro}',
      '(जिला कलक्टर एवं जिला मजिस्ट्रेट)',
      'रिटर्निंग अधिकारी',
      'जिला परिषद {name}',
    ]);
  });

  it('PS: Panchayat Samiti words, the form rule numbers, column rules left as dots, no Zila Parishad wording anywhere', () => {
    expect(PS.text.heading).toBe(
      'पंचायत समिति के सदस्य के पद के लिए निर्वाचन के परिणामों को दर्शित करने वाली विवरणी',
    );
    expect(PS.text.office).toBe('पंचायत समिति के सदस्य');
    // The header blank carries the rule numbers (DEO instruction, Nov 2026), as on the ZP form.
    expect(PS.text.rules).toBe('(नियम 52, 59, 60, 61 देखिये)');
    // The two column rules are the same at both levels (officers' instruction, Nov 2026).
    expect(PS.text.columns.uncontested).toMatch(/^नियम 29\(2\) के अधीन/);
    expect(PS.text.columns.lot).toBe('नियम 51 के अधीन लॉट का यदि कोई हो, परिणाम');
    // Nothing is left for hand filling any more.
    expect(allText(PS.text).filter((t) => t.includes(RULE_NUMBER_BLANK))).toEqual([]);
    expect(PS.text.declarationColumns[1]).toBe('कार्यालय का नाम सदस्य, पंचायत समिति');
    expect(allText(PS.text).filter((t) => t.includes('परिषद'))).toEqual([]);
    // The only printed numbers are the three rule numbers; nothing else carries a figure.
    expect(allText(PS.text).filter((t) => /\d{2}/.test(t))).toEqual([
      PS.text.rules,
      PS.text.columns.uncontested,
      PS.text.columns.lot,
    ]);
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
    // No designation line at this level: name, office, Panchayat Samiti.
    expect(PS.text.signature).toEqual(['{ro}', 'रिटर्निंग अधिकारी', 'पंचायत समिति {name}']);
  });

  it('PS keeps the shared rules: column (च) blank when not recorded, uncontested layout', () => {
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

/**
 * The BLANK प्ररूप–7: the same sheet with every counting RESULT left empty. These tests name each
 * cell, so what is printed and what is left to the pen can be checked against the officers' list.
 */
describe('the blank प्ररूप–7', () => {
  const src = () =>
    formSource({
      candidates: 3,
      electionDate: '2026-11-20',
      reservation: 'सामान्य महिला',
      details: [{ address: 'ग्राम साण्डन', occupation: 'कृषि', heldPanchSarpanch: 'YES' }, {}, {}],
    });

  it('keeps every fixed fact exactly as the filled form prints it', () => {
    const filled = mapPrarup7(src(), T, 'ताराचन्द मीणा (RTS)');
    const blank = mapBlankPrarup7(src(), T, 'ताराचन्द मीणा (RTS)');
    // Headings' values, ward, body, date, place, the RO's name, the ward number and reservation.
    expect(blank.header).toEqual(filled.header);
    expect([blank.place, blank.date, blank.roName]).toEqual([
      filled.place,
      filled.date,
      filled.roName,
    ]);
    expect([blank.wardNo, blank.reservation, blank.wardNoPadded]).toEqual([
      filled.wardNo,
      filled.reservation,
      filled.wardNoPadded,
    ]);
    // The ballot: the same candidates in the same order, with the same particulars.
    expect(blank.rows.map((r) => r.contested)).toEqual(filled.rows.map((r) => r.contested));
    expect(blank.rows.map((r) => r.particulars)).toEqual(filled.rows.map((r) => r.particulars));
    // The NOTA row is part of the ballot, so it is printed too.
    expect(blank.rows).toHaveLength(4);
    expect(blank.rows.at(-1)?.contested).toContain('नोटा');
    // The declaration's own line ("कार्यालय का नाम सदस्य, …") is template text, not a result.
    expect(blank.declaration.office).toBe(filled.declaration.office);
  });

  it('blanks every counting result and nothing else', () => {
    const blank = mapBlankPrarup7(src(), T, 'ताराचन्द मीणा (RTS)');
    // Column 5: each candidate's votes, and the NOTA votes.
    expect(blank.rows.map((r) => r.votes)).toEqual([null, null, null, null]);
    // Column 6: rejected postal ballots.
    expect(blank.rejected).toBeNull();
    // The declaration: who was elected, their address, gender and category.
    expect(blank.declaration.nameAndAddress).toEqual([]);
    expect([blank.declaration.gender, blank.declaration.category]).toEqual([null, null]);
  });

  it('is always a contested ballot: column 2 (uncontested) is the form\'s "—", never a name', () => {
    const blank = mapBlankPrarup7(formSource({ unopposed: true }), T);
    expect(blank.contested).toBe(true);
    expect(blank.rows.every((r) => r.uncontested === null)).toBe(true);
    // The one candidate is printed in column 3 with the NOTA row under them, votes empty.
    expect(blank.rows).toHaveLength(2);
    expect(blank.rows.map((r) => r.votes)).toEqual([null, null]);
  });

  it('needs no result at all: a ward with no counting still maps', () => {
    const blank = mapBlankPrarup7(formSource({ declared: false, candidates: 2 }), PS);
    expect(blank.rows.map((r) => r.votes)).toEqual([null, null, null]);
    expect(blank.declaration.nameAndAddress).toEqual([]);
  });

  it('the filled form is untouched by any of this', () => {
    const filled = mapPrarup7(src(), T, 'ताराचन्द मीणा (RTS)');
    expect(filled.rows.map((r) => r.votes)).toEqual(['1000', '950', '900', '7']);
    expect(filled.declaration.nameAndAddress.length).toBeGreaterThan(0);
  });
});
