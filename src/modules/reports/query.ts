import { Prisma, type PrismaClient, type VoucherType } from '@prisma/client';
import { expandDimensionValues } from '@/modules/dimensions/sets';

export type LineFilter = {
  entityIds: string[];
  fiscalYearIds?: string[];
  from?: Date | null;
  to?: Date | null;
  /** قبل از این تاریخ (برای ماندهٔ ابتدای دوره) */
  before?: Date | null;
  accountIds?: string[];
  /** هر آرایه = مقادیر یک بُعد (OR داخل آرایه، AND بین آرایه‌ها) */
  dimValueGroups?: string[][];
  excludeTypes?: VoucherType[];
  includeDrafts?: boolean;
};

/** شرط WHERE مشترک گزارش‌ها روی voucher_lines l و vouchers v */
export async function buildWhere(db: PrismaClient, f: LineFilter): Promise<Prisma.Sql> {
  const parts: Prisma.Sql[] = [Prisma.sql`v."entityId" = ANY(${f.entityIds})`];
  if (!f.includeDrafts) parts.push(Prisma.sql`v."status" = 'POSTED'`);
  if (f.fiscalYearIds?.length) parts.push(Prisma.sql`v."fiscalYearId" = ANY(${f.fiscalYearIds})`);
  if (f.from) parts.push(Prisma.sql`v."date" >= ${f.from}::date`);
  if (f.to) parts.push(Prisma.sql`v."date" <= ${f.to}::date`);
  if (f.before) parts.push(Prisma.sql`v."date" < ${f.before}::date`);
  if (f.accountIds) parts.push(Prisma.sql`l."accountId" = ANY(${f.accountIds})`);
  if (f.excludeTypes?.length) parts.push(Prisma.sql`v."type"::text <> ALL(${f.excludeTypes as string[]})`);
  for (const group of f.dimValueGroups ?? []) {
    if (!group.length) continue;
    const expanded = await expandDimensionValues(db, group);
    parts.push(Prisma.sql`l."dimensionSetId" IN (SELECT "setId" FROM "dimension_set_items" WHERE "valueId" = ANY(${expanded}))`);
  }
  return Prisma.join(parts, ' AND ');
}

export type AccountSum = { accountId: string; debit: bigint; credit: bigint };

export async function sumByAccount(db: PrismaClient, f: LineFilter): Promise<AccountSum[]> {
  const where = await buildWhere(db, f);
  return db.$queryRaw<AccountSum[]>`
    SELECT l."accountId", COALESCE(SUM(l."debit"),0)::bigint AS debit, COALESCE(SUM(l."credit"),0)::bigint AS credit
    FROM "voucher_lines" l JOIN "vouchers" v ON v.id = l."voucherId"
    WHERE ${where}
    GROUP BY l."accountId"`;
}

export type AccountDimSum = AccountSum & { valueId: string | null };

/** جمع به تفکیک حساب و مقدار یک نوع بُعد (مثلاً کسب‌وکار) */
export async function sumByAccountAndDim(db: PrismaClient, f: LineFilter, dimensionTypeId: string): Promise<AccountDimSum[]> {
  const where = await buildWhere(db, f);
  return db.$queryRaw<AccountDimSum[]>`
    SELECT l."accountId", di."valueId", COALESCE(SUM(l."debit"),0)::bigint AS debit, COALESCE(SUM(l."credit"),0)::bigint AS credit
    FROM "voucher_lines" l
    JOIN "vouchers" v ON v.id = l."voucherId"
    LEFT JOIN "dimension_set_items" di ON di."setId" = l."dimensionSetId" AND di."typeId" = ${dimensionTypeId}
    WHERE ${where}
    GROUP BY l."accountId", di."valueId"`;
}

export type MonthSum = AccountSum & { ym: string };

export async function sumByAccountAndDate(db: PrismaClient, f: LineFilter): Promise<(AccountSum & { date: Date })[]> {
  const where = await buildWhere(db, f);
  return db.$queryRaw<(AccountSum & { date: Date })[]>`
    SELECT l."accountId", v."date", COALESCE(SUM(l."debit"),0)::bigint AS debit, COALESCE(SUM(l."credit"),0)::bigint AS credit
    FROM "voucher_lines" l JOIN "vouchers" v ON v.id = l."voucherId"
    WHERE ${where}
    GROUP BY l."accountId", v."date"`;
}
