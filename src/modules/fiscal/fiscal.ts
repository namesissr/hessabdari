import type { PeriodStatus, Prisma, PrismaClient } from '@prisma/client';
import { AppError } from '@/lib/errors';
import { addDays, addJMonths, dateToJ, formatJ, jMonthTitle, jToDate, monthLength } from '@/lib/jalali';
import { writeAudit } from '@/lib/audit';

type Db = Prisma.TransactionClient | PrismaClient;

export type PeriodDraft = { no: number; title: string; startDate: Date; endDate: Date };

/**
 * دوره‌ها بر اساس ماه‌های شمسی تقویمی ساخته می‌شوند؛ اگر سال مالی از وسط ماه شروع شود،
 * دورهٔ اول از تاریخ شروع تا پایان همان ماه است.
 */
export function buildPeriods(start: Date, end: Date): PeriodDraft[] {
  const out: PeriodDraft[] = [];
  let cur = start;
  let no = 1;
  while (cur <= end) {
    const { jy, jm } = dateToJ(cur);
    const monthEnd = jToDate(jy, jm, monthLength(jy, jm));
    const pEnd = monthEnd < end ? monthEnd : end;
    out.push({ no, title: jMonthTitle(jy, jm), startDate: cur, endDate: pEnd });
    cur = addDays(pEnd, 1);
    no++;
    if (no > 40) throw new AppError('طول سال مالی بیش از حد مجاز است.');
  }
  return out;
}

/** پیشنهاد سال مالی بعدی: روز بعد از پایان آخرین سال، یا بر اساس تنظیم شروع سال شرکت */
export async function suggestNextYear(db: Db, entityId: string) {
  const entity = await db.entity.findUniqueOrThrow({ where: { id: entityId } });
  const last = await db.fiscalYear.findFirst({ where: { entityId }, orderBy: { endDate: 'desc' } });
  let start: Date;
  if (last) start = addDays(last.endDate, 1);
  else {
    const { jy } = dateToJ(new Date());
    start = jToDate(jy, entity.fiscalStartMonth, entity.fiscalStartDay);
  }
  const s = dateToJ(start);
  const next = addJMonths(s.jy, s.jm, 12);
  // پایان = یک روز قبل از همان روز در سال بعد
  const endPlusOne = jToDate(next.jy, next.jm, Math.min(s.jd, monthLength(next.jy, next.jm)));
  const end = addDays(endPlusOne, -1);
  const title = s.jm === 1 && s.jd === 1 ? String(s.jy) : `${s.jy}-${dateToJ(end).jy}`;
  return { title, startDate: start, endDate: end };
}

async function assertNoOverlap(db: Db, entityId: string, start: Date, end: Date, exceptId?: string) {
  const overlap = await db.fiscalYear.findFirst({
    where: {
      entityId,
      id: exceptId ? { not: exceptId } : undefined,
      startDate: { lte: end },
      endDate: { gte: start },
    },
  });
  if (overlap) throw new AppError(`بازهٔ تاریخ با سال مالی «${overlap.title}» تداخل دارد.`);
}

function assertRange(start: Date, end: Date) {
  if (end < start) throw new AppError('تاریخ پایان باید بعد از تاریخ شروع باشد.');
  const days = (end.getTime() - start.getTime()) / 86400000 + 1;
  if (days > 549) throw new AppError('سال مالی نمی‌تواند بیش از ۱۸ ماه باشد.');
}

export async function createFiscalYear(
  db: PrismaClient,
  userId: string,
  input: { entityId: string; title: string; startDate: Date; endDate: Date },
) {
  assertRange(input.startDate, input.endDate);
  return db.$transaction(async (tx) => {
    await assertNoOverlap(tx, input.entityId, input.startDate, input.endDate);
    const fy = await tx.fiscalYear.create({
      data: {
        entityId: input.entityId,
        title: input.title.trim(),
        startDate: input.startDate,
        endDate: input.endDate,
        periods: { create: buildPeriods(input.startDate, input.endDate) },
      },
    });
    await writeAudit(tx, { userId, action: 'fiscal_year.create', objectType: 'FiscalYear', objectId: fy.id, entityId: input.entityId, data: input });
    return fy;
  });
}

