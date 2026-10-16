/**
 * تست یکپارچهٔ فاکتور و تطبیق، اتصال سایت‌ها، تسهیم و قالب سند.
 * اجرا: DATABASE_URL=<دیتابیس تست خالی> bash tests/setup.sh && npx tsx --test tests/sales-ingest.test.ts
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { saveParty, saveBankAccount } from '@/modules/treasury/masters';
import { saveTreasury, postTreasury } from '@/modules/treasury/treasury';
import { agingReport, cancelInvoice, computeLines, openInvoices, postInvoice, saveInvoice, settleInvoice } from '@/modules/sales/invoices';
import { ingestEvent, saveSource, hashSecret, findSourceByKey, retryEvent } from '@/modules/ingest/engine';
import { runAllocation, saveRule } from '@/modules/allocation/allocation';
import { createFromTemplate, saveTemplate } from '@/modules/ledger/templates';
import { dateToJ, jToDate } from '@/lib/jalali';

const db = new PrismaClient();
let userId: string, entityId: string, chartId: string;
const acc: Record<string, string> = {};
const dim: Record<string, string> = {};
const type: Record<string, string> = {};
let customer: string, supplier: string, bankId: string, bankCode: string;
let jy = 1405;
const d = (m: number, day: number) => jToDate(jy, m, day);
const baseline = new Map<string, bigint>();
const at = (m: number, day: number) => d(m, day).toISOString();

async function rawBalance(code: string): Promise<bigint> {
  const rows = await db.$queryRaw<{ b: bigint }[]>`
    SELECT COALESCE(SUM(l."debit" - l."credit"), 0)::bigint AS b
    FROM "voucher_lines" l JOIN "vouchers" v ON v.id = l."voucherId" JOIN "accounts" a ON a.id = l."accountId"
    WHERE v."status" = 'POSTED' AND a."code" = ${code}`;
  return rows[0].b;
}
async function balance(code: string) {
  return (await rawBalance(code)) - (baseline.get(code) ?? 0n);
}

before(async () => {
  userId = (await db.user.findFirstOrThrow()).id;
  const e = await db.entity.findUniqueOrThrow({ where: { code: 'RAI' } });
  entityId = e.id;
  chartId = e.chartId;
  for (const a of await db.account.findMany({ where: { chartId } })) acc[a.code] = a.id;
  for (const t of await db.dimensionType.findMany()) type[t.code] = t.id;
  for (const v of await db.dimensionValue.findMany()) dim[v.code] = v.id;

  const c = await saveParty(db, userId, { name: 'مشتری فاکتوری', kind: 'COMPANY', roles: ['CUSTOMER'] });
  const s = await saveParty(db, userId, { name: 'تأمین‌کنندهٔ فاکتوری', kind: 'COMPANY', roles: ['SUPPLIER'] });
  customer = c.id;
  supplier = s.id;
  const b = await saveBankAccount(db, userId, { entityId, name: 'بانک تسویه', kind: 'BANK', bankName: 'ملت', glAccountId: acc['1101'] });
  bankId = b.id;
  bankCode = (await db.dimensionValue.findUniqueOrThrow({ where: { id: b.dimensionValueId } })).code;

  const fy = await db.fiscalYear.findFirstOrThrow({ where: { entityId, status: 'OPEN' }, orderBy: { startDate: 'asc' } });
  jy = dateToJ(fy.startDate).jy;
  for (const code of ['1101', '1104', '1301', '1503', '3101', '3201', '3302', '6101', '6201', '7103', '7106', '8201', '8101']) {
    baseline.set(code, await rawBalance(code));
  }
});

after(async () => db.$disconnect());

// ───────────────────────── فاکتور

test('محاسبهٔ ردیف فاکتور با تخفیف و مالیات ارزش افزوده', () => {
  const r = computeLines([
    { title: 'اشتراک یک‌ساله', accountId: 'x', quantity: 2, unitPrice: '5000000', discount: '1000000', taxRate: 10 },
    { title: 'راه‌اندازی', accountId: 'y', quantity: 1, unitPrice: '2000000', taxRate: 10 },
  ]);
  assert.equal(r.subtotal, 12_000_000n);
  assert.equal(r.discount, 1_000_000n);
  assert.equal(r.taxAmount, 900_000n + 200_000n);
  assert.equal(r.total, 12_000_000n - 1_000_000n + 1_100_000n);
});

test('فاکتور فروش: دریافتنی بدهکار، درآمد و مالیات بستانکار', async () => {
  const inv = await saveInvoice(db, userId, {
    entityId,
    type: 'SALES',
    date: d(2, 5),
    dueDate: d(3, 5),
    partyId: customer,
    businessDimId: dim.ARZINO,
    description: 'فروش اشتراک',
    lines: [{ title: 'اشتراک یک‌ساله', accountId: acc['6101'], quantity: 1, unitPrice: '100000000', taxRate: 10, businessDimId: dim.ARZINO }],
  });
  await postInvoice(db, userId, inv.id);
  const posted = await db.invoice.findUniqueOrThrow({ where: { id: inv.id } });
  assert.equal(posted.status, 'POSTED');
  assert.equal(posted.total, 110_000_000n);
  assert.equal(await balance('1301'), 110_000_000n);
  assert.equal(await balance('6101'), -100_000_000n);
  assert.equal(await balance('3201'), -10_000_000n);
  const v = await db.voucher.findUniqueOrThrow({ where: { id: posted.voucherId! }, include: { lines: true } });
  assert.equal(v.lines.reduce((s, l) => s + l.debit, 0n), v.lines.reduce((s, l) => s + l.credit, 0n));
});

test('فاکتور خرید: هزینه و مالیات بدهکار، پرداختنی بستانکار', async () => {
  const inv = await saveInvoice(db, userId, {
    entityId,
    type: 'PURCHASE',
    date: d(2, 7),
    partyId: supplier,
    businessDimId: dim.HQ,
    lines: [{ title: 'اجارهٔ دفتر', accountId: acc['8201'], quantity: 1, unitPrice: '50000000', taxRate: 10, businessDimId: dim.HQ, costCenterDimId: dim['400'] }],
  });
  await postInvoice(db, userId, inv.id);
  assert.equal(await balance('8201'), 50_000_000n);
  assert.equal(await balance('1503'), 5_000_000n);
  assert.equal(await balance('3101'), -55_000_000n);
});

test('تطبیق دریافت با فاکتور و به‌روزرسانی مانده', async () => {
  const inv = await db.invoice.findFirstOrThrow({ where: { type: 'SALES', status: 'POSTED' } });
  const open = await openInvoices(db, entityId, customer, 'RECEIVABLE');
  assert.equal(open.length, 1);

  const txn = await saveTreasury(db, userId, {
    entityId,
    type: 'RECEIPT',
    date: d(3, 1),
    partyId: customer,
    businessDimId: dim.ARZINO,
    items: [{ method: 'BANK', bankAccountId: bankId, amount: 60_000_000n }],
    allocations: [{ accountId: acc['1301'], partyId: customer, businessDimId: dim.ARZINO, invoiceId: inv.id, amount: 60_000_000n }],
  });
  await postTreasury(db, userId, txn.id);

  const after = await db.invoice.findUniqueOrThrow({ where: { id: inv.id }, include: { settlements: true } });
  assert.equal(after.settledAmount, 60_000_000n);
  assert.equal(after.settlements.length, 1);
  assert.equal(after.settlements[0].treasuryTxnId, txn.id);

  await settleInvoice(db, userId, { invoiceId: inv.id, amount: 50_000_000n, date: d(3, 2), note: 'تسویهٔ نقدی' });
  const full = await db.invoice.findUniqueOrThrow({ where: { id: inv.id } });
  assert.equal(full.settledAmount, 110_000_000n);
  await assert.rejects(settleInvoice(db, userId, { invoiceId: inv.id, amount: 1n, date: d(3, 3) }), /مانده/);
});

test('گزارش سنی بدهکاران بر اساس سررسید', async () => {
  const inv = await saveInvoice(db, userId, {
    entityId,
    type: 'SALES',
    date: d(1, 10),
    dueDate: d(1, 20),
    partyId: customer,
    businessDimId: dim.BLUEPAL,
    lines: [{ title: 'خدمات', accountId: acc['6102'], quantity: 1, unitPrice: '30000000', taxRate: 0, businessDimId: dim.BLUEPAL }],
  });
  await postInvoice(db, userId, inv.id);
  const rows = await agingReport(db, { entityIds: [entityId], side: 'RECEIVABLE', asOf: d(3, 10) });
  const row = rows.find((r) => r.partyId === customer)!;
  assert.equal(row.total, 30_000_000n);
  assert.equal(row.buckets.d60, 30_000_000n);
  assert.equal(row.buckets.current, 0n);
});

test('ابطال فاکتور قطعی‌شده سند برگشت می‌زند', async () => {
  const inv = await saveInvoice(db, userId, {
    entityId,
    type: 'SALES',
    date: d(4, 1),
    partyId: customer,
    businessDimId: dim.ARZINO,
    lines: [{ title: 'اشتباه', accountId: acc['6101'], quantity: 1, unitPrice: '7000000', taxRate: 0, businessDimId: dim.ARZINO }],
  });
  await postInvoice(db, userId, inv.id);
  const before = await balance('1301');
  await cancelInvoice(db, userId, inv.id, d(4, 2));
  assert.equal(await balance('1301'), before - 7_000_000n);
  assert.equal((await db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status, 'CANCELLED');
});

// ───────────────────────── اتصال سایت‌ها

test('رویداد فروش سایت سند می‌خورد و تکراری ثبت نمی‌شود', async () => {
  const { source, secret } = await saveSource(db, userId, {
    code: 'ARZINOO',
    name: 'ارزینو',
    entityId,
    businessDimId: dim.ARZINO,
    config: { bankAccountCode: bankCode },
    active: true,
  });
  assert.ok(secret);
  assert.equal((await findSourceByKey(db, secret!))?.id, source.id);
  assert.equal((await findSourceByKey(db, 'wrong-key')), null);
  assert.equal(source.secretHash, hashSecret(secret!));

  const r1 = await ingestEvent(db, source.id, { type: 'order.paid', externalId: 'arz-1001', amount: '11000000', tax: '1000000', description: 'سفارش ۱۰۰۱', occurredAt: at(5, 10) });
  assert.equal(r1.duplicate, false);
  assert.ok(r1.voucherId);
  assert.equal(await balance('1104'), 11_000_000n);
  assert.equal(await balance('6101'), -110_000_000n); // ۱۰۰ فاکتور + ۱۰ رویداد سایت (فاکتور ابطالی خنثی شده)

  const r2 = await ingestEvent(db, source.id, { type: 'order.paid', externalId: 'arz-1001', amount: '11000000', tax: '1000000', occurredAt: at(5, 10) });
  assert.equal(r2.duplicate, true);
  assert.equal(r2.voucherId, r1.voucherId);
  assert.equal(await db.ingestEvent.count({ where: { sourceId: source.id } }), 1);
});

test('تسویهٔ درگاه، کیف پول و استرداد', async () => {
  const source = await db.ingestSource.findFirstOrThrow({ where: { code: 'ARZINOO' } });
  await ingestEvent(db, source.id, { type: 'wallet.topup', externalId: 'arz-w1', amount: '5000000', occurredAt: at(5, 11) });
  assert.equal(await balance('3302'), -5_000_000n);
  await ingestEvent(db, source.id, { type: 'wallet.consumed', externalId: 'arz-w2', amount: '2200000', tax: '200000', occurredAt: at(5, 12) });
  assert.equal(await balance('3302'), -2_800_000n);

  await ingestEvent(db, source.id, { type: 'gateway.settled', externalId: 'arz-s1', amount: '11000000', fee: '110000', occurredAt: at(5, 13) });
  assert.equal(await balance('7103'), 110_000n);
  assert.equal(await balance('1104'), 5_000_000n); // فروش و شارژ کیف پول منهای تسویهٔ درگاه

  await ingestEvent(db, source.id, { type: 'refund.issued', externalId: 'arz-r1', amount: '1100000', tax: '100000', occurredAt: at(5, 14) });
  assert.equal(await balance('6201'), 1_000_000n);
});

test('رویداد نامعتبر ثبت می‌شود، خطا می‌گیرد و بعد از اصلاح قابل اجرای دوباره است', async () => {
  const { source } = await saveSource(db, userId, { code: 'BLUEPAL', name: 'بلوپال', entityId, businessDimId: dim.BLUEPAL, config: {}, active: true });
  await assert.rejects(
    ingestEvent(db, source.id, { type: 'gateway.settled', externalId: 'bp-1', amount: '1000000', occurredAt: at(5, 15) }),
    /حساب بانکی/,
  );
  const failed = await db.ingestEvent.findFirstOrThrow({ where: { sourceId: source.id, externalId: 'bp-1' } });
  assert.equal(failed.status, 'FAILED');

  await db.ingestSource.update({ where: { id: source.id }, data: { config: { bankAccountCode: bankCode } } });
  const r = await retryEvent(db, userId, failed.id);
  assert.ok(r.voucherId);
  assert.equal((await db.ingestEvent.findUniqueOrThrow({ where: { id: failed.id } })).status, 'POSTED');
});

// ───────────────────────── تسهیم

test('تسهیم هزینهٔ ستاد به نسبت درآمد کسب‌وکارها', async () => {
  // هزینهٔ ستاد
  const txn = await saveTreasury(db, userId, {
    entityId,
    type: 'PAYMENT',
    date: d(2, 20),
    businessDimId: dim.HQ,
    partyId: supplier,
    items: [{ method: 'BANK', bankAccountId: bankId, amount: 40_000_000n }],
    allocations: [{ accountId: acc['8201'], businessDimId: dim.HQ, costCenterDimId: dim['400'], amount: 40_000_000n }],
  });
  await postTreasury(db, userId, txn.id);

  const rule = await saveRule(db, userId, {
    entityId,
    name: 'تسهیم هزینه‌های اداری ستاد',
    method: 'REVENUE_SHARE',
    sourceBusinessDimId: dim.HQ,
    accountCodes: ['82'],
    weights: null,
    active: true,
  });
  const fy = await db.fiscalYear.findFirstOrThrow({ where: { entityId, status: 'OPEN' }, orderBy: { startDate: 'asc' } });
  const period = await db.fiscalPeriod.findFirstOrThrow({ where: { fiscalYearId: fy.id, no: 2 } });

  const preview = await runAllocation(db, userId, rule.id, period.id, { preview: true });
  assert.equal(preview.preview, true);
  assert.ok(preview.total > 0n);

  const run = await runAllocation(db, userId, rule.id, period.id);
  assert.equal(run.preview, false);
  const voucher = await db.voucher.findUniqueOrThrow({ where: { id: run.run!.voucherId! }, include: { lines: true } });
  assert.equal(voucher.type, 'ALLOCATION');
  assert.equal(voucher.lines.reduce((s, l) => s + l.debit, 0n), voucher.lines.reduce((s, l) => s + l.credit, 0n));

  // بعد از تسهیم، هزینهٔ اداری ستاد در آن دوره صفر می‌شود و بین کسب‌وکارها پخش می‌شود
  const hqAfter = await db.$queryRaw<{ b: bigint }[]>`
    SELECT COALESCE(SUM(l."debit" - l."credit"),0)::bigint AS b
    FROM "voucher_lines" l JOIN "vouchers" v ON v.id = l."voucherId" JOIN "accounts" a ON a.id = l."accountId"
    JOIN "dimension_set_items" i ON i."setId" = l."dimensionSetId" AND i."typeId" = ${type.BUSINESS}
    WHERE v."status" = 'POSTED' AND a."code" LIKE '82%' AND i."valueId" = ${dim.HQ}
      AND v."date" BETWEEN ${period.startDate}::date AND ${period.endDate}::date`;
  assert.equal(hqAfter[0].b, 0n);

  await assert.rejects(runAllocation(db, userId, rule.id, period.id), /قبلاً انجام شده/);
});

// ───────────────────────── قالب سند

test('قالب سند: ساخت سند با مبلغ متغیر و کنترل تراز', async () => {
  const tpl = await saveTemplate(db, userId, {
    entityId,
    name: 'حقوق ماهانه',
    voucherType: 'NORMAL',
    recurrence: 'MONTHLY',
    dayOfMonth: 28,
    active: true,
    lines: [
      { accountId: acc['8101'], side: 'DEBIT', amount: '', dims: { [type.BUSINESS]: dim.HQ, [type.COST_CENTER]: dim['400'] }, description: 'حقوق' },
      { accountId: acc['3204'], side: 'CREDIT', amount: '', dims: { [type.PARTY]: (await db.party.findFirstOrThrow({ where: { id: supplier } })).dimensionValueId }, description: 'حقوق پرداختنی' },
    ],
  });

  const v = await createFromTemplate(db, userId, tpl.id, { date: d(5, 28), amounts: { 0: '250000000', 1: '250000000' } });
  assert.equal(v.status, 'DRAFT');
  const lines = await db.voucherLine.findMany({ where: { voucherId: v.id } });
  assert.equal(lines.length, 2);
  assert.equal(lines.reduce((s, l) => s + l.debit, 0n), 250_000_000n);

  await assert.rejects(createFromTemplate(db, userId, tpl.id, { date: d(5, 28), amounts: { 0: '250000000', 1: '240000000' } }), /تراز نیست/);
  await assert.rejects(createFromTemplate(db, userId, tpl.id, { date: d(5, 28) }), /مبلغ ردیف/);
});

test('رویداد مربوط به دورهٔ بسته با خطای روشن رد و برای پیگیری ذخیره می‌شود', async () => {
  const source = await db.ingestSource.findFirstOrThrow({ where: { code: 'ARZINOO' } });
  const closed = await db.fiscalYear.findFirst({ where: { entityId, status: 'CLOSED' } });
  if (!closed) return; // اگر سال بسته‌ای وجود ندارد این سناریو موضوعیت ندارد
  await assert.rejects(
    ingestEvent(db, source.id, { type: 'order.paid', externalId: 'arz-closed', amount: '1000000', occurredAt: closed.startDate.toISOString() }),
    /بسته شده/,
  );
  const ev = await db.ingestEvent.findFirstOrThrow({ where: { sourceId: source.id, externalId: 'arz-closed' } });
  assert.equal(ev.status, 'FAILED');
  assert.match(ev.error ?? '', /بسته شده/);
});
