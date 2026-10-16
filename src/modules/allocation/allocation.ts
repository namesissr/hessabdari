import { Prisma, type AllocationMethod, type PrismaClient } from '@prisma/client';
import { AppError } from '@/lib/errors';
import { writeAudit } from '@/lib/audit';
import { createAndPostTx, type LineInput } from '@/modules/ledger/posting';
import { dimTypeIds } from '@/modules/treasury/accounts';

type Tx = Prisma.TransactionClient;

export const METHOD_LABEL: Record<AllocationMethod, string> = {
  FIXED: 'درصد ثابت',
  EQUAL: 'تقسیم مساوی',
  REVENUE_SHARE: 'به نسبت درآمد دوره',
};

export type AllocationWeights = Record<string, number>; // dimensionValueId → درصد

/** سهم هر کسب‌وکار از هزینهٔ مشترک در یک دوره */
async function shares(
  tx: Tx,
  rule: { method: AllocationMethod; weights: AllocationWeights | null; entityId: string; sourceBusinessDimId: string | null },
  period: { startDate: Date; endDate: Date },
  businessTypeId: string,
): Promise<{ valueId: string; weight: number }[]> {
  if (rule.method === 'FIXED') {
    const w = Object.entries(rule.weights ?? {}).filter(([, v]) => Number(v) > 0);
    if (!w.length) throw new AppError('برای روش «درصد ثابت» باید سهم هر کسب‌وکار مشخص شود.');
    const sum = w.reduce((s, [, v]) => s + Number(v), 0);
    if (Math.abs(sum - 100) > 0.01) throw new AppError(`جمع درصدها باید ۱۰۰ باشد (الان ${sum}).`);
    return w.map(([valueId, v]) => ({ valueId, weight: Number(v) }));
  }

  const targets = await tx.dimensionValue.findMany({
    where: { typeId: businessTypeId, active: true, id: rule.sourceBusinessDimId ? { not: rule.sourceBusinessDimId } : undefined },
  });
  if (!targets.length) throw new AppError('کسب‌وکاری برای تسهیم پیدا نشد.');

  if (rule.method === 'EQUAL') {
    return targets.map((t) => ({ valueId: t.id, weight: 100 / targets.length }));
  }

  // REVENUE_SHARE: درآمد عملیاتی هر کسب‌وکار در همان دوره
  const rows = await tx.$queryRaw<{ valueId: string; revenue: bigint }[]>`
    SELECT i."valueId", COALESCE(SUM(l."credit" - l."debit"), 0)::bigint AS revenue
    FROM "voucher_lines" l
    JOIN "vouchers" v ON v.id = l."voucherId"
    JOIN "accounts" a ON a.id = l."accountId"
    JOIN "dimension_set_items" i ON i."setId" = l."dimensionSetId" AND i."typeId" = ${businessTypeId}
    WHERE v."status" = 'POSTED' AND v."entityId" = ${rule.entityId}
      AND v."date" BETWEEN ${period.startDate}::date AND ${period.endDate}::date
      AND v."type"::text NOT IN ('PL_CLOSING','CLOSING','ALLOCATION')
      AND a."category"::text = 'REVENUE'
    GROUP BY i."valueId"`;
  const positive = rows.filter((r) => r.revenue > 0n && targets.some((t) => t.id === r.valueId));
  const total = positive.reduce((s, r) => s + r.revenue, 0n);
  if (total === 0n) throw new AppError('در این دوره درآمدی ثبت نشده؛ روش «به نسبت درآمد» قابل محاسبه نیست.');
  return positive.map((r) => ({ valueId: r.valueId, weight: Number((r.revenue * 10000n) / total) / 100 }));
}

