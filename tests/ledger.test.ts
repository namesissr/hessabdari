/**
 * تست یکپارچهٔ هستهٔ حسابداری روی PostgreSQL واقعی.
 * اجرا: DATABASE_URL=<دیتابیس تست قابل حذف> bash tests/setup.sh && npm test
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { createDraft, postVoucher, reverseVoucher, updateDraft, deleteDraft, renumberVouchers } from '@/modules/ledger/posting';
import { closeFiscalYear } from '@/modules/ledger/closing';
import { createFiscalYear, suggestNextYear, setPeriodStatus, updateFiscalYear } from '@/modules/fiscal/fiscal';
import { trialBalance, incomeStatement, balanceSheet, ledger, dashboard, dimensionReport } from '@/modules/reports/financial';
import { jToDate } from '@/lib/jalali';

const db = new PrismaClient();
let userId: string, entityId: string, fyId: string;
const acc: Record<string, string> = {};
const dim: Record<string, string> = {};
const type: Record<string, string> = {};
const d = (m: number, day: number) => jToDate(1405, m, day);

before(async () => {
  const u = await db.user.findFirstOrThrow();
  userId = u.id;
  const e = await db.entity.findUniqueOrThrow({ where: { code: 'RAI' } });
  entityId = e.id;
  fyId = (await db.fiscalYear.findFirstOrThrow({ where: { entityId, title: '1405' } })).id;
  for (const a of await db.account.findMany({ where: { chartId: e.chartId } })) acc[a.code] = a.id;
  for (const t of await db.dimensionType.findMany()) type[t.code] = t.id;
  for (const v of await db.dimensionValue.findMany()) dim[v.code] = v.id;
  const bank = await db.dimensionValue.create({ data: { typeId: type.BANK_ACCOUNT, code: 'MELLAT-1', name: 'بانک ملت ۱' } });
  const party = await db.dimensionValue.create({ data: { typeId: type.PARTY, code: 'P-HETZNER', name: 'Hetzner' } });
  const sh = await db.dimensionValue.create({ data: { typeId: type.PARTY, code: 'P-SH1', name: 'سهامدار ۱' } });
  dim.BANK = bank.id;
  dim.HETZNER = party.id;
  dim.SH1 = sh.id;
});

after(async () => db.$disconnect());

const B = (code: string) => ({ [type.BUSINESS]: dim[code] });
const BANK = () => ({ [type.BANK_ACCOUNT]: dim.BANK });

test('سند تراز قطعی می‌شود و شمارهٔ بدون فاصله می‌گیرد', async () => {
  const v = await createDraft(db, userId, {
    entityId, date: d(1, 1), description: 'آورده نقدی سهامداران',
    lines: [
      { accountId: acc['1101'], debit: 10_000_000_000n, dims: BANK() },
      { accountId: acc['5101'], credit: 10_000_000_000n, dims: { [type.PARTY]: dim.SH1 } },
    ],
  });
  const r = await postVoucher(db, userId, v.id);
  assert.equal(r.number, 1);
});

test('سند ناتراز رد می‌شود', async () => {
  const v = await createDraft(db, userId, {
    entityId, date: d(2, 1),
    lines: [
      { accountId: acc['1101'], debit: 100n, dims: BANK() },
      { accountId: acc['6101'], credit: 90n, dims: B('ARZINO') },
    ],
  });
  await assert.rejects(postVoucher(db, userId, v.id), /تراز نیست/);
  await deleteDraft(db, userId, v.id);
});

test('تفصیلی اجباری کنترل می‌شود (هزینه بدون مرکز هزینه)', async () => {
  const v = await createDraft(db, userId, {
    entityId, date: d(2, 1),
    lines: [
      { accountId: acc['8201'], debit: 500n, dims: B('HQ') },
      { accountId: acc['1101'], credit: 500n, dims: BANK() },
    ],
  });
  await assert.rejects(postVoucher(db, userId, v.id), /مرکز هزینه/);
  await updateDraft(db, userId, v.id, {
    date: d(2, 1),
    lines: [
      { accountId: acc['8201'], debit: 500_000_000n, dims: { ...B('HQ'), [type.COST_CENTER]: dim['400'] } },
      { accountId: acc['1101'], credit: 500_000_000n, dims: BANK() },
    ],
  });
  const r = await postVoucher(db, userId, v.id);
  assert.equal(r.number, 2);
});

test('حساب غیرمعین (کل) قابل ثبت نیست', async () => {
  await assert.rejects(
    createDraft(db, userId, { entityId, date: d(2, 2), lines: [{ accountId: acc['11'], debit: 1n }, { accountId: acc['61'], credit: 1n }] }),
    /قابل ثبت نیست/,
  );
});

test('دیتابیس ویرایش و حذف سند قطعی را رد می‌کند (trigger)', async () => {
  const v = await db.voucher.findFirstOrThrow({ where: { status: 'POSTED' }, include: { lines: true } });
  await assert.rejects(db.voucher.update({ where: { id: v.id }, data: { description: 'hack' } }), /LEDGER_IMMUTABLE/);
  await assert.rejects(db.voucherLine.update({ where: { id: v.lines[0].id }, data: { debit: 1n } }), /LEDGER_IMMUTABLE/);
  await assert.rejects(db.voucher.delete({ where: { id: v.id } }), /LEDGER_IMMUTABLE/);
  await assert.rejects(db.auditLog.deleteMany({}), /AUDIT_IMMUTABLE/);
});

test('سود و زیان به تفکیک کسب‌وکار', async () => {
  const sales: [string, bigint][] = [['ARZINO', 3_000_000_000n], ['BLUEPAL', 2_000_000_000n], ['CHARTINO', 1_000_000_000n], ['FILIMINO', 500_000_000n]];
  for (const [biz, amount] of sales) {
    const v = await createDraft(db, userId, {
      entityId, date: d(3, 10), description: 'فروش ' + biz,
      lines: [
        { accountId: acc['1104'], debit: amount, dims: B(biz) },
        { accountId: acc['6101'], credit: amount, dims: B(biz) },
      ],
    });
    await postVoucher(db, userId, v.id);
  }
  const s = await createDraft(db, userId, {
    entityId, date: d(3, 15),
    lines: [
      { accountId: acc['7101'], debit: 800_000_000n, dims: B('ARZINO') },
      { accountId: acc['3101'], credit: 800_000_000n, dims: { [type.PARTY]: dim.HETZNER } },
    ],
  });
  await postVoucher(db, userId, s.id);

  const is = await incomeStatement(db, { entityIds: [entityId], fiscalYearIds: [fyId], from: d(1, 1), to: d(12, 29), byDimensionTypeId: type.BUSINESS });
  assert.equal(is.totals.netRevenue['__total'], 6_500_000_000n);
  assert.equal(is.totals.netProfit[dim.ARZINO], 2_200_000_000n);
  assert.equal(is.totals.netProfit[dim.HQ], -500_000_000n);
  assert.equal(is.totals.netProfit['__total'], 5_200_000_000n);
});

test('تراز آزمایشی و ترازنامه تراز هستند', async () => {
  const tb = await trialBalance(db, { entityIds: [entityId], fiscalYearIds: [fyId], from: d(1, 1), to: d(12, 29) });
  const roots = tb.filter((r) => r.level === 'GROUP');
  assert.equal(roots.reduce((s, r) => s + r.closingDebit, 0n), roots.reduce((s, r) => s + r.closingCredit, 0n));
  const bs = await balanceSheet(db, { entityIds: [entityId], asOf: d(6, 31) });
  assert.equal(bs.difference, 0n);
  assert.equal(bs.assets, 10_000_000_000n - 500_000_000n + 6_500_000_000n);
});

test('برگشت سند و دفتر معین', async () => {
  const v = await createDraft(db, userId, {
    entityId, date: d(4, 1),
    lines: [
      { accountId: acc['8602'], debit: 1_000_000n, dims: B('HQ') },
      { accountId: acc['1101'], credit: 1_000_000n, dims: BANK() },
    ],
  });
  await postVoucher(db, userId, v.id);
  await reverseVoucher(db, userId, v.id, d(4, 2));
  await assert.rejects(reverseVoucher(db, userId, v.id, d(4, 2)), /قبلاً/);
  const lg = await ledger(db, { entityIds: [entityId], fiscalYearIds: [fyId], accountId: acc['8602'], from: d(1, 1), to: d(12, 29) });
  assert.equal(lg.rows.length, 2);
  assert.equal(lg.closing, 0n);
});

test('قفل دوره جلوی قطعی شدن را می‌گیرد', async () => {
  const period = await db.fiscalPeriod.findFirstOrThrow({ where: { fiscalYearId: fyId, no: 5 } });
  await setPeriodStatus(db, userId, period.id, 'LOCKED');
  const v = await createDraft(db, userId, {
    entityId, date: d(5, 5),
    lines: [
      { accountId: acc['1102'], debit: 10n, dims: BANK() },
      { accountId: acc['1101'], credit: 10n, dims: BANK() },
    ],
  });
  await assert.rejects(postVoucher(db, userId, v.id), /قفل/);
  await setPeriodStatus(db, userId, period.id, 'OPEN');
  await postVoucher(db, userId, v.id);
});

test('مرتب‌سازی شماره‌ها بر اساس تاریخ', async () => {
  const v = await createDraft(db, userId, {
    entityId, date: d(1, 15),
    lines: [
      { accountId: acc['1102'], debit: 20n, dims: BANK() },
      { accountId: acc['1101'], credit: 20n, dims: BANK() },
    ],
  });
  await postVoucher(db, userId, v.id);
  await renumberVouchers(db, userId, fyId);
  const all = await db.voucher.findMany({ where: { fiscalYearId: fyId, status: 'POSTED' }, orderBy: { number: 'asc' } });
  for (let i = 1; i < all.length; i++) assert.ok(all[i].date >= all[i - 1].date);
  assert.deepEqual(all.map((x) => x.number), all.map((_, i) => i + 1));
  assert.equal((await db.voucher.findUniqueOrThrow({ where: { id: v.id } })).number, 2);
});

test('ویرایش تاریخ سال مالی دارای سند ممنوع است', async () => {
  const fy = await db.fiscalYear.findUniqueOrThrow({ where: { id: fyId } });
  await assert.rejects(updateFiscalYear(db, userId, fyId, { title: fy.title, startDate: fy.startDate, endDate: d(12, 1) }), /فقط عنوان/);
});

test('بستن سال: سود به انباشته، اختتامیه و افتتاحیهٔ سال بعد', async () => {
  const nextSug = await suggestNextYear(db, entityId);
  assert.equal(nextSug.title, '1406');
  const next = await createFiscalYear(db, userId, { entityId, ...nextSug });
  const bsBefore = await balanceSheet(db, { entityIds: [entityId], asOf: d(12, 29) });
  await closeFiscalYear(db, userId, fyId);

  const fy = await db.fiscalYear.findUniqueOrThrow({ where: { id: fyId } });
  assert.equal(fy.status, 'CLOSED');
  const bsNext = await balanceSheet(db, { entityIds: [entityId], asOf: next.startDate });
  assert.equal(bsNext.assets, bsBefore.assets);
  assert.equal(bsNext.currentProfit, 0n);
  assert.equal(bsNext.difference, 0n);

  const re = await dimensionReport(db, { entityIds: [entityId], fiscalYearIds: [next.id], dimensionTypeId: type.BUSINESS, accountId: acc['5301'], from: next.startDate, to: next.endDate });
  const arz = re.find((r) => r.valueId === dim.ARZINO)!;
  assert.equal(-arz.balance, 2_200_000_000n);

  await assert.rejects(
    createDraft(db, userId, { entityId, date: d(6, 1), lines: [{ accountId: acc['1102'], debit: 1n, dims: BANK() }, { accountId: acc['1101'], credit: 1n, dims: BANK() }] }),
    /بسته/,
  );
  const dash = await dashboard(db, { entityIds: [entityId], asOf: next.startDate });
  assert.ok(dash);
  assert.equal(dash!.assets, dash!.liabilities + dash!.equity);
});

test('کلید idempotency سند تکراری نمی‌سازد', async () => {
  const input = {
    entityId, date: jToDate(1406, 1, 5), idempotencyKey: 'arzino:order:1001', sourceModule: 'ingest',
    lines: [
      { accountId: acc['1104'], debit: 1000n, dims: B('ARZINO') },
      { accountId: acc['6101'], credit: 1000n, dims: B('ARZINO') },
    ],
  };
  const a = await createDraft(db, userId, input);
  const b = await createDraft(db, userId, input);
  assert.equal(a.id, b.id);
});

test('بررسی سلامت دفاتر: توازن، پیوستگی شماره و زنجیرهٔ لاگ ممیزی', async () => {
  const { healthChecks } = await import('@/modules/reports/health');
  const fy = await db.fiscalYear.findFirstOrThrow({ where: { entityId }, orderBy: { startDate: 'desc' } });
  const checks = await healthChecks(db, entityId, fy.id);
  const by = (k: string) => checks.find((c) => c.key === k)!;
  assert.equal(by('balance').status, 'ok');
  assert.equal(by('numbering').status, 'ok');
  assert.equal(by('audit').status, 'ok', by('audit').detail);
});
