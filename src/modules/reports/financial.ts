import type { AccountLevel, PrismaClient, VoucherType } from '@prisma/client';
import { AppError } from '@/lib/errors';
import { loadChart, type ChartIndex, type ChartAccount } from '@/modules/accounts/chart';
import { loadSets } from '@/modules/dimensions/sets';
import { buildWhere, sumByAccount, sumByAccountAndDim, sumByAccountAndDate, type LineFilter } from './query';

const CLOSING_TYPES: VoucherType[] = ['CLOSING'];
const ALL_CLOSING: VoucherType[] = ['PL_CLOSING', 'CLOSING'];

/** ماندهٔ «طبیعی»: دارایی/هزینه = بدهکار − بستانکار ؛ سایر = بستانکار − بدهکار */
export function naturalBalance(acc: Pick<ChartAccount, 'category'>, debit: bigint, credit: bigint): bigint {
  return acc.category === 'ASSET' || acc.category === 'EXPENSE' ? debit - credit : credit - debit;
}

/**
 * برای گزارش‌های چندشرکتی: همهٔ شرکت‌ها از قالب چارت مجموعه استفاده می‌کنند؛
 * حساب‌های شرکت‌های دیگر با «کد» به چارت مرجع نگاشت می‌شوند.
 */
async function chartContext(db: PrismaClient, entityIds: string[]) {
  if (!entityIds.length) throw new AppError('هیچ شرکتی انتخاب نشده است.');
  const entities = await db.entity.findMany({ where: { id: { in: entityIds } } });
  const primary = entities.find((e) => e.id === entityIds[0]) ?? entities[0];
  const chart = await loadChart(db, primary.chartId);
  const otherCharts = [...new Set(entities.map((e) => e.chartId))].filter((c) => c !== primary.chartId);
  const remap = new Map<string, string>();
  if (otherCharts.length) {
    const byCode = new Map(chart.accounts.map((a) => [a.code, a.id]));
    const others = await db.account.findMany({ where: { chartId: { in: otherCharts } }, select: { id: true, code: true } });
    for (const o of others) {
      const target = byCode.get(o.code);
      if (target) remap.set(o.id, target);
    }
  }
  const mapId = (id: string) => remap.get(id) ?? id;
  return { chart, mapId, entities };
}

// ───────────────────────── تراز آزمایشی

export type TrialRow = {
  id: string;
  code: string;
  name: string;
  level: AccountLevel;
  depth: number;
  isPostable: boolean;
  openingDebit: bigint;
  openingCredit: bigint;
  debit: bigint;
  credit: bigint;
  closingDebit: bigint;
  closingCredit: bigint;
};

function rollUp(chart: ChartIndex, sums: Map<string, { d: bigint; c: bigint }>) {
  const total = new Map<string, { d: bigint; c: bigint }>();
  for (const [id, s] of sums) {
    for (const aid of [id, ...chart.ancestors(id).map((a) => a.id)]) {
      const t = total.get(aid) ?? { d: 0n, c: 0n };
      t.d += s.d;
      t.c += s.c;
      total.set(aid, t);
    }
  }
  return total;
}

export async function trialBalance(
  db: PrismaClient,
  p: { entityIds: string[]; fiscalYearIds: string[]; from: Date; to: Date; dimValueGroups?: string[][]; includeClosing?: boolean; includeDrafts?: boolean },
) {
  const { chart, mapId } = await chartContext(db, p.entityIds);
  const base: LineFilter = {
    entityIds: p.entityIds,
    fiscalYearIds: p.fiscalYearIds,
    dimValueGroups: p.dimValueGroups,
    excludeTypes: p.includeClosing ? [] : ALL_CLOSING,
    includeDrafts: p.includeDrafts,
  };
  const [openRows, turnRows] = await Promise.all([
    sumByAccount(db, { ...base, before: p.from }),
    sumByAccount(db, { ...base, from: p.from, to: p.to }),
  ]);
  const toMap = (rows: { accountId: string; debit: bigint; credit: bigint }[]) => {
    const m = new Map<string, { d: bigint; c: bigint }>();
    for (const r of rows) {
      const id = mapId(r.accountId);
      const x = m.get(id) ?? { d: 0n, c: 0n };
      x.d += r.debit;
      x.c += r.credit;
      m.set(id, x);
    }
    return m;
  };
  const open = rollUp(chart, toMap(openRows));
  const turn = rollUp(chart, toMap(turnRows));

  const rows: TrialRow[] = [];
  for (const { account: a, depth } of chart.walk()) {
    const o = open.get(a.id) ?? { d: 0n, c: 0n };
    const t = turn.get(a.id) ?? { d: 0n, c: 0n };
    if (o.d === 0n && o.c === 0n && t.d === 0n && t.c === 0n) continue;
    const ob = o.d - o.c;
    const cb = ob + t.d - t.c;
    rows.push({
      id: a.id,
      code: a.code,
      name: a.name,
      level: a.level,
      depth,
      isPostable: a.isPostable,
      openingDebit: ob > 0n ? ob : 0n,
      openingCredit: ob < 0n ? -ob : 0n,
      debit: t.d,
      credit: t.c,
      closingDebit: cb > 0n ? cb : 0n,
      closingCredit: cb < 0n ? -cb : 0n,
    });
  }
  return rows;
}