/** اجرای تسهیم برای یک دوره: هزینهٔ ستاد به کسب‌وکارها منتقل می‌شود */
export async function runAllocation(db: PrismaClient, userId: string, ruleId: string, periodId: string, opts: { preview?: boolean } = {}) {
  return db.$transaction(async (tx) => {
    const rule = await tx.allocationRule.findUniqueOrThrow({ where: { id: ruleId } });
    if (!rule.active) throw new AppError('این قانون تسهیم غیرفعال است.');
    const period = await tx.fiscalPeriod.findUniqueOrThrow({ where: { id: periodId }, include: { fiscalYear: true } });
    if (period.fiscalYear.entityId !== rule.entityId) throw new AppError('دوره متعلق به شرکت دیگری است.');
    const existing = await tx.allocationRun.findUnique({ where: { ruleId_periodId: { ruleId, periodId } } });
    if (existing && !opts.preview) throw new AppError('تسهیم این دوره قبلاً انجام شده است.');

    const dims = await dimTypeIds(tx);
    if (!rule.accountCodes.length) throw new AppError('برای این قانون هیچ حسابی انتخاب نشده است.');

    // مبلغ قابل تسهیم: مانده حساب‌های انتخاب‌شده با کسب‌وکار مبدأ (ستاد) در این دوره
    const sourceFilter = rule.sourceBusinessDimId
      ? Prisma.sql`AND EXISTS (SELECT 1 FROM "dimension_set_items" si WHERE si."setId" = l."dimensionSetId" AND si."typeId" = ${dims.BUSINESS} AND si."valueId" = ${rule.sourceBusinessDimId})`
      : Prisma.empty;
    const sourceRows = await tx.$queryRaw<{ accountId: string; dimensionSetId: number; amount: bigint }[]>`
      SELECT l."accountId", l."dimensionSetId", COALESCE(SUM(l."debit" - l."credit"), 0)::bigint AS amount
      FROM "voucher_lines" l
      JOIN "vouchers" v ON v.id = l."voucherId"
      JOIN "accounts" a ON a.id = l."accountId"
      WHERE v."status" = 'POSTED' AND v."entityId" = ${rule.entityId}
        AND v."date" BETWEEN ${period.startDate}::date AND ${period.endDate}::date
        AND v."type"::text <> 'ALLOCATION'
        AND (${Prisma.join(rule.accountCodes.map((c) => Prisma.sql`a."code" LIKE ${c + '%'}`), ' OR ')})
        ${sourceFilter}
      GROUP BY l."accountId", l."dimensionSetId"
      HAVING COALESCE(SUM(l."debit" - l."credit"), 0) <> 0`;

    // ابعاد اصلی هر ردیف (مرکز هزینه، پروژه و…) حفظ می‌شوند و فقط «کسب‌وکار» عوض می‌شود،
    // وگرنه سند تسهیم قوانین تفصیلی اجباری حساب‌ها را نقض می‌کند.
    const setItems = await tx.dimensionSetItem.findMany({ where: { setId: { in: [...new Set(sourceRows.map((r) => r.dimensionSetId))] } } });
    const setDims = new Map<number, Record<string, string>>();
    for (const it of setItems) setDims.set(it.setId, { ...(setDims.get(it.setId) ?? {}), [it.typeId]: it.valueId });

    const total = sourceRows.reduce((s, r) => s + r.amount, 0n);
    if (total <= 0n) throw new AppError('در این دوره هزینهٔ قابل تسهیمی وجود ندارد.');

    const parts = await shares(tx, { method: rule.method, weights: rule.weights as AllocationWeights | null, entityId: rule.entityId, sourceBusinessDimId: rule.sourceBusinessDimId }, period, dims.BUSINESS);
    const values = await tx.dimensionValue.findMany({ where: { id: { in: parts.map((p) => p.valueId) } } });
    const nameOf = new Map(values.map((v) => [v.id, v.name]));

    const lines: LineInput[] = [];
    const detail: { valueId: string; name: string; weight: number; amount: string }[] = [];

    const perTarget = new Map<string, bigint>();
    for (const row of sourceRows) {
      const baseDims = setDims.get(row.dimensionSetId) ?? {};
      // بستانکار کردن حساب در مبدأ با همان ابعاد اصلی
      lines.push({ accountId: row.accountId, credit: row.amount, dims: baseDims, description: 'تسهیم هزینهٔ مشترک' });
      // بدهکار کردن سهم هر کسب‌وکار (باقی‌ماندهٔ گِرد کردن در ردیف آخر)
      let assigned = 0n;
      parts.forEach((p, idx) => {
        const share = idx === parts.length - 1 ? row.amount - assigned : (row.amount * BigInt(Math.round(p.weight * 100))) / 10000n;
        assigned += share;
        if (share === 0n) return;
        lines.push({ accountId: row.accountId, debit: share, dims: { ...baseDims, [dims.BUSINESS]: p.valueId }, description: `سهم ${nameOf.get(p.valueId) ?? ''}` });
        perTarget.set(p.valueId, (perTarget.get(p.valueId) ?? 0n) + share);
      });
    }

    for (const p of parts) {
      detail.push({ valueId: p.valueId, name: nameOf.get(p.valueId) ?? '', weight: p.weight, amount: (perTarget.get(p.valueId) ?? 0n).toString() });
    }

    if (opts.preview) return { preview: true as const, total, detail, lines: lines.length };

    const voucher = await createAndPostTx(tx, userId, {
      entityId: rule.entityId,
      date: period.endDate,
      type: 'ALLOCATION',
      sourceModule: 'allocation',
      sourceRef: rule.id,
      idempotencyKey: `allocation:${rule.id}:${periodId}`,
      description: `تسهیم «${rule.name}» — ${period.title}`,
      lines,
    });

    const run = await tx.allocationRun.create({
      data: { ruleId, entityId: rule.entityId, periodId, voucherId: voucher.id, totalAmount: total, detail: detail as object, createdById: userId },
    });
    await writeAudit(tx, { userId, action: 'allocation.run', objectType: 'AllocationRule', objectId: ruleId, entityId: rule.entityId, data: { period: period.title, total, voucherId: voucher.id } });
    return { preview: false as const, run, total, detail };
  }, { maxWait: 10000, timeout: 120000 });
}

