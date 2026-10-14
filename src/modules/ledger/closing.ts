import type { PrismaClient } from '@prisma/client';
import { AppError } from '@/lib/errors';
import { writeAudit } from '@/lib/audit';
import { addDays } from '@/lib/jalali';
import { loadChart } from '@/modules/accounts/chart';
import { createAndPostTx, type LineInput } from './posting';

type BalRow = { accountId: string; dimensionSetId: number; balance: bigint };

/**
 * بستن سال مالی — سه سند استاندارد:
 *  ۱) بستن حساب‌های موقت (درآمد/هزینه) به سود انباشته، به تفکیک کسب‌وکار
 *  ۲) اختتامیه: صفر کردن حساب‌های دائمی
 *  ۳) افتتاحیه در سال بعد با همان مانده‌ها و همان ابعاد
 */
export async function closeFiscalYear(db: PrismaClient, userId: string, fiscalYearId: string) {
  return db.$transaction(async (tx) => {
    const fy = await tx.fiscalYear.findUniqueOrThrow({ where: { id: fiscalYearId }, include: { entity: true, periods: { orderBy: { no: 'asc' } } } });
    if (fy.status === 'CLOSED') throw new AppError('این سال مالی قبلاً بسته شده است.');
    const pending = await tx.voucher.count({ where: { fiscalYearId, status: { not: 'POSTED' } } });
    if (pending) throw new AppError(`${pending} سند قطعی‌نشده در این سال وجود دارد؛ ابتدا آن‌ها را قطعی یا حذف کنید.`);
    const lastPeriod = fy.periods[fy.periods.length - 1];
    if (lastPeriod.status !== 'OPEN') throw new AppError(`برای صدور اسناد پایان سال، دورهٔ «${lastPeriod.title}» باید باز باشد.`);

    const next = await tx.fiscalYear.findFirst({
      where: { entityId: fy.entityId, startDate: addDays(fy.endDate, 1) },
      include: { periods: { orderBy: { no: 'asc' }, take: 1 } },
    });
    if (!next) throw new AppError('ابتدا سال مالی بعد (شروع از روز پس از پایان این سال) را تعریف کنید.');
    if (next.status !== 'OPEN' || next.periods[0]?.status !== 'OPEN') throw new AppError('دورهٔ اول سال مالی بعد باید باز باشد.');
    const existingOpening = await tx.voucher.findFirst({ where: { fiscalYearId: next.id, type: 'OPENING' } });
    if (existingOpening) throw new AppError('سال مالی بعد از قبل سند افتتاحیه دارد.');

    const chart = await loadChart(tx, fy.entity.chartId);
    const re = chart.accounts.find((a) => a.systemRole === 'RETAINED_EARNINGS');
    if (!re) throw new AppError('حساب سیستمی «سود (زیان) انباشته» در چارت تعریف نشده است.');
    const businessType = await tx.dimensionType.findUnique({ where: { code: 'BUSINESS' } });

    const balances = async (): Promise<BalRow[]> =>
      tx.$queryRaw<BalRow[]>`
        SELECT l."accountId", l."dimensionSetId", SUM(l."debit" - l."credit")::bigint AS balance
        FROM "voucher_lines" l JOIN "vouchers" v ON v.id = l."voucherId"
        WHERE v."fiscalYearId" = ${fiscalYearId} AND v."status" = 'POSTED'
        GROUP BY l."accountId", l."dimensionSetId"
        HAVING SUM(l."debit" - l."credit") <> 0`;

    const setItems = async (ids: number[]) => {
      const items = await tx.dimensionSetItem.findMany({ where: { setId: { in: ids } } });
      const m = new Map<number, Record<string, string>>();
      for (const it of items) m.set(it.setId, { ...(m.get(it.setId) ?? {}), [it.typeId]: it.valueId });
      return m;
    };

    const toLine = (accountId: string, amount: bigint, dims: Record<string, string>, description?: string): LineInput =>
      amount > 0n ? { accountId, debit: amount, dims, description } : { accountId, credit: -amount, dims, description };

    const created: string[] = [];

    // ۱) بستن حساب‌های موقت
    const all1 = await balances();
    const pl = all1.filter((b) => {
      const c = chart.get(b.accountId)?.category;
      return c === 'REVENUE' || c === 'EXPENSE';
    });
    if (pl.length) {
      const dimsBySet = await setItems(pl.map((b) => b.dimensionSetId));
      const lines: LineInput[] = [];
      const reByBusiness = new Map<string, bigint>();
      for (const b of pl) {
        const dims = dimsBySet.get(b.dimensionSetId) ?? {};
        lines.push(toLine(b.accountId, -b.balance, dims));
        const biz = businessType ? dims[businessType.id] ?? '' : '';
        reByBusiness.set(biz, (reByBusiness.get(biz) ?? 0n) + b.balance);
      }
      for (const [biz, amount] of reByBusiness) {
        if (amount === 0n) continue;
        lines.push(toLine(re.id, amount, biz && businessType ? { [businessType.id]: biz } : {}, 'انتقال سود (زیان) سال'));
      }
      const v = await createAndPostTx(tx, userId, {
        entityId: fy.entityId,
        date: fy.endDate,
        type: 'PL_CLOSING',
        description: `بستن حساب‌های موقت سال مالی ${fy.title}`,
        sourceModule: 'closing',
        sourceRef: fy.id,
        idempotencyKey: `closing:pl:${fy.id}`,
        lines,
      });
      created.push(v.id);
    }

    // ۲) اختتامیه و ۳) افتتاحیه
    const all2 = await balances();
    const permanent = all2.filter((b) => {
      const c = chart.get(b.accountId)?.category;
      return c !== 'REVENUE' && c !== 'EXPENSE';
    });
    if (permanent.length) {
      const dimsBySet = await setItems(permanent.map((b) => b.dimensionSetId));
      const closingLines = permanent.map((b) => toLine(b.accountId, -b.balance, dimsBySet.get(b.dimensionSetId) ?? {}));
      const openingLines = permanent.map((b) => toLine(b.accountId, b.balance, dimsBySet.get(b.dimensionSetId) ?? {}));
      const c = await createAndPostTx(tx, userId, {
        entityId: fy.entityId,
        date: fy.endDate,
        type: 'CLOSING',
        description: `سند اختتامیه سال مالی ${fy.title}`,
        sourceModule: 'closing',
        sourceRef: fy.id,
        idempotencyKey: `closing:final:${fy.id}`,
        lines: closingLines,
      });
      const o = await createAndPostTx(tx, userId, {
        entityId: fy.entityId,
        date: next.startDate,
        type: 'OPENING',
        description: `سند افتتاحیه سال مالی ${next.title}`,
        sourceModule: 'closing',
        sourceRef: fy.id,
        idempotencyKey: `closing:opening:${fy.id}`,
        lines: openingLines,
      });
      created.push(c.id, o.id);
    }

    await tx.fiscalPeriod.updateMany({ where: { fiscalYearId }, data: { status: 'CLOSED' } });
    await tx.fiscalYear.update({ where: { id: fiscalYearId }, data: { status: 'CLOSED', closedAt: new Date() } });
    await writeAudit(tx, { userId, action: 'fiscal_year.close', objectType: 'FiscalYear', objectId: fiscalYearId, entityId: fy.entityId, data: { vouchers: created, nextYear: next.id } });
    return { vouchers: created };
  }, { maxWait: 10000, timeout: 300000 });
}
