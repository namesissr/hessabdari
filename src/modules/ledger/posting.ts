import { Prisma, type PrismaClient, type VoucherType } from '@prisma/client';
import { AppError } from '@/lib/errors';
import { writeAudit } from '@/lib/audit';
import { formatJ } from '@/lib/jalali';
import { formatMoney, toBig } from '@/lib/money';
import { loadChart } from '@/modules/accounts/chart';
import { resolveDimensionSet, type DimMap } from '@/modules/dimensions/sets';
import { findPeriod } from '@/modules/fiscal/fiscal';

type Tx = Prisma.TransactionClient;

/**
 * موتور ثبت سند — تنها راه نوشتن در دفتر.
 * همهٔ ماژول‌ها (دستی، زیرسیستم‌ها، سایت‌ها، بستن سال) از همین توابع استفاده می‌کنند.
 */

export type LineInput = {
  accountId: string;
  debit?: bigint | string | number | null;
  credit?: bigint | string | number | null;
  description?: string | null;
  dims?: DimMap;
  currency?: string | null;
  fxAmount?: string | number | null;
  fxRate?: string | number | null;
  quantity?: string | number | null;
  unit?: string | null;
  dueDate?: Date | null;
};

export type VoucherInput = {
  entityId: string;
  date: Date;
  type?: VoucherType;
  description?: string | null;
  lines: LineInput[];
  sourceModule?: string | null;
  sourceRef?: string | null;
  idempotencyKey?: string | null;
};

const TX_OPTS = { maxWait: 10000, timeout: 60000 };