export async function saveRule(
  db: PrismaClient,
  userId: string,
  input: { id?: string | null; entityId: string; name: string; method: AllocationMethod; sourceBusinessDimId: string | null; accountCodes: string[]; weights: AllocationWeights | null; active: boolean },
) {
  if (!input.name.trim()) throw new AppError('نام قانون تسهیم الزامی است.');
  if (!input.accountCodes.length) throw new AppError('حداقل یک کد حساب برای تسهیم انتخاب کنید.');
  for (const c of input.accountCodes) if (!/^\d{1,6}$/.test(c)) throw new AppError(`کد حساب «${c}» معتبر نیست.`);
  return db.$transaction(async (tx) => {
    const data = {
      entityId: input.entityId,
      name: input.name.trim(),
      method: input.method,
      sourceBusinessDimId: input.sourceBusinessDimId,
      accountCodes: input.accountCodes,
      weights: (input.weights ?? undefined) as object | undefined,
      active: input.active,
    };
    const rule = input.id ? await tx.allocationRule.update({ where: { id: input.id }, data }) : await tx.allocationRule.create({ data });
    await writeAudit(tx, { userId, action: input.id ? 'allocation_rule.update' : 'allocation_rule.create', objectType: 'AllocationRule', objectId: rule.id, entityId: input.entityId, data: { name: rule.name } });
    return rule;
  });
}

export async function deleteRule(db: PrismaClient, userId: string, id: string) {
  return db.$transaction(async (tx) => {
    const runs = await tx.allocationRun.count({ where: { ruleId: id } });
    if (runs) throw new AppError('برای این قانون تسهیم اجرا شده است؛ به‌جای حذف غیرفعالش کنید.');
    const rule = await tx.allocationRule.delete({ where: { id } });
    await writeAudit(tx, { userId, action: 'allocation_rule.delete', objectType: 'AllocationRule', objectId: id, entityId: rule.entityId, data: { name: rule.name } });
  });
}
