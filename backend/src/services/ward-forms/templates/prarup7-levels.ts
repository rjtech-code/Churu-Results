// The two levels of Prarup-7: Zila Parishad (wording exactly as on the official ZP form, docs/forms
// scan pages 2-3) and Panchayat Samiti (the same form with the body's name changed). Rule numbers
// and the Returning Officer's designation that are not verified for the Panchayat Samiti are left
// blank for hand filling, never invented.
import type { Prarup7Level } from './types.js';

/** Printed where a rule number is left for hand filling. */
export const RULE_NUMBER_BLANK = '………';

export const ZP_LEVEL: Prarup7Level = {
  title: 'Prarup-7 Zila Parishad',
  body: 'जिला परिषद',
  bodyFormal: 'जिला परिषद्',
  rules: { form: '52, 59, 60, 61', uncontested: '29(2)', lot: '51' },
  header: [
    { value: 'bodyName', at: 0.02 },
    { value: 'wardCount', at: 0.17 },
    { value: 'panchayatSamitis', at: 0.35 },
    { value: 'district', at: 0.58 },
    { value: 'electionDate', at: 0.72 },
  ],
  roDesignation: '(जिला कलक्टर एवं जिला मजिस्ट्रेट)',
  signaturePlace: 'district',
};

export const PS_LEVEL: Prarup7Level = {
  title: 'Prarup-7 Panchayat Samiti',
  body: 'पंचायत समिति',
  bodyFormal: 'पंचायत समिति',
  rules: { form: RULE_NUMBER_BLANK, uncontested: RULE_NUMBER_BLANK, lot: RULE_NUMBER_BLANK },
  // No "Panchayat Samitis of this ward" item: a PS ward lies in its own PS.
  header: [
    { value: 'bodyName', at: 0.02 },
    { value: 'wardCount', at: 0.24 },
    { value: 'district', at: 0.46 },
    { value: 'electionDate', at: 0.66 },
  ],
  roDesignation: null,
  signaturePlace: null,
};
