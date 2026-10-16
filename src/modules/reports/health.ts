import type { PrismaClient } from '@prisma/client';
import { auditHash, legacyAuditHash } from '@/lib/audit';

export type HealthCheck = {
  key: string;
  title: string;
  status: 'ok' | 'warn' | 'error';
  detail: string;
  href?: string;
};

/**
 * کنترل‌های سلامت دفاتر — قبل از بستن دوره/سال و قبل از ارائه به حسابرس.
 */
export async function healthChecks(db: PrismaClient, entityId: string, fiscalYearId: string): Promise<HealthCheck[]> {
  const out: HealthCheck[] = [];
  const fa = (n: number | bigint) => n.toLocaleString('fa-IR');

  // ۱) اسناد قطعی‌نشده
  const pending = await db.voucher.count({ where: { entityId, fiscalYearId, status: { not: 'POSTED' } } });
  out.push({
    key: 'pending',
    title: 'اسناد قطعی‌نشده',
    status: pending ? 'warn' : 'ok',
    detail: pending ? `${fa(pending)} سند هنوز در وضعیت یادداشت یا بررسی‌شده است.` : 'همهٔ اسناد این سال مالی قطعی شده‌اند.',
    href: pending ? '/vouchers?status=DRAFT' : undefined,
  });

  // ۲) یادداشت‌های ناتراز
  const unbalanced = await db.$queryRaw<{ id: string; draftNo: number }[]>`
    SELECT v.id, v."draftNo" FROM "vouchers" v
    JOIN "voucher_lines" l ON l."voucherId" = v.id
    WHERE v."entityId" = ${entityId} AND v."fiscalYearId" = ${fiscalYearId} AND v."status" <> 'POSTED'
    GROUP BY v.id, v."draftNo"
    HAVING SUM(l."debit") <> SUM(l."credit")
    LIMIT 20`;
  out.push({
    key: 'unbalanced',
    title: 'یادداشت‌های ناتراز',
    status: unbalanced.length ? 'warn' : 'ok',
    detail: unbalanced.length
      ? `شمارهٔ موقت: ${unbalanced.map((u) => fa(u.draftNo)).join('، ')}`
      : 'یادداشت ناترازی وجود ندارد (اسناد قطعی طبق قید دیتابیس همیشه ترازند).',
    href: unbalanced.length ? '/vouchers?status=DRAFT' : undefined,
  });

  // ۳) پیوستگی شمارهٔ اسناد قطعی
  const nums = await db.$queryRaw<{ max: number | null; cnt: bigint }[]>`
    SELECT MAX("number") AS max, COUNT(*)::bigint AS cnt FROM "vouchers"
    WHERE "fiscalYearId" = ${fiscalYearId} AND "status" = 'POSTED'`;
  const maxNo = nums[0]?.max ?? 0;
  const cnt = Number(nums[0]?.cnt ?? 0n);
  out.push({
    key: 'numbering',
    title: 'پیوستگی شمارهٔ اسناد',
    status: maxNo === cnt ? 'ok' : 'error',
    detail: maxNo === cnt ? `${fa(cnt)} سند قطعی با شماره‌های ۱ تا ${fa(maxNo)} بدون فاصله.` : `بزرگ‌ترین شماره ${fa(maxNo)} ولی تعداد اسناد ${fa(cnt)} است؛ «مرتب‌سازی شماره اسناد» را اجرا کنید.`,
    href: maxNo === cnt ? undefined : '/settings/fiscal-years',
  });

  // ۴) تراز بودن کل دفتر
  const tot = await db.$queryRaw<{ d: bigint; c: bigint }[]>`
    SELECT COALESCE(SUM(l."debit"),0)::bigint AS d, COALESCE(SUM(l."credit"),0)::bigint AS c
    FROM "voucher_lines" l JOIN "vouchers" v ON v.id = l."voucherId"
    WHERE v."fiscalYearId" = ${fiscalYearId} AND v."status" = 'POSTED'`;
  const diff = (tot[0]?.d ?? 0n) - (tot[0]?.c ?? 0n);
  out.push({
    key: 'balance',
    title: 'توازن کل دفتر',
    status: diff === 0n ? 'ok' : 'error',
    detail: diff === 0n ? `جمع بدهکار و بستانکار برابر است (${fa(tot[0]?.d ?? 0n)} ریال).` : `اختلاف ${fa(diff)} ریال — فوراً بررسی شود.`,
    href: '/reports/trial-balance',
  });

  // ۵) دوره‌های باز سال‌های گذشته
  const oldOpen = await db.fiscalPeriod.count({
    where: { fiscalYear: { entityId, status: 'OPEN', id: { not: fiscalYearId } }, status: 'OPEN' },
  });
  out.push({
    key: 'old-periods',
    title: 'دوره‌های باز سال‌های دیگر',
    status: oldOpen ? 'warn' : 'ok',
    detail: oldOpen ? `${fa(oldOpen)} دورهٔ باز در سال‌های مالی دیگر وجود دارد؛ دوره‌های بسته‌شده را قفل کنید.` : 'دورهٔ بازی در سال‌های دیگر نمانده است.',
    href: oldOpen ? '/settings/fiscal-years' : undefined,
  });

  // ۶) حساب‌های معین بدون تفصیلی اجباری که گردش دارند
  const noDims = await db.$queryRaw<{ code: string; name: string }[]>`
    SELECT a."code", a."name" FROM "accounts" a
    WHERE a."isPostable" AND EXISTS (
      SELECT 1 FROM "voucher_lines" l JOIN "vouchers" v ON v.id = l."voucherId"
      WHERE l."accountId" = a.id AND v."fiscalYearId" = ${fiscalYearId} AND v."status" = 'POSTED'
        AND NOT EXISTS (SELECT 1 FROM "dimension_set_items" i WHERE i."setId" = l."dimensionSetId")
    )
    ORDER BY a."code" LIMIT 10`;
  out.push({
    key: 'no-dims',
    title: 'ردیف‌های بدون هیچ تفصیلی',
    status: noDims.length ? 'warn' : 'ok',
    detail: noDims.length
      ? `حساب‌هایی با ردیف بدون تفصیلی: ${noDims.map((a) => `${a.code} ${a.name}`).join('، ')}`
      : 'همهٔ ردیف‌های قطعی حداقل یک تفصیلی دارند.',
    href: noDims.length ? '/settings/accounts' : undefined,
  });

  // ۷) سلامت زنجیرهٔ لاگ ممیزی (۱۰۰۰ رویداد آخر)
  const logs = await db.auditLog.findMany({ orderBy: { id: 'desc' }, take: 1000 });
  logs.reverse();
  const verify = (l: (typeof logs)[number]) => {
    const payload = { ...l, data: l.data ?? null };
    return auditHash(payload) === l.hash || legacyAuditHash(payload) === l.hash;
  };
  // پیوستگی حلقه‌ها (هر ردیف هش ردیف قبل را دارد) همیشه قابل بررسی است
  let chainBreaks = 0;
  for (let i = 1; i < logs.length; i++) if (logs[i].prevHash !== logs[i - 1].hash) chainBreaks++;
  // بازبینی محتوا از جدیدترین ردیف به عقب؛ ردیف‌های ثبت‌شده با فرمول قدیمی (قبل از
  // نرمال‌سازی کلیدهای jsonb) قابل بازتولید نیستند و «دست‌کاری» شمرده نمی‌شوند.
  let verified = 0;
  while (verified < logs.length && verify(logs[logs.length - 1 - verified])) verified++;
  const older = logs.length - verified;
  const tampered = chainBreaks > 0;
  out.push({
    key: 'audit',
    title: 'سلامت زنجیرهٔ لاگ ممیزی',
    status: tampered ? 'error' : 'ok',
    detail: tampered
      ? `${fa(chainBreaks)} گسست در زنجیرهٔ هش پیدا شد — احتمال دست‌کاری یا حذف مستقیم در دیتابیس.`
      : `زنجیرهٔ ${fa(logs.length)} رویداد آخر پیوسته است؛ محتوای ${fa(verified)} ردیف آخر بازبینی شد` +
        (older ? ` (${fa(older)} ردیف قدیمی‌تر با فرمول هش نسخهٔ قبلی ثبت شده و فقط پیوستگی‌شان بررسی می‌شود).` : '.'),
    href: '/settings/audit-log',
  });

  return out;
}