/**
 * ویرایش سال مالی از پنل. عنوان همیشه قابل تغییر است؛ تاریخ‌ها فقط وقتی سندی در سال ثبت نشده
 * (چون هر سند به یک دوره وصل است و دوره‌ها بازسازی می‌شوند).
 */
export async function updateFiscalYear(
  db: PrismaClient,
  userId: string,
  id: string,
  input: { title: string; startDate: Date; endDate: Date },
) {
  return db.$transaction(async (tx) => {
    const fy = await tx.fiscalYear.findUniqueOrThrow({ where: { id } });
    if (fy.status === 'CLOSED') throw new AppError('سال مالی بسته شده قابل ویرایش نیست.');
    const datesChanged = fy.startDate.getTime() !== input.startDate.getTime() || fy.endDate.getTime() !== input.endDate.getTime();
    if (datesChanged) {
      assertRange(input.startDate, input.endDate);
      const count = await tx.voucher.count({ where: { fiscalYearId: id } });
      if (count > 0) throw new AppError('در این سال مالی سند ثبت شده؛ فقط عنوان قابل تغییر است.');
      await assertNoOverlap(tx, fy.entityId, input.startDate, input.endDate, id);
      await tx.fiscalPeriod.deleteMany({ where: { fiscalYearId: id } });
      await tx.fiscalPeriod.createMany({
        data: buildPeriods(input.startDate, input.endDate).map((p) => ({ ...p, fiscalYearId: id })),
      });
    }
    const updated = await tx.fiscalYear.update({
      where: { id },
      data: { title: input.title.trim(), startDate: input.startDate, endDate: input.endDate },
    });
    await writeAudit(tx, {
      userId,
      action: 'fiscal_year.update',
      objectType: 'FiscalYear',
      objectId: id,
      entityId: fy.entityId,
      data: { before: { title: fy.title, start: formatJ(fy.startDate, false), end: formatJ(fy.endDate, false) }, after: { title: input.title, start: formatJ(input.startDate, false), end: formatJ(input.endDate, false) } },
    });
    return updated;
  });
}

export async function deleteFiscalYear(db: PrismaClient, userId: string, id: string) {
  return db.$transaction(async (tx) => {
    const fy = await tx.fiscalYear.findUniqueOrThrow({ where: { id } });
    const count = await tx.voucher.count({ where: { fiscalYearId: id } });
    if (count > 0) throw new AppError('سال مالی دارای سند است و حذف نمی‌شود.');
    await tx.fiscalYear.delete({ where: { id } });
    await writeAudit(tx, { userId, action: 'fiscal_year.delete', objectType: 'FiscalYear', objectId: id, entityId: fy.entityId, data: { title: fy.title } });
  });
}

export async function setPeriodStatus(db: PrismaClient, userId: string, periodId: string, status: Exclude<PeriodStatus, 'CLOSED'>) {
  return db.$transaction(async (tx) => {
    const p = await tx.fiscalPeriod.findUniqueOrThrow({ where: { id: periodId }, include: { fiscalYear: true } });
    if (p.status === 'CLOSED' || p.fiscalYear.status === 'CLOSED') throw new AppError('دورهٔ بسته شده قابل تغییر نیست.');
    await tx.fiscalPeriod.update({ where: { id: periodId }, data: { status } });
    await writeAudit(tx, { userId, action: `period.${status.toLowerCase()}`, objectType: 'FiscalPeriod', objectId: periodId, entityId: p.fiscalYear.entityId, data: { title: p.title } });
  });
}

/** سال و دورهٔ مالی شامل تاریخ */
export async function findPeriod(db: Db, entityId: string, date: Date) {
  const fy = await db.fiscalYear.findFirst({
    where: { entityId, startDate: { lte: date }, endDate: { gte: date } },
    include: { periods: { where: { startDate: { lte: date }, endDate: { gte: date } } } },
  });
  if (!fy) throw new AppError(`برای تاریخ ${formatJ(date)} سال مالی تعریف نشده است.`);
  const period = fy.periods[0];
  if (!period) throw new AppError(`برای تاریخ ${formatJ(date)} دورهٔ مالی پیدا نشد.`);
  return { fiscalYear: fy, period };
}
