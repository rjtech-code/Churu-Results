export type Role = 'PS_RO' | 'ZP_RO' | 'DM';

/** The logged-in user, re-loaded from the database on every request. */
export interface AuthUser {
  id: number;
  username: string;
  fullName: string | null;
  role: Role;
  panchayatSamitiId: number | null;
  panchayatSamitiName: string | null;
}
