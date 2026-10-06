import type { Knex } from 'knex';
import * as geography from './20261006000001_geography.js';
import * as users from './20261006000002_users.js';
import * as wardsBooths from './20261006000003_wards_booths.js';
import * as partiesCandidates from './20261006000004_parties_candidates.js';
import * as counting from './20261006000005_counting.js';
import * as declarations from './20261006000006_declarations.js';
import * as auditSettings from './20261006000007_audit_settings.js';
import * as postalRejectedWardFlags from './20261007000001_postal_rejected_ward_flags.js';

// Explicit, ordered list of migrations. Statically imported so the same code works under tsx
// and from the compiled dist/ build, without the knex CLI (which would need ts-node).
const MIGRATIONS: readonly (readonly [string, Knex.Migration])[] = [
  ['20261006000001_geography', geography],
  ['20261006000002_users', users],
  ['20261006000003_wards_booths', wardsBooths],
  ['20261006000004_parties_candidates', partiesCandidates],
  ['20261006000005_counting', counting],
  ['20261006000006_declarations', declarations],
  ['20261006000007_audit_settings', auditSettings],
  ['20261007000001_postal_rejected_ward_flags', postalRejectedWardFlags],
];

export const migrationSource: Knex.MigrationSource<string> = {
  getMigrations: () => Promise.resolve(MIGRATIONS.map(([name]) => name)),
  getMigrationName: (name) => name,
  getMigration: (name) => {
    const found = MIGRATIONS.find(([n]) => n === name);
    if (!found) return Promise.reject(new Error(`Unknown migration: ${name}`));
    return Promise.resolve(found[1]);
  },
};
