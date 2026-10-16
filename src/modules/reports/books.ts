import type { AccountLevel, PrismaClient, VoucherType } from '@prisma/client';
import { loadChart } from '@/modules/accounts/chart';
import { buildWhere, sumByAccount, type LineFilter } from './query';

/**
 * دفاتر قانونی: دفتر کل (در سطح حساب کل) و دفتر معین.
 * هر حساب یک «صفحه» دارد: ماندهٔ ابتدای دوره، ردیف‌ها (خلاصهٔ ماهانه یا سند به سند) و ماندهٔ پایان.
 */

const ALL_CLOSING: VoucherType[] = ['PL_CLOSING', 'CLOSING'];

export type BookRow = {
  key: string;
  label: string;
  date: Date | null;
  voucherId: string | null;
  number: number | null;
  description: string | null;
  debit: bigint;
  credit: bigint;
  balance: bigint;
};

export type BookAccount = {
  id: string;
  code: string;
  name: string;
  parentCode: string | null;
  parentName: string | null;
  opening: bigint;
  rows: BookRow[];
  totalDebit: bigint;
  totalCredit: bigint;
  closing: bigint;
};

export async function ledgerBook(
  db: PrismaClient,
  p: {
    entityIds: string[];
    fiscalYearIds: string[];
    from: Date;
    to: Date;
    level: Extract<AccountLevel, 'GL' | 'SUBSIDIARY'>;
    /** محدود کردن به یک حساب (و زیرمجموعه‌هایش) */
    accountId?: string | null;
    mode: 'period' | 'voucher';
    dimValueGroups?: string[][];
    includeClosing?: boolean;
  },
): Promise<BookAccount[]> {
  const entity = await db.entity.findUniqueOrThrow({ where: { id: p.entityIds[0] } });
  const chart = await loadChart(db, entity.chartId);
  const scope = p.accountId ? new Set(chart.descendantIds(p.accountId)) : null;

  const base: LineFilter = {
    entityIds: p.entityIds,
    fiscalYearIds: p.fiscalYearIds,
    dimValueGroups: p.dimValueGroups,
    excludeTypes: p.includeClosing ? [] : ALL_CLOSING,
  };

  /** حساب هدف (کل یا معین) برای یک حساب ثبت‌شده در سند */
  const target = (accountId: string) => {
    if (scope && !scope.has(accountId)) return null;
    return chart.atLevel(accountId, p.level) ?? null;
  };

  const openingRows = await sumByAccount(db, { ...base, before: p.from });
  const opening = new Map<string, bigint>();
  for (const r of openingRows) {
    const t = target(r.accountId);
    if (!t) continue;
    opening.set(t.id, (opening.get(t.id) ?? 0n) + r.debit - r.credit);
  }

  const where = await buildWhere(db, { ...base, from: p.from, to: p.to });
  type Agg = { accountId: string; debit: bigint; credit: bigint };
  const perAccount = new Map<string, BookRow[]>();

  if (p.mode === 'period') {
    const periods = await db.fiscalPeriod.findMany({ where: { fiscalYearId: { in: p.fiscalYearIds } }, orderBy: [{ fiscalYearId: 'asc' }, { no: 'asc' }] });
    const rows = await db.$queryRaw<(Agg & { periodId: string })[]>`
      SELECT l."accountId", v."periodId", COALESCE(SUM(l."debit"),0)::bigint AS debit, COALESCE(SUM(l."credit"),0)::bigint AS credit
      FROM "voucher_lines" l JOIN "vouchers" v ON v.id = l."voucherId"
      WHERE ${where}
      GROUP BY l."accountId", v."periodId"`;
    const byTarget = new Map<string, Map<string, { d: bigint; c: bigint }>>();
    for (const r of rows) {
      const t = target(r.accountId);
      if (!t) continue;
      const m = byTarget.get(t.id) ?? new Map();
      const x = m.get(r.periodId) ?? { d: 0n, c: 0n };
      x.d += r.debit;
      x.c += r.credit;
      m.set(r.periodId, x);
      byTarget.set(t.id, m);
    }
    for (const [accId, m] of byTarget) {
      const list: BookRow[] = [];
      for (const per of periods) {
        const x = m.get(per.id);
        if (!x || (x.d === 0n && x.c === 0n)) continue;
        list.push({ key: `${accId}:${per.id}`, label: per.title, date: per.startDate, voucherId: null, number: null, description: 'گردش ماه', debit: x.d, credit: x.c, balance: 0n });
      }
      perAccount.set(accId, list);
    }
  } else {
    const rows = await db.$queryRaw<(Agg & { voucherId: string; number: number | null; date: Date; vdesc: string | null })[]>`
      SELECT l."accountId", v.id AS "voucherId", v."number", v."date", v."description" AS vdesc,
             COALESCE(SUM(l."debit"),0)::bigint AS debit, COALESCE(SUM(l."credit"),0)::bigint AS credit
      FROM "voucher_lines" l JOIN "vouchers" v ON v.id = l."voucherId"
      WHERE ${where}
      GROUP BY l."accountId", v.id, v."number", v."date", v."description"
      ORDER BY v."date", v."number"`;
    const byTarget = new Map<string, Map<string, BookRow>>();
    for (const r of rows) {
      const t = target(r.accountId);
      if (!t) continue;
      const m = byTarget.get(t.id) ?? new Map<string, BookRow>();
      const prev = m.get(r.voucherId);
      if (prev) {
        prev.debit += r.debit;
        prev.credit += r.credit;
      } else {
        m.set(r.voucherId, {
          key: `${t.id}:${r.voucherId}`,
          label: '',
          date: r.date,
          voucherId: r.voucherId,
          number: r.number,
          description: r.vdesc,
          debit: r.debit,
          credit: r.credit,
          balance: 0n,
        });
      }
      byTarget.set(t.id, m);
    }
    for (const [accId, m] of byTarget) {
      perAccount.set(
        accId,
        [...m.values()].sort((a, b) => (a.date!.getTime() - b.date!.getTime()) || (a.number ?? 0) - (b.number ?? 0)),
      );
    }
  }

  const ids = new Set<string>([...perAccount.keys(), ...opening.keys()]);
  const out: BookAccount[] = [];
  for (const id of ids) {
    const acc = chart.get(id);
    if (!acc) continue;
    const parent = acc.parentId ? chart.get(acc.parentId) : null;
    let balance = opening.get(id) ?? 0n;
    let totalDebit = 0n, totalCredit = 0n;
    const rows = (perAccount.get(id) ?? []).map((r) => {
      balance += r.debit - r.credit;
      totalDebit += r.debit;
      totalCredit += r.credit;
      return { ...r, balance };
    });
    out.push({
      id,
      code: acc.code,
      name: acc.name,
      parentCode: parent?.code ?? null,
      parentName: parent?.name ?? null,
      opening: opening.get(id) ?? 0n,
      rows,
      totalDebit,
      totalCredit,
      closing: balance,
    });
  }
  return out.sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }));
}
