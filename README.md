# حسابداری — سیستم مالی مادر

سیستم حسابداری چندشرکتی مجموعه رایانش ابری ایرانیان (ارزینو، بلوپال، چارتینو، فیلیمینو و کسب‌وکارهای آینده).
Next.js 15 + TypeScript + Prisma + **PostgreSQL**. معماری کامل: [docs/architecture.md](docs/architecture.md)

## راه‌اندازی محلی

پیش‌نیاز: Node 20+، PostgreSQL 14+ (روی این سیستم نسخهٔ ۱۷ به‌صورت سرویس نصب است).

```bash
createdb -U postgres hesabdari          # یا از pgAdmin
cp .env.example .env                    # DATABASE_URL و SESSION_SECRET را پر کنید
npm install
npm run setup                           # migration + دادهٔ اولیه (چارت، شرکت، سال مالی، کسب‌وکارها، مدیر)
npm run build && npm start              # http://127.0.0.1:3200
```

ورود اولیه: `ADMIN_EMAIL` / `ADMIN_PASSWORD` از `.env` (پیش‌فرض `admin@hesabdari.local` / `Hesabdari!2026`) — بعد از اولین ورود از «کاربران» رمز را عوض کنید.

## Docker (سرور)

```bash
cp .env.example .env    # SESSION_SECRET و POSTGRES_PASSWORD را تغییر دهید
docker compose up -d --build
```
کانتینر هنگام شروع `prisma migrate deploy` و seed (idempotent) را اجرا می‌کند.

راهنمای کامل نصب روی سرور مجازی (دامنه، Nginx، SSL، پشتیبان‌گیری، به‌روزرسانی): [docs/نصب-روی-سرور.md](docs/نصب-روی-سرور.md)

## تست

تست‌های یکپارچهٔ هسته روی یک دیتابیس PostgreSQL **خالی و مخصوص تست** اجرا می‌شوند (نام آن باید شامل `test` باشد):

```bash
createdb -U postgres hesabdari_test
DATABASE_URL=postgresql://postgres:***@localhost:5432/hesabdari_test bash tests/setup.sh
DATABASE_URL=postgresql://postgres:***@localhost:5432/hesabdari_test npm test
```

دادهٔ نمایشی (فقط روی دیتابیس demo/test): `npx tsx scripts/demo-data.ts`

## ساختار

```
prisma/schema.prisma            مدل داده
prisma/migrations/*_ledger_integrity   triggerهای تغییرناپذیری و تراز
src/modules/ledger/posting.ts   موتور ثبت سند (تنها راه نوشتن در دفتر)
src/modules/ledger/closing.ts   بستن سال، اختتامیه، افتتاحیه
src/modules/reports/            تراز، دفاتر، سود و زیان، ترازنامه، داشبورد
src/modules/accounts/template.ts قالب کدینگ حساب‌ها
src/app/(app)/                  صفحات پنل
```
