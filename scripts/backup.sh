#!/bin/sh
# پشتیبان‌گیری امن از پایگاه‌داده (حتی وقتی سرور در حال کار است).
# استفاده:  ./scripts/backup.sh [مسیر-فایل-پایگاه‌داده] [پوشهٔ-مقصد]
# برای Docker:  docker compose exec shiftyar node scripts/backup.js /data/shiftyar.db /data/backups
set -eu
DB="${1:-data/shiftyar.db}"
OUT="${2:-data/backups}"
mkdir -p "$OUT"
exec node "$(dirname "$0")/backup.js" "$DB" "$OUT"
