// Shapes of /api/superadmin (the Super Admin setup panel).

export interface TestDataDeletes {
  candidates: number;
  boothEntries: number;
  postalEntries: number;
  declaredWards: number;
  voidedEntries: number;
  lockedWards: number;
}

export interface MasterDataDeletes {
  booths: number;
  psWards: number;
  zpWards: number;
  parties: number;
  candidates: number;
  entries: number;
  declaredWards: number;
}

export interface Task {
  allowed: boolean;
  /** Why not (plain Hindi with English terms), or null. */
  reason: string | null;
}

export interface Overview {
  countingLocked: boolean;
  /** Until when no password is needed (epoch ms), or null. */
  confirmedUntil: number | null;
  counts: MasterDataDeletes & { panchayatSamitis: number; voters: number };
  testData: Task & { deletes: TestDataDeletes };
  masterData: Task & {
    deletes: MasterDataDeletes;
    defaults: { hindiNames: number; fixes: { entries: number; savedAt: string } | null };
  };
  booths: Task;
  dm: {
    username: string;
    fullName: string | null;
    email: string | null;
    failedLogins: number;
    lockedNow: boolean;
  } | null;
  panchayatSamitis: { id: number; nameEnglish: string; nameHindi: string }[];
}

export interface PanelBooth {
  id: number;
  boothNo: number;
  nameHindi: string;
  psWardNo: number;
  zpWardNo: number;
  votersTotal: number | null;
  canDelete: boolean;
}

export interface BoothWards {
  psWards: { wardNo: number; open: boolean }[];
  zpWards: { wardNo: number; open: boolean }[];
}

export interface GeographyCounts {
  panchayatSamitis: number;
  psWards: number;
  zpWards: number;
  booths: number;
}

export interface MasterCheck {
  ok: boolean;
  counts: GeographyCounts | null;
  totalVoters: number | null;
  problems: string[];
  warnings: string[];
}

export interface MasterRun extends Partial<MasterCheck> {
  status: 'CHECK_FAILED' | 'IMPORT_FAILED' | 'DONE';
  ok: boolean;
  problems: string[];
  backupFile?: string;
}

/** The official Churu numbers the dry run is compared with. */
export const OFFICIAL_COUNTS: GeographyCounts = {
  panchayatSamitis: 13,
  psWards: 231,
  zpWards: 39,
  booths: 1359,
};

export const SAMPLE_HREF = {
  geography: '/api/superadmin/samples/geography',
  voters: '/api/superadmin/samples/voters',
  fixes: '/api/superadmin/samples/fixes',
  psNames: '/api/superadmin/samples/ps-names',
} as const;

export const fmt = (n: number) => n.toLocaleString('en-IN');