// ───────────────────────── دفتر کل / معین / تفصیلی

export async function ledger(
  db: PrismaClient,
  p: { entityIds: string[]; fiscalYearIds: string[]; accountId?: string | null; from: Date; to: Date; dimValueGroups?: string[][]; includeClosing?: boolean; limit?: number },
) {
  const { chart } = await chartContext(db, p.entityIds);
  let accountIds: string[] | undefined;
  if (p.accountId) {
    const acc = chart.get(p.accountId);
    if (!acc) throw new AppError('حساب پیدا نشد.');
    // همهٔ حساب‌های هم‌کد در شرکت‌های دیگر نیز
    const codes = chart.descendantIds(acc.id).map((id) => chart.get(id)!.code);
    const ents = await db.entity.findMany({ where: { id: { in: p.entityIds } }, select: { chartId: true } });
    const same = await db.account.findMany({ where: { chartId: { in: ents.map((e) => e.chartId) }, code: { in: codes } }, select: { id: true } });
    accountIds = same.map((a) => a.id);
  }
  const base: LineFilter = {
    entityIds: p.entityIds,
    fiscalYearIds: p.fiscalYearIds,
    accountIds,
    dimValueGroups: p.dimValueGroups,
    excludeTypes: p.includeClosing ? [] : ALL_CLOSING,
  };
  const openRows = await sumByAccount(db, { ...base, before: p.from });
  const opening = openRows.reduce((s, r) => s + r.debit - r.credit, 0n);

  const where = await buildWhere(db, { ...base, from: p.from, to: p.to });
  const limit = p.limit ?? 5000;
  const lines = await db.$queryRaw<
    { id: string; voucherId: string; number: number | null; draftNo: number; date: Date; type: string; vdesc: string | null; description: string | null; accountId: string; dimensionSetId: number; debit: bigint; credit: bigint }[]
  >`
    SELECT l.id, v.id AS "voucherId", v."number", v."draftNo", v."date", v."type"::text AS type, v."description" AS vdesc,
           l."description", l."accountId", l."dimensionSetId", l."debit", l."credit"
    FROM "voucher_lines" l JOIN "vouchers" v ON v.id = l."voucherId"
    WHERE ${where}
    ORDER BY v."date", CASE v."type" WHEN 'OPENING' THEN 0 ELSE 1 END, v."number", l."lineNo"
    LIMIT ${limit + 1}`;
  const truncated = lines.length > limit;
  const shown = lines.slice(0, limit);
  const sets = await loadSets(db, shown.map((l) => l.dimensionSetId));
  const accounts = await db.account.findMany({ where: { id: { in: [...new Set(shown.map((l) => l.accountId))] } }, select: { id: true, code: true, name: true } });
  const accById = new Map(accounts.map((a) => [a.id, a]));
  let running = opening;
  let totalD = 0n, totalC = 0n;
  const rows = shown.map((l) => {
    running += l.debit - l.credit;
    totalD += l.debit;
    totalC += l.credit;
    return { ...l, account: accById.get(l.accountId)!, dims: sets.get(l.dimensionSetId) ?? [], balance: running };
  });
  return { opening, rows, totalDebit: totalD, totalCredit: totalC, closing: running, truncated };
}

// ───────────────────────── دفتر روزنامه

