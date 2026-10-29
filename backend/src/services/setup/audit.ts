import type { Connection } from 'mysql2/promise';

export interface AuditEntry {
  action: string;
  entity: string;
  entityId: number | null;
  oldValue?: unknown;
  newValue: unknown;
  reason?: string | null;
}

/** The logged-in user behind a run started from the Super Admin panel. */
export interface AuditActor {
  userId: number;
  ip: string | null;
}

/**
 * One append-only audit row (user_id NULL = CLI script; with `actor` = the Super Admin panel).
 * Never pass passwords/hashes.
 */
export async function writeAudit(
  conn: Connection,
  entry: AuditEntry,
  actor?: AuditActor,
): Promise<void> {
  await conn.execute(
    `INSERT INTO audit_log (user_id, action, entity, entity_id, old_value, new_value, reason, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      actor?.userId ?? null,
      entry.action,
      entry.entity,
      entry.entityId,
      entry.oldValue === undefined ? null : JSON.stringify(entry.oldValue),
      JSON.stringify(entry.newValue),
      entry.reason ?? null,
      actor?.ip ?? null,
    ],
  );
}
