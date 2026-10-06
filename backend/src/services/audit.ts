import type { Pool, PoolConnection } from 'mysql2/promise';

export interface AuditEvent {
  userId: number | null;
  action: string;
  entity: string;
  entityId: number | null;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
  ip: string | null;
}

/**
 * Appends one audit_log row. NEVER pass passwords, password hashes, session ids or CSRF tokens.
 * Use the transaction's connection when the audit row belongs to a larger write.
 */
export async function writeAudit(db: Pool | PoolConnection, event: AuditEvent): Promise<void> {
  await db.execute(
    `INSERT INTO audit_log (user_id, action, entity, entity_id, old_value, new_value, reason, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      event.userId,
      event.action,
      event.entity,
      event.entityId,
      event.oldValue === undefined ? null : JSON.stringify(event.oldValue),
      event.newValue === undefined ? null : JSON.stringify(event.newValue),
      event.reason ?? null,
      event.ip === null ? null : event.ip.slice(0, 45),
    ],
  );
}