export async function journal(db: PrismaClient, p: { entityIds: string[]; from: Date; to: Date; level: 'GL' | 'SUBSIDIARY'; includeClosing?: boolean }) {
  const { chart } = await chartContext(db, p.entityIds);
  const vouchers = await db.voucher.findMany({
    where: {
      entityId: { in: p.entityIds },
      status: 'POSTED',
      date: { gte: p.from, lte: p.to },
      ...(p.includeClosing ? {} : { type: { notIn: ALL_CLOSING } }),
    },
    include: { lines: { orderBy: { lineNo: 'asc' }, include: { account: true } } },
    orderBy: [{ date: 'asc' }, { number: 'asc' }],
    take: 1000,
  });
  const sets = await loadSets(db, vouchers.flatMap((v) => v.lines.map((l) => l.dimensionSetId)));
  return vouchers.map((v) => {
    let lines: { code: string; name: string; description: string | null; dims: string; debit: bigint; credit: bigint }[];
    if (p.level === 'GL') {
      const m = new Map<string, { code: string; name: string; debit: bigint; credit: bigint }>();
      for (const l of v.lines) {
        const gl = chart.atLevel(l.accountId, 'GL') ?? chart.get(l.accountId) ?? l.account;
        const key = `${gl.code}|${l.debit > 0n ? 'd' : 'c'}`;
        const x = m.get(key) ?? { code: gl.code, name: gl.name, debit: 0n, credit: 0n };
        x.debit += l.debit;
        x.credit += l.credit;
        m.set(key, x);
      }
      lines = [...m.values()].sort((a, b) => Number(b.debit > 0n) - Number(a.debit > 0n)).map((x) => ({ ...x, description: null, dims: '' }));
    } else {
      lines = v.lines.map((l) => ({
        code: l.account.code,
        name: l.account.name,
        description: l.description,
        dims: (sets.get(l.dimensionSetId) ?? []).map((d) => d.valueName).join(' / '),
        debit: l.debit,
        credit: l.credit,
      }));
    }
    return { id: v.id, number: v.number, date: v.date, type: v.type, description: v.description, lines, total: v.totalAmount };
  });
}

// ───────────────────────── گزارش تفصیلی (مانده به تفکیک مقادیر یک بُعد)

export async function dimensionReport(
  db: PrismaClient,
  p: { entityIds: string[]; fiscalYearIds: string[]; dimensionTypeId: string; accountId?: string | null; from: Date; to: Date; includeClosing?: boolean },
) {
  const { chart, mapId } = await chartContext(db, p.entityIds);
  const allowed = p.accountId ? new Set(chart.descendantIds(p.accountId)) : null;
  const base: LineFilter = { entityIds: p.entityIds, fiscalYearIds: p.fiscalYearIds, excludeTypes: p.includeClosing ? [] : ALL_CLOSING };
  const [openRows, turnRows] = await Promise.all([
    sumByAccountAndDim(db, { ...base, before: p.from }, p.dimensionTypeId),
    sumByAccountAndDim(db, { ...base, from: p.from, to: p.to }, p.dimensionTypeId),
  ]);
  const acc = new Map<string, { opening: bigint; debit: bigint; credit: bigint }>();
  const add = (rows: typeof openRows, kind: 'open' | 'turn') => {
    for (const r of rows) {
      if (allowed && !allowed.has(mapId(r.accountId))) continue;
      const key = r.valueId ?? '';
      const x = acc.get(key) ?? { opening: 0n, debit: 0n, credit: 0n };
      if (kind === 'open') x.opening += r.debit - r.credit;
      else {
        x.debit += r.debit;
        x.credit += r.credit;
      }
      acc.set(key, x);
    }
  };
  add(openRows, 'open');
  add(turnRows, 'turn');
  const values = await db.dimensionValue.findMany({ where: { id: { in: [...acc.keys()].filter(Boolean) } } });
  const vById = new Map(values.map((v) => [v.id, v]));
  return [...acc.entries()]
    .map(([id, x]) => ({
      valueId: id || null,
      code: id ? vById.get(id)?.code ?? '' : '',
      name: id ? vById.get(id)?.name ?? '' : 'بدون تفصیلی',
      ...x,
      balance: x.opening + x.debit - x.credit,
    }))
    .filter((r) => r.opening !== 0n || r.debit !== 0n || r.credit !== 0n)
    .sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }));
}

// ───────────────────────── صورت سود و زیان

