// One Super Admin /overview body for the panel tests, with realistic Churu-sized numbers.
import type { Overview } from '../api/superadminTypes';

export const OV: Overview = {
  countingLocked: false,
  confirmedUntil: null,
  counts: {
    panchayatSamitis: 13,
    booths: 1371,
    psWards: 231,
    zpWards: 39,
    parties: 8,
    candidates: 958,
    entries: 1200,
    declaredWards: 7,
    voters: 1_200_000,
  },
  testData: {
    allowed: true,
    reason: null,
    deletes: {
      candidates: 958,
      boothEntries: 1200,
      postalEntries: 40,
      declaredWards: 7,
      voidedEntries: 3,
      nameChanges: 5,
      lockedWards: 270,
    },
  },
  countingData: {
    allowed: true,
    reason: null,
    deletes: {
      boothEntries: 1200,
      postalEntries: 40,
      declaredWards: 7,
      declarationVersions: 9,
      voidedEntries: 3,
    },
    keeps: {
      candidates: 958,
      lockedWards: 270,
      readyWards: 265,
      nameChanges: 5,
      booths: 1371,
      wards: 274,
    },
  },
  countingExport: {
    rows: { boothEntries: 4120, postalEntries: 150, declarations: 9, voidedEntries: 11 },
  },
  masterData: {
    allowed: true,
    reason: null,
    deletes: {
      booths: 1371,
      psWards: 231,
      zpWards: 39,
      parties: 8,
      candidates: 958,
      entries: 1200,
      declaredWards: 7,
    },
    defaults: { hindiNames: 13, fixes: null },
  },
  booths: { allowed: true, reason: null },
  dm: {
    username: 'dm_churu',
    fullName: 'जिला निर्वाचन अधिकारी',
    email: 'd**@example.in',
    failedLogins: 0,
    lockedNow: false,
  },
  panchayatSamitis: [{ id: 1, nameEnglish: 'CHURU', nameHindi: 'चूरू' }],
};

export const overview = (patch: Partial<Overview> = {}): Overview => ({ ...OV, ...patch });
