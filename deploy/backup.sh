#!/bin/bash
# Daily MySQL backup. Run from the project folder as root.
#   Cron (every day 02:30):  30 2 * * * cd /root/Churu-Results && ./deploy/backup.sh >> /root/churu-backups/backup.log 2>&1
#   Restore:  gunzip -c /root/churu-backups/churu-YYYY-MM-DD_HHMM.sql.gz | docker compose -f docker-compose.prod.yml exec -T mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$DB_NAME"'
set -euo pipefail
cd "$(dirname "$0")/.."
DIR=/root/churu-backups
mkdir -p "$DIR"
chmod 700 "$DIR"
OUT="$DIR/churu-$(date +%F_%H%M).sql.gz"
docker compose -f docker-compose.prod.yml exec -T mysql sh -c \
  'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqldump -uroot --single-transaction --routines --triggers --no-tablespaces "$DB_NAME"' \
  | gzip > "$OUT.tmp"
mv "$OUT.tmp" "$OUT"
find "$DIR" -name 'churu-*.sql.gz' -mtime +14 -delete
echo "$(date '+%F %T') backup ok: $OUT"