export type ISSectionKey = 'OPERATING_REVENUE' | 'CONTRA_REVENUE' | 'COGS' | 'OPEX' | 'OTHER_INCOME' | 'FINANCE' | 'OTHER_EXPENSE' | 'TAX';

export const IS_SECTIONS: { key: ISSectionKey; label: string; sign: 1 | -1 }[] = [
  { key: 'OPERATING_REVENUE', label: 'درآمدهای عملیاتی', sign: 1 },
  { key: 'CONTRA_REVENUE', label: 'برگشت از فروش و تخفیفات', sign: -1 },
  { key: 'COGS', label: 'بهای تمام‌شدهٔ خدمات', sign: -1 },
  { key: 'OPEX', label: 'هزینه‌های عملیاتی', sign: -1 },
  { key: 'OTHER_INCOME', label: 'سایر درآمدها', sign: 1 },
  { key: 'FINANCE', label: 'هزینه‌های مالی', sign: -1 },
  { key: 'OTHER_EXPENSE', label: 'سایر هزینه‌ها', sign: -1 },
  { key: 'TAX', label: 'مالیات بر درآمد', sign: -1 },
];

function sectionOf(chart: ChartIndex, id: string): ISSectionKey | null {
  const acc = chart.get(id);
  if (!acc || (acc.category !== 'REVENUE' && acc.category !== 'EXPENSE')) return null;
  for (const s of IS_SECTIONS) if (chart.hasTag(id, s.key)) return s.key;
  return acc.category === 'REVENUE' ? 'OPERATING_REVENUE' : 'OPEX';
}

export type ISColumn = { key: string; label: string };
export type ISResult = {
  columns: ISColumn[];
  sections: { key: ISSectionKey; label: string; sign: 1 | -1; rows: { id: string; code: string; name: string; values: Record<string, bigint> }[]; total: Record<string, bigint> }[];
  totals: Record<'netRevenue' | 'grossProfit' | 'operatingProfit' | 'profitBeforeTax' | 'netProfit' | 'revenue' | 'expense', Record<string, bigint>>;
};

/**
 * سود و زیان — اختیاری به تفکیک مقادیر یک بُعد (معمولاً کسب‌وکار) در ستون‌ها.
 * مبالغ ستون‌ها «مثبت = به نفع سود» نیستند؛ هر بخش مقدار طبیعی خودش را دارد و sign در جمع‌ها اعمال می‌شود.
 */
