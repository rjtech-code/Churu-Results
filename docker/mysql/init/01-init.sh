#!/bin/bash
# Runs once, on the first start of an empty data volume (official mysql image behaviour).
# Creates the dev and test databases, the migration user and the app user.
# All names and passwords come from environment variables (backend/.env); nothing is hard-coded.
# The app user gets NO privileges here: table-level grants are applied by `npm run migrate`
# (backend/src/db/grants.ts), because table grants need the tables to exist.
set -euo pipefail

require() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "init: required variable $name is not set" >&2
    exit 1
  fi
}

for v in MYSQL_ROOT_PASSWORD DB_NAME DB_NAME_TEST DB_APP_USER DB_APP_PASSWORD DB_MIGRATION_USER DB_MIGRATION_PASSWORD; do
  require "$v"
done

# Identifiers are interpolated into SQL, so allow only a strict character set.
for v in DB_NAME DB_NAME_TEST DB_APP_USER DB_MIGRATION_USER; do
  if ! [[ "${!v}" =~ ^[a-z0-9_]+$ ]]; then
    echo "init: $v must match ^[a-z0-9_]+$" >&2
    exit 1
  fi
done

if ! [[ "$DB_NAME_TEST" =~ _test$ ]]; then
  echo "init: DB_NAME_TEST must end with _test" >&2
  exit 1
fi

# Passwords are passed as SQL string literals; escape backslashes and single quotes.
sql_escape() { printf '%s' "$1" | sed -e "s/\\\\/\\\\\\\\/g" -e "s/'/''/g"; }
APP_PW="$(sql_escape "$DB_APP_PASSWORD")"
MIG_PW="$(sql_escape "$DB_MIGRATION_PASSWORD")"

mysql --protocol=socket -uroot -p"$MYSQL_ROOT_PASSWORD" <<SQL
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS \`${DB_NAME_TEST}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS '${DB_MIGRATION_USER}'@'%' IDENTIFIED BY '${MIG_PW}';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_MIGRATION_USER}'@'%' WITH GRANT OPTION;
GRANT ALL PRIVILEGES ON \`${DB_NAME_TEST}\`.* TO '${DB_MIGRATION_USER}'@'%' WITH GRANT OPTION;

-- App user: created with no privileges. See backend/src/db/grants.ts.
CREATE USER IF NOT EXISTS '${DB_APP_USER}'@'%' IDENTIFIED BY '${APP_PW}';

FLUSH PRIVILEGES;
SQL

echo "init: databases and users created"
