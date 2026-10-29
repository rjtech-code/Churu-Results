import type { Role } from '../api/types';

/** Where each role starts after login (and where a wrong-role page sends it). */
export function homePath(role: Role): string {
  if (role === 'DM') return '/reports';
  if (role === 'SUPER_ADMIN') return '/superadmin';
  return '/wards';
}