export async function incomeStatement(
  db: PrismaClient,
  p: { entityIds: string[]; fiscalYearIds?: string[]; from: Date; to: Date; byDimensionTypeId?: string | null; dimValueGroups?: string[][] },
): Promise<ISResult> {
  const { chart, mapId } = await chartContext(db, p.entityIds);
  const filter: LineFilter = { entityIds: p.entityIds, fiscalYearIds: p.fiscalYearIds, from: p.from, to: p.to, excludeTypes: ALL_CLOSING, dimValueGroups: p.dimValueGroups };
  const TOTAL = '__total';
  const NONE = '__none';
  let rows: { accountId: string; valueId: string | null; debit: bigint; credit: bigint }[];
  let columns: ISColumn[] = [];
  if (p.byDimensionTypeId) {
    rows = (await sumByAccountAndDim(db, filter, p.byDimensionTypeId)).filter((r) => sectionOf(chart, mapId(r.accountId)) !== null);
    const values = await db.dimensionValue.findMany({ where: { typeId: p.byDimensionTypeId }, orderBy: { code: 'asc' } });
    const used = new Set(rows.map((r) => r.valueId));
    columns = values.filter((v) => used.has(v.id) || v.active).map((v) => ({ key: v.id, label: v.name }));
    if (used.has(null)) columns.push({ key: NONE, label: 'تخصیص‌نیافته' });
  } else {
    rows = (await sumByAccount(db, filter)).map((r) => ({ ...r, valueId: null }));
  }
  columns.push({ key: TOTAL, label: 'جمع' });

  const glRows = new Map<string, { id: string; code: string; name: string; section: ISSectionKey; values: Record<string, bigint> }>();
  for (const r of rows) {
    const id = mapId(r.accountId);
    const section = sectionOf(chart, id);
    if (!section) continue;
    const acc = chart.get(id)!;
    const gl = chart.atLevel(id, 'GL') ?? acc;
    const amount = naturalBalance(acc, r.debit, r.credit);
    const row = glRows.get(gl.id + section) ?? { id: gl.id, code: gl.code, name: gl.name, section, values: {} };
    const col = p.byDimensionTypeId ? r.valueId ?? NONE : TOTAL;
    // برای حساب برگشت فروش (ماهیت بدهکار زیر درآمد) مبلغ مثبت یعنی کاهش درآمد
    const v = section === 'CONTRA_REVENUE' && acc.category === 'REVENUE' ? -amount : amount;
    row.values[col] = (row.values[col] ?? 0n) + v;
    if (col !== TOTAL) row.values[TOTAL] = (row.values[TOTAL] ?? 0n) + v;
    glRows.set(gl.id + section, row);
  }

  const zero = () => Object.fromEntries(columns.map((c) => [c.key, 0n])) as Record<string, bigint>;
  const sections = IS_SECTIONS.map((s) => {
    const sr = [...glRows.values()].filter((r) => r.section === s.key).sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }));
    const total = zero();
    for (const r of sr) for (const c of columns) total[c.key] += r.values[c.key] ?? 0n;
    return { ...s, rows: sr.map(({ section: _s, ...rest }) => rest), total };
  });
  const sec = (k: ISSectionKey) => sections.find((s) => s.key === k)!.total;
  const combine = (fn: (k: string) => bigint) => Object.fromEntries(columns.map((c) => [c.key, fn(c.key)])) as Record<string, bigint>;
  const netRevenue = combine((k) => sec('OPERATING_REVENUE')[k] - sec('CONTRA_REVENUE')[k]);
  const grossProfit = combine((k) => netRevenue[k] - sec('COGS')[k]);
  const operatingProfit = combine((k) => grossProfit[k] - sec('OPEX')[k]);
  const profitBeforeTax = combine((k) => operatingProfit[k] + sec('OTHER_INCOME')[k] - sec('FINANCE')[k] - sec('OTHER_EXPENSE')[k]);
  const netProfit = combine((k) => profitBeforeTax[k] - sec('TAX')[k]);
  const revenue = combine((k) => netRevenue[k] + sec('OTHER_INCOME')[k]);
  const expense = combine((k) => sec('COGS')[k] + sec('OPEX')[k] + sec('FINANCE')[k] + sec('OTHER_EXPENSE')[k] + sec('TAX')[k]);
  return { columns, sections, totals: { netRevenue, grossProfit, operatingProfit, profitBeforeTax, netProfit, revenue, expense } };
}

// ───────────────────────── ترازنامه

/** سال مالیِ شامل تاریخ برای هر شرکت */
export async function fiscalYearsAt(db: PrismaClient, entityIds: string[], date: Date) {
  return db.fiscalYear.findMany({ where: { entityId: { in: entityIds }, startDate: { lte: date }, endDate: { gte: date } } });
}

export async function balanceSheet(db: PrismaClient, p: { entityIds: string[]; asOf: Date }) {
  const { chart, mapId } = await chartContext(db, p.entityIds);
  const fys = await fiscalYearsAt(db, p.entityIds, p.asOf);
  if (!fys.length) throw new AppError('برای این تاریخ سال مالی تعریف نشده است.');
  const sums = await sumByAccount(db, { entityIds: p.entityIds, fiscalYearIds: fys.map((f) => f.id), to: p.asOf, excludeTypes: CLOSING_TYPES });

  const byGl = new Map<string, bigint>();
  let currentProfit = 0n;
  for (const s of sums) {
    const id = mapId(s.accountId);
    const acc = chart.get(id);
    if (!acc) continue;
    if (acc.category === 'REVENUE' || acc.category === 'EXPENSE') {
      currentProfit += s.credit - s.debit;
      continue;
    }
    if (acc.category === 'MEMO') continue;
    const gl = chart.atLevel(id, 'GL') ?? acc;
    byGl.set(gl.id, (byGl.get(gl.id) ?? 0n) + naturalBalance(acc, s.debit, s.credit));
  }

  const groups = chart.roots
    .filter((r) => ['ASSET', 'LIABILITY', 'EQUITY'].includes(r.category))
    .map((root) => {
      const rows = chart
        .descendantIds(root.id)
        .map((id) => chart.get(id)!)
        .filter((a) => a.level === 'GL' && byGl.has(a.id) && byGl.get(a.id) !== 0n)
        .sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }))
        .map((a) => ({ id: a.id, code: a.code, name: a.name, amount: byGl.get(a.id)! }));
      return { id: root.id, code: root.code, name: root.name, category: root.category, rows, total: rows.reduce((s, r) => s + r.amount, 0n) };
    });
  const sumCat = (c: string) => groups.filter((g) => g.category === c).reduce((s, g) => s + g.total, 0n);
  const assets = sumCat('ASSET');
  const liabilities = sumCat('LIABILITY');
  const equity = sumCat('EQUITY') + currentProfit;
  return { asOf: p.asOf, fiscalYears: fys, groups, currentProfit, assets, liabilities, equity, difference: assets - liabilities - equity };
}

