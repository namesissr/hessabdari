#!/usr/bin/env bash
# روی یک دیتابیس تست «خالی» migration و seed را اعمال می‌کند.
# (دیتابیس تست را خودتان بسازید/پاک کنید؛ مثلاً: dropdb hesabdari_test && createdb hesabdari_test)
set -e
case "$DATABASE_URL" in
  *test*) ;;
  *) echo "DATABASE_URL must point to a test database (name containing 'test')"; exit 1 ;;
esac
npx prisma migrate deploy >/dev/null
npx tsx prisma/seed.ts
