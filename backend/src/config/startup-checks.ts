import type { Pool } from 'mysql2/promise';
import { writeAudit } from '../services/audit.js';
import type { AppConfig } from './app-config.js';

/**
 * Production normally requires registered-voter counts (rule 7). Running without them is allowed
 * (counts may never arrive), but it is made loud: a startup warning and an audit_log row.
 * Returns true when the warning was raised.
 */
export async function announceVoterCheckConfig(
  pool: Pool,
  config: AppConfig,
  log: (line: string) => void = (line) => {
    console.warn(line);
  },
): Promise<boolean> {
  if (!config.production || config.requireVoterCounts) return false;
  const bar = '!'.repeat(72);
  for (const line of [
    bar,
    'WARNING: REQUIRE_VOTER_COUNTS=false in PRODUCTION.',
    'Booths without a registered-voter count can be entered WITHOUT the',
    '"total <= registered voters" check (rule 7). Such entries get a VOTER_COUNT_MISSING warning.',
    'Import voter counts (npm run import:voters) and set REQUIRE_VOTER_COUNTS=true as soon as possible.',
    bar,
  ]) {
    log(line);
  }
  await writeAudit(pool, {
    userId: null,
    action: 'CONFIG_VOTER_CHECK_DISABLED',
    entity: 'config',
    entityId: null,
    newValue: { REQUIRE_VOTER_COUNTS: false, NODE_ENV: 'production' },
    ip: null,
  });
  return true;
}