export async function nextSequence(tx: Tx, key: string): Promise<number> {
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "number_sequences" ("key", "value") VALUES (${key}, 1)
    ON CONFLICT ("key") DO UPDATE SET "value" = "number_sequences"."value" + 1
    RETURNING "value"`;
  return rows[0].value;
}

function dateKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

/** اعتبارسنجی ساختاری + ساخت ردیف‌ها؛ قوانین کامل (تراز، ابعاد اجباری) هنگام قطعی شدن بررسی می‌شود. */
async function buildLines(tx: Tx, entityId: string, lines: LineInput[]) {
  if (!lines.length) throw new AppError('سند باید حداقل یک ردیف داشته باشد.');
  const entity = await tx.entity.findUniqueOrThrow({ where: { id: entityId } });
  const chart = await loadChart(tx, entity.chartId);

  const valueIds = [...new Set(lines.flatMap((l) => Object.values(l.dims ?? {}).filter(Boolean)))];
  const values = await tx.dimensionValue.findMany({ where: { id: { in: valueIds } } });
  const valueById = new Map(values.map((v) => [v.id, v]));

  const out: Omit<Prisma.VoucherLineCreateManyInput, 'voucherId'>[] = [];
  for (const [i, l] of lines.entries()) {
    const row = i + 1;
    const acc = chart.get(l.accountId);
    if (!acc) throw new AppError(`ردیف ${row}: حساب متعلق به چارت این شرکت نیست.`);
    if (!acc.isPostable) throw new AppError(`ردیف ${row}: حساب «${acc.code} ${acc.name}» قابل ثبت نیست (فقط حساب معین).`);
    if (!acc.active) throw new AppError(`ردیف ${row}: حساب «${acc.code} ${acc.name}» غیرفعال است.`);

    let debit: bigint, credit: bigint;
    try {
      debit = toBig(l.debit);
      credit = toBig(l.credit);
    } catch {
      throw new AppError(`ردیف ${row}: مبلغ نامعتبر است.`);
    }
    if (debit < 0n || credit < 0n) throw new AppError(`ردیف ${row}: مبلغ منفی مجاز نیست.`);
    if ((debit > 0n) === (credit > 0n)) throw new AppError(`ردیف ${row}: دقیقاً یکی از ستون‌های بدهکار یا بستانکار باید مقدار داشته باشد.`);

    const dims: DimMap = {};
    for (const [typeId, valueId] of Object.entries(l.dims ?? {})) {
      if (!valueId) continue;
      const v = valueById.get(valueId);
      if (!v || v.typeId !== typeId) throw new AppError(`ردیف ${row}: مقدار تفصیلی نامعتبر است.`);
      if (!v.active) throw new AppError(`ردیف ${row}: تفصیلی «${v.name}» غیرفعال است.`);
      if (v.entityId && v.entityId !== entityId) throw new AppError(`ردیف ${row}: تفصیلی «${v.name}» متعلق به شرکت دیگری است.`);
      dims[typeId] = valueId;
    }
    const dimensionSetId = await resolveDimensionSet(tx, dims);
    if (l.currency && !acc.allowFx && l.currency !== entity.baseCurrency) {
      throw new AppError(`ردیف ${row}: حساب «${acc.name}» ارزی نیست.`);
    }

    out.push({
      lineNo: row,
      accountId: acc.id,
      dimensionSetId,
      debit,
      credit,
      description: l.description?.trim() || null,
      currency: l.currency || null,
      fxAmount: l.fxAmount != null && l.fxAmount !== '' ? new Prisma.Decimal(l.fxAmount) : null,
      fxRate: l.fxRate != null && l.fxRate !== '' ? new Prisma.Decimal(l.fxRate) : null,
      quantity: l.quantity != null && l.quantity !== '' ? new Prisma.Decimal(l.quantity) : null,
      unit: l.unit || null,
      dueDate: l.dueDate ?? null,
    });
  }
  return out;
}

async function locateDate(tx: Tx, entityId: string, date: Date) {
  const { fiscalYear, period } = await findPeriod(tx, entityId, date);
  if (fiscalYear.status === 'CLOSED') throw new AppError(`سال مالی «${fiscalYear.title}» بسته شده است.`);
  if (period.status === 'CLOSED') throw new AppError(`دورهٔ «${period.title}» بسته شده است.`);
  return { fiscalYear, period };
}

/** ایجاد سند یادداشت در یک تراکنش موجود */
export async function createDraftTx(tx: Tx, userId: string, input: VoucherInput) {
  if (input.idempotencyKey) {
    const dup = await tx.voucher.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (dup) return dup;
  }
  const { fiscalYear, period } = await locateDate(tx, input.entityId, input.date);
  const lines = await buildLines(tx, input.entityId, input.lines);
  const draftNo = await nextSequence(tx, `draft:${fiscalYear.id}`);
  const total = lines.reduce((s, l) => s + (l.debit as bigint), 0n);
  const v = await tx.voucher.create({
    data: {
      entityId: input.entityId,
      fiscalYearId: fiscalYear.id,
      periodId: period.id,
      draftNo,
      date: input.date,
      type: input.type ?? 'NORMAL',
      description: input.description?.trim() || null,
      sourceModule: input.sourceModule ?? null,
      sourceRef: input.sourceRef ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      totalAmount: total,
      createdById: userId,
      lines: { createMany: { data: lines } },
    },
  });
  await writeAudit(tx, { userId, action: 'voucher.create', objectType: 'Voucher', objectId: v.id, entityId: v.entityId, data: { draftNo, date: formatJ(input.date, false), total } });
  return v;
}

export async function createDraft(db: PrismaClient, userId: string, input: VoucherInput) {
  return db.$transaction((tx) => createDraftTx(tx, userId, input), TX_OPTS);
}

export async function updateDraft(db: PrismaClient, userId: string, voucherId: string, input: Omit<VoucherInput, 'entityId'>) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "vouchers" WHERE id = ${voucherId} FOR UPDATE`;
    const v = await tx.voucher.findUniqueOrThrow({ where: { id: voucherId } });
    if (v.status === 'POSTED') throw new AppError('سند قطعی قابل ویرایش نیست.');
    if (v.sourceModule) throw new AppError('این سند توسط زیرسیستم صادر شده و دستی ویرایش نمی‌شود.');
    const { fiscalYear, period } = await locateDate(tx, v.entityId, input.date);
    const lines = await buildLines(tx, v.entityId, input.lines);
    const draftNo = fiscalYear.id === v.fiscalYearId ? v.draftNo : await nextSequence(tx, `draft:${fiscalYear.id}`);
    await tx.voucherLine.deleteMany({ where: { voucherId } });
    const total = lines.reduce((s, l) => s + (l.debit as bigint), 0n);
    const updated = await tx.voucher.update({
      where: { id: voucherId },
      data: {
        fiscalYearId: fiscalYear.id,
        periodId: period.id,
        draftNo,
        date: input.date,
        type: input.type ?? v.type,
        description: input.description?.trim() || null,
        totalAmount: total,
        status: 'DRAFT',
        reviewedById: null,
        lines: { createMany: { data: lines } },
      },
    });
    await writeAudit(tx, { userId, action: 'voucher.update', objectType: 'Voucher', objectId: voucherId, entityId: v.entityId, data: { date: formatJ(input.date, false), total, lines: lines.length } });
    return updated;
  }, TX_OPTS);
}

export async function setReviewed(db: PrismaClient, userId: string, voucherId: string, reviewed: boolean) {
  return db.$transaction(async (tx) => {
    const v = await tx.voucher.findUniqueOrThrow({ where: { id: voucherId } });
    if (v.status === 'POSTED') throw new AppError('سند قطعی شده است.');
    await tx.voucher.update({
      where: { id: voucherId },
      data: { status: reviewed ? 'REVIEWED' : 'DRAFT', reviewedById: reviewed ? userId : null },
    });
    await writeAudit(tx, { userId, action: reviewed ? 'voucher.review' : 'voucher.unreview', objectType: 'Voucher', objectId: voucherId, entityId: v.entityId });
  });
}

