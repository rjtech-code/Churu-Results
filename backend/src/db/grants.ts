import type { Knex } from 'knex';

type Privilege = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';

const READ_WRITE: readonly Privilege[] = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];
const APPEND_ONLY: readonly Privilege[] = ['SELECT', 'INSERT'];

/**
 * Exact table privileges for the APP database user. Every table in the schema MUST be listed:
 * the grants step fails if the database has a table missing here (fail closed), so nobody can add
 * a table and accidentally give the app full write access to it.
 * The app user never gets CREATE, DROP, ALTER, INDEX, TRIGGER, REFERENCES or GRANT OPTION.
 */
export const APP_TABLE_PRIVILEGES: Readonly<Record<string, readonly Privilege[]>> = {
  district: READ_WRITE,
  panchayat_samiti: READ_WRITE,
  users: READ_WRITE,
  ward: READ_WRITE,
  booth: READ_WRITE,
  party: READ_WRITE,
  candidate: READ_WRITE,
  booth_entry: READ_WRITE,
  booth_entry_vote: READ_WRITE,
  postal_entry: READ_WRITE,
  postal_entry_vote: READ_WRITE,
  ward_declarations: APPEND_ONLY,
  audit_log: APPEND_ONLY,
  app_settings: READ_WRITE,
  // Login sessions: the session store inserts, reads, refreshes and deletes expired rows.
  sessions: READ_WRITE,
};

/** Knex bookkeeping tables: the app user gets no access at all. */
const NO_APP_ACCESS = new Set(['knex_migrations', 'knex_migrations_lock']);

// MySQL errors raised by REVOKE when there is nothing to revoke.
const ER_NONEXISTING_GRANT = 1141;
const ER_NONEXISTING_TABLE_GRANT = 1147;

function mysqlErrno(err: unknown): number | undefined {
  if (typeof err === 'object' && err !== null && 'errno' in err && typeof err.errno === 'number') {
    return err.errno;
  }
  return undefined;
}

/**
 * Idempotently (re)applies the app user's table privileges. Runs as the migration user, which has
 * GRANT OPTION on the database. Identifiers come only from the constant map above and from
 * validated environment config, never from requests.
 */
export async function applyAppGrants(db: Knex, database: string, appUser: string): Promise<void> {
  const result: unknown = await db.raw(
    "SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'",
    [database],
  );
  const rows = (result as [{ name: string }[]])[0];
  const actual = new Set(rows.map((r) => r.name).filter((name) => !NO_APP_ACCESS.has(name)));
  const expected = new Set(Object.keys(APP_TABLE_PRIVILEGES));

  const unlisted = [...actual].filter((t) => !expected.has(t));
  const missing = [...expected].filter((t) => !actual.has(t));
  if (unlisted.length > 0 || missing.length > 0) {
    throw new Error(
      `Grant map does not match the schema. Not in APP_TABLE_PRIVILEGES: [${unlisted.join(', ')}]; ` +
        `listed but missing from database: [${missing.join(', ')}]`,
    );
  }

  for (const [table, privileges] of Object.entries(APP_TABLE_PRIVILEGES)) {
    try {
      await db.raw('REVOKE ALL PRIVILEGES ON ??.?? FROM ?@?', [database, table, appUser, '%']);
    } catch (err) {
      const errno = mysqlErrno(err);
      if (errno !== ER_NONEXISTING_GRANT && errno !== ER_NONEXISTING_TABLE_GRANT) throw err;
    }
    await db.raw(`GRANT ${privileges.join(', ')} ON ??.?? TO ?@?`, [database, table, appUser, '%']);
  }
}