// ───────────────────────── داشبورد

export const KPI_TAGS = ['CASH', 'RECEIVABLE', 'PAYABLE', 'LOAN', 'INVESTMENT', 'FIXED_ASSET', 'DEFERRED_REVENUE'] as const;

export async function dashboard(db: PrismaClient, p: { entityIds: string[]; asOf: Date }) {
  const { chart, mapId } = await chartContext(db, p.entityIds);
  const fys = await fiscalYearsAt(db, p.entityIds, p.asOf);
  if (!fys.length) return null;
  const fyIds = fys.map((f) => f.id);
  const from = new Date(Math.min(...fys.map((f) => f.startDate.getTime())));

  const sums = await sumByAccount(db, { entityIds: p.entityIds, fiscalYearIds: fyIds, to: p.asOf, excludeTypes: CLOSING_TYPES });
  const kpi: Record<string, bigint> = Object.fromEntries(KPI_TAGS.map((t) => [t, 0n]));
  let assets = 0n, liabilities = 0n, equity = 0n, currentProfit = 0n;
  const cashAccounts = new Map<string, bigint>();
  for (const s of sums) {
    const id = mapId(s.accountId);
    const acc = chart.get(id);
    if (!acc) continue;
    const nat = naturalBalance(acc, s.debit, s.credit);
    if (acc.category === 'ASSET') assets += nat;
    else if (acc.category === 'LIABILITY') liabilities += nat;
    else if (acc.category === 'EQUITY') equity += nat;
    else if (acc.category === 'REVENUE' || acc.category === 'EXPENSE') currentProfit += s.credit - s.debit;
    for (const t of KPI_TAGS) if (chart.hasTag(id, t)) kpi[t] += nat;
    if (chart.hasTag(id, 'CASH')) cashAccounts.set(id, (cashAccounts.get(id) ?? 0n) + nat);
  }

  const businessType = await db.dimensionType.findUnique({ where: { code: 'BUSINESS' } });
  const is = await incomeStatement(db, { entityIds: p.entityIds, fiscalYearIds: fyIds, from, to: p.asOf, byDimensionTypeId: businessType?.id });

  // روند ماهانه بر اساس دوره‌های سال مالی شرکت اول
  const periods = await db.fiscalPeriod.findMany({ where: { fiscalYearId: fys[0].id }, orderBy: { no: 'asc' } });
  const daily = await sumByAccountAndDate(db, { entityIds: p.entityIds, fiscalYearIds: fyIds, to: p.asOf, excludeTypes: ['PL_CLOSING', 'CLOSING'] });
  const trend = periods.map((pr) => ({ title: pr.title, start: pr.startDate, revenue: 0n, expense: 0n }));
  for (const d of daily) {
    const id = mapId(d.accountId);
    const acc = chart.get(id);
    if (!acc || (acc.category !== 'REVENUE' && acc.category !== 'EXPENSE')) continue;
    const bucket = periods.findIndex((pr) => d.date >= pr.startDate && d.date <= pr.endDate);
    if (bucket < 0) continue;
    if (acc.category === 'REVENUE') trend[bucket].revenue += d.credit - d.debit;
    else trend[bucket].expense += d.debit - d.credit;
  }

  const cashList = [...cashAccounts.entries()]
    .filter(([, v]) => v !== 0n)
    .map(([id, amount]) => ({ id, code: chart.get(id)!.code, name: chart.get(id)!.name, amount }))
    .sort((a, b) => a.code.localeCompare(b.code));

  return {
    fiscalYears: fys,
    from,
    kpi,
    assets,
    liabilities,
    equity: equity + currentProfit,
    incomeStatement: is,
    trend,
    cashList,
  };
}