export async function deleteDraft(db: PrismaClient, userId: string, voucherId: string) {
  return db.$transaction(async (tx) => {
    const v = await tx.voucher.findUniqueOrThrow({ where: { id: voucherId } });
    if (v.status === 'POSTED') throw new AppError('سند قطعی حذف نمی‌شود؛ سند برگشت صادر کنید.');
    await tx.voucher.delete({ where: { id: voucherId } });
    await writeAudit(tx, { userId, action: 'voucher.delete', objectType: 'Voucher', objectId: voucherId, entityId: v.entityId, data: { draftNo: v.draftNo } });
  });
}

/** قطعی کردن سند در تراکنش موجود — همهٔ کنترل‌های نهایی اینجاست. */
export async function postTx(tx: Tx, userId: string, voucherId: string, opts: { allowLockedPeriod?: boolean } = {}) {
  await tx.$queryRaw`SELECT id FROM "vouchers" WHERE id = ${voucherId} FOR UPDATE`;
  const v = await tx.voucher.findUniqueOrThrow({
    where: { id: voucherId },
    include: {
      lines: { include: { dimensionSet: { include: { items: true } } }, orderBy: { lineNo: 'asc' } },
      period: true,
      fiscalYear: true,
      entity: true,
    },
  });
  if (v.status === 'POSTED') throw new AppError('سند قبلاً قطعی شده است.');
  if (v.fiscalYear.status === 'CLOSED') throw new AppError('سال مالی بسته شده است.');
  if (v.period.status === 'CLOSED' || (v.period.status === 'LOCKED' && !opts.allowLockedPeriod)) {
    throw new AppError(`دورهٔ «${v.period.title}» قفل است؛ ابتدا دوره را باز کنید.`);
  }
  if (v.lines.length < 2) throw new AppError('سند باید حداقل دو ردیف داشته باشد.');

  let debit = 0n, credit = 0n;
  for (const l of v.lines) {
    debit += l.debit;
    credit += l.credit;
  }
  if (debit !== credit) {
    throw new AppError(`سند تراز نیست: بدهکار ${formatMoney(debit)} و بستانکار ${formatMoney(credit)}.`);
  }

  const chart = await loadChart(tx, v.entity.chartId);
  const types = await tx.dimensionType.findMany();
  const typeName = new Map(types.map((t) => [t.id, t.name]));
  for (const l of v.lines) {
    const acc = chart.get(l.accountId)!;
    if (!acc.active || !acc.isPostable) throw new AppError(`ردیف ${l.lineNo}: حساب «${acc.name}» قابل ثبت نیست.`);
    const present = new Set(l.dimensionSet.items.map((i) => i.typeId));
    for (const r of chart.effectiveRules(acc.id)) {
      if (r.requirement === 'REQUIRED' && !present.has(r.dimensionTypeId)) {
        throw new AppError(`ردیف ${l.lineNo}: برای حساب «${acc.code} ${acc.name}» تعیین «${typeName.get(r.dimensionTypeId)}» الزامی است.`);
      }
      if (r.requirement === 'FORBIDDEN' && present.has(r.dimensionTypeId)) {
        throw new AppError(`ردیف ${l.lineNo}: حساب «${acc.code} ${acc.name}» نباید «${typeName.get(r.dimensionTypeId)}» داشته باشد.`);
      }
    }
  }

  const number = await nextSequence(tx, `voucher:${v.fiscalYearId}`);
  const dailyNo = await nextSequence(tx, `daily:${v.fiscalYearId}:${dateKey(v.date)}`);
  await tx.voucher.update({
    where: { id: voucherId },
    data: { status: 'POSTED', number, dailyNo, postedById: userId, postedAt: new Date(), totalAmount: debit },
  });

  await tx.$executeRaw`
    INSERT INTO "gl_balances" ("entityId", "periodId", "accountId", "dimensionSetId", "debit", "credit")
    SELECT ${v.entityId}, ${v.periodId}, "accountId", "dimensionSetId", SUM("debit"), SUM("credit")
    FROM "voucher_lines" WHERE "voucherId" = ${voucherId}
    GROUP BY "accountId", "dimensionSetId"
    ON CONFLICT ("periodId", "accountId", "dimensionSetId")
    DO UPDATE SET "debit" = "gl_balances"."debit" + EXCLUDED."debit", "credit" = "gl_balances"."credit" + EXCLUDED."credit"`;

  await writeAudit(tx, { userId, action: 'voucher.post', objectType: 'Voucher', objectId: voucherId, entityId: v.entityId, data: { number, total: debit } });
  return { number };
}

