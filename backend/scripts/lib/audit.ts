import type { PoolConnection } from 'mysql2/promise';

export interface AuditEntry {
  action: string;
  entity: string;
  entityId: number | null;
  oldValue?: unknown;
  newValue: unknown;
  reason?: string | null;
}

/** One append-only audit row for a CLI action (user_id NULL = script). Never pass passwords/hashes. */
export async function writeAudit(conn: PoolConnection, entry: AuditEntry): Promise<void> {
  await conn.execute(
    `INSERT INTO audit_log (user_id, action, entity, entity_id, old_value, new_value, reason, ip)
     VALUES (NULL, ?, ?, ?, ?, ?, ?, NULL)`,
    [
      entry.action,
      entry.entity,
      entry.entityId,
      entry.oldValue === undefined ? null : JSON.stringify(entry.oldValue),
      JSON.stringify(entry.newValue),
      entry.reason ?? null,
    ],
  );
}