export async function postVoucher(db: PrismaClient, userId: string, voucherId: string) {
  return db.$transaction((tx) => postTx(tx, userId, voucherId), TX_OPTS);
}

/** ایجاد و قطعی کردن یکجا — برای زیرسیستم‌ها و سایت‌ها (با کلید idempotency) */
export async function createAndPostTx(tx: Tx, userId: string, input: VoucherInput, opts?: { allowLockedPeriod?: boolean }) {
  const v = await createDraftTx(tx, userId, input);
  if (v.status !== 'POSTED') await postTx(tx, userId, v.id, opts);
  return tx.voucher.findUniqueOrThrow({ where: { id: v.id } });
}

/** سند برگشت: ردیف‌های معکوس با همان ابعاد، و قطعی کردن آن */
export async function reverseVoucher(db: PrismaClient, userId: string, voucherId: string, date: Date, description?: string) {
  return db.$transaction(async (tx) => {
    const v = await tx.voucher.findUniqueOrThrow({
      where: { id: voucherId },
      include: { lines: { include: { dimensionSet: { include: { items: true } } }, orderBy: { lineNo: 'asc' } }, reversedBy: true },
    });
    if (v.status !== 'POSTED') throw new AppError('فقط سند قطعی قابل برگشت است؛ یادداشت را ویرایش یا حذف کنید.');
    if (v.reversedBy) throw new AppError(`این سند قبلاً با سند شمارهٔ ${v.reversedBy.number ?? v.reversedBy.draftNo} برگشت خورده است.`);
    if (v.type === 'REVERSAL') throw new AppError('سند برگشت را نمی‌توان دوباره برگشت زد؛ سند جدید ثبت کنید.');
    if (['OPENING', 'PL_CLOSING', 'CLOSING'].includes(v.type)) throw new AppError('اسناد افتتاحیه و اختتامیه دستی برگشت نمی‌خورند.');

    const rev = await createDraftTx(tx, userId, {
      entityId: v.entityId,
      date,
      type: 'REVERSAL',
      description: description?.trim() || `برگشت سند شمارهٔ ${v.number} مورخ ${formatJ(v.date)}${v.description ? ` — ${v.description}` : ''}`,
      lines: v.lines.map((l) => ({
        accountId: l.accountId,
        debit: l.credit,
        credit: l.debit,
        description: l.description,
        dims: Object.fromEntries(l.dimensionSet.items.map((i) => [i.typeId, i.valueId])),
        currency: l.currency,
        fxAmount: l.fxAmount?.toString(),
        fxRate: l.fxRate?.toString(),
        quantity: l.quantity?.toString(),
        unit: l.unit,
        dueDate: l.dueDate,
      })),
    });
    await tx.voucher.update({ where: { id: rev.id }, data: { reversalOfId: v.id } });
    await postTx(tx, userId, rev.id);
    return rev;
  }, TX_OPTS);
}

/**
 * مرتب‌سازی شمارهٔ اسناد قطعی بر اساس تاریخ (افتتاحیه اول، اختتامیه آخر).
 * trigger دیتابیس فقط تغییر شماره را روی سند قطعی مجاز می‌داند.
 */
export async function renumberVouchers(db: PrismaClient, userId: string, fiscalYearId: string) {
  return db.$transaction(async (tx) => {
    const fy = await tx.fiscalYear.findUniqueOrThrow({ where: { id: fiscalYearId } });
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'voucher:' + fiscalYearId}))`;
    await tx.$executeRaw`UPDATE "vouchers" SET "number" = -"number" WHERE "fiscalYearId" = ${fiscalYearId} AND "status" = 'POSTED'`;
    const changed = await tx.$executeRaw`
      UPDATE "vouchers" v SET "number" = r.rn, "dailyNo" = r.dn
      FROM (
        SELECT id,
          ROW_NUMBER() OVER (ORDER BY CASE "type" WHEN 'OPENING' THEN 0 WHEN 'PL_CLOSING' THEN 2 WHEN 'CLOSING' THEN 3 ELSE 1 END, "date", -"number") AS rn,
          ROW_NUMBER() OVER (PARTITION BY "date" ORDER BY CASE "type" WHEN 'OPENING' THEN 0 WHEN 'PL_CLOSING' THEN 2 WHEN 'CLOSING' THEN 3 ELSE 1 END, -"number") AS dn
        FROM "vouchers" WHERE "fiscalYearId" = ${fiscalYearId} AND "status" = 'POSTED'
      ) r
      WHERE v.id = r.id`;
    await writeAudit(tx, { userId, action: 'voucher.renumber', objectType: 'FiscalYear', objectId: fiscalYearId, entityId: fy.entityId, data: { count: changed } });
    return changed;
  }, TX_OPTS);
}
