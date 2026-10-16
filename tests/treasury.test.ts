/**
 * تست یکپارچهٔ خزانه و چک روی PostgreSQL واقعی.
 * اجرا: DATABASE_URL=<دیتابیس تست خالی> bash tests/setup.sh && npx tsx --test tests/treasury.test.ts
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { saveParty, saveBankAccount, bankBalances } from '@/modules/treasury/masters';
import { saveTreasury, postTreasury, reverseTreasury } from '@/modules/treasury/treasury';
import { chequeEvent, createCheque, allowedEvents } from '@/modules/treasury/cheques';
import { dateToJ, jToDate } from '@/lib/jalali';

const db = new PrismaClient();
let userId: string, entityId: string;
const acc: Record<string, string> = {};
const dim: Record<string, string> = {};
const type: Record<string, string> = {};
let bankA: string, bankB: string, cashBox: string, customer: string, supplier: string;
let bankADim: string, bankBDim: string;
let jy = 1405;
const d = (m: number, day: number) => jToDate(jy, m, day);
const baseline = new Map<string, bigint>();

/** تغییر ماندهٔ یک حساب معین نسبت به شروع این تست‌ها (تا به ترتیب اجرا وابسته نباشد) */
async function balance(code: string): Promise<bigint> {
  return (await rawBalance(code)) - (baseline.get(code) ?? 0n);
}

async function rawBalance(code: string): Promise<bigint> {
  const rows = await db.$queryRaw<{ b: bigint }[]>`
    SELECT COALESCE(SUM(l."debit" - l."credit"), 0)::bigint AS b
    FROM "voucher_lines" l JOIN "vouchers" v ON v.id = l."voucherId" JOIN "accounts" a ON a.id = l."accountId"
    WHERE v."status" = 'POSTED' AND a."code" = ${code}`;
  return rows[0].b;
}

before(async () => {
  userId = (await db.user.findFirstOrThrow()).id;
  const e = await db.entity.findUniqueOrThrow({ where: { code: 'RAI' } });
  entityId = e.id;
  for (const a of await db.account.findMany({ where: { chartId: e.chartId } })) acc[a.code] = a.id;
  for (const t of await db.dimensionType.findMany()) type[t.code] = t.id;
  for (const v of await db.dimensionValue.findMany()) dim[v.code] = v.id;

  const c = await saveParty(db, userId, { name: 'شرکت مشتری نمونه', kind: 'COMPANY', roles: ['CUSTOMER'], nationalCode: '10101234567' });
  const s = await saveParty(db, userId, { name: 'تأمین‌کنندهٔ سرور', kind: 'COMPANY', roles: ['SUPPLIER'] });
  customer = c.id;
  supplier = s.id;
  const b1 = await saveBankAccount(db, userId, { entityId, name: 'بانک ملت — جاری ۱۱۱', kind: 'BANK', bankName: 'ملت', accountNo: '111', glAccountId: acc['1101'] });
  const b2 = await saveBankAccount(db, userId, { entityId, name: 'بانک سامان — جاری ۲۲۲', kind: 'BANK', bankName: 'سامان', accountNo: '222', glAccountId: acc['1101'] });
  const cb = await saveBankAccount(db, userId, { entityId, name: 'صندوق مرکزی', kind: 'CASH', glAccountId: acc['1102'] });
  bankA = b1.id;
  bankB = b2.id;
  cashBox = cb.id;
  bankADim = b1.dimensionValueId;
  bankBDim = b2.dimensionValueId;

  const fy = await db.fiscalYear.findFirstOrThrow({ where: { entityId, status: 'OPEN' }, orderBy: { startDate: 'asc' } });
  jy = dateToJ(fy.startDate).jy;
  for (const code of ['1101', '1102', '1301', '1302', '1303', '3101', '3102', '7101', '8602', '9101', '9201']) {
    baseline.set(code, await rawBalance(code));
  }
});

after(async () => db.$disconnect());

test('دریافت نقدی از مشتری با کارمزد: بانک، کارمزد و حساب دریافتنی', async () => {
  const txn = await saveTreasury(db, userId, {
    entityId,
    type: 'RECEIPT',
    date: d(2, 5),
    partyId: customer,
    businessDimId: dim.ARZINO,
    description: 'دریافت بابت فاکتور ۱۰۱',
    items: [{ method: 'BANK', bankAccountId: bankA, amount: 50_000_000n, feeAmount: 500_000n, reference: 'شبا ۱۲۳' }],
    allocations: [{ accountId: acc['1301'], partyId: customer, businessDimId: dim.ARZINO, amount: 50_000_000n }],
  });
  const posted = await postTreasury(db, userId, txn.id);
  assert.equal(posted.status, 'POSTED');
  assert.ok(posted.voucherId);

  const v = await db.voucher.findUniqueOrThrow({ where: { id: posted.voucherId! }, include: { lines: true } });
  assert.equal(v.status, 'POSTED');
  assert.equal(v.lines.reduce((s, l) => s + l.debit, 0n), v.lines.reduce((s, l) => s + l.credit, 0n));
  const balances = await bankBalances(db, [entityId]);
  assert.equal(balances.get(bankADim), 49_500_000n);
  assert.equal(await balance('8602'), 500_000n);
  assert.equal(await balance('1301'), -50_000_000n);
});

test('انتقال بین دو حساب بانکی', async () => {
  const txn = await saveTreasury(db, userId, {
    entityId,
    type: 'TRANSFER',
    date: d(2, 6),
    businessDimId: dim.HQ,
    items: [{ method: 'BANK', bankAccountId: bankA, toBankAccountId: bankB, amount: 20_000_000n, feeAmount: 10_000n }],
    allocations: [],
  });
  await postTreasury(db, userId, txn.id);
  const balances = await bankBalances(db, [entityId]);
  assert.equal(balances.get(bankADim), 49_500_000n - 20_010_000n);
  assert.equal(balances.get(bankBDim), 20_000_000n);
});

test('پرداخت با صدور چک: چک ساخته و در اسناد پرداختنی ثبت می‌شود', async () => {
  const txn = await saveTreasury(db, userId, {
    entityId,
    type: 'PAYMENT',
    date: d(2, 10),
    partyId: supplier,
    businessDimId: dim.ARZINO,
    description: 'پرداخت صورتحساب سرور',
    items: [
      {
        method: 'CHEQUE_NEW',
        amount: 30_000_000n,
        newCheque: { serialNo: "123456", dueDate: d(4, 15), bankAccountId: bankA, bankName: "ملت" },
      },
    ],
    allocations: [{ accountId: acc['7101'], businessDimId: dim.ARZINO, costCenterDimId: dim['120'], amount: 30_000_000n }],
  });
  await postTreasury(db, userId, txn.id);

  const cheque = await db.cheque.findFirstOrThrow({ where: { serialNo: '123456' } });
  assert.equal(cheque.direction, 'ISSUED');
  assert.equal(cheque.status, 'ISSUED');
  assert.equal(cheque.amount, 30_000_000n);
  assert.equal(await balance('3102'), -30_000_000n);
  assert.equal(await balance('7101'), 30_000_000n);
  const events = await db.chequeEvent.findMany({ where: { chequeId: cheque.id } });
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'REGISTER');
});

test('پاس شدن چک پرداختی: بدهی چک تسویه و بانک کم می‌شود', async () => {
  const cheque = await db.cheque.findFirstOrThrow({ where: { serialNo: '123456' } });
  assert.deepEqual(allowedEvents('ISSUED', cheque.status).sort(), ['BOUNCE', 'CANCEL', 'PAY', 'RETURN'].sort());
  await chequeEvent(db, userId, { chequeId: cheque.id, type: 'PAY', date: d(4, 15), bankAccountId: bankA, feeAmount: 5_000n, businessDimId: dim.HQ });
  const after = await db.cheque.findUniqueOrThrow({ where: { id: cheque.id } });
  assert.equal(after.status, 'PAID');
  assert.equal(await balance('3102'), 0n);
  const balances = await bankBalances(db, [entityId]);
  assert.equal(balances.get(bankADim), 49_500_000n - 20_010_000n - 30_005_000n);
  await assert.rejects(chequeEvent(db, userId, { chequeId: cheque.id, type: 'PAY', date: d(4, 16), bankAccountId: bankA }), /وضعیت/);
});

test('چرخهٔ چک دریافتی: ثبت، واگذاری به بانک، وصول با کارمزد', async () => {
  const cheque = await createCheque(
    db,
    userId,
    {
      entityId,
      direction: 'RECEIVED',
      serialNo: '998877',
      sayadId: '1234567890123456',
      bankName: 'ملی',
      amount: 80_000_000n,
      dueDate: d(3, 20),
      issueDate: d(3, 1),
      partyId: customer,
      businessDimId: dim.ARZINO,
      description: 'بابت فاکتور ۱۰۲',
    },
    { postRegister: true },
  );
  assert.equal(cheque.status, 'IN_HAND');
  assert.equal(await balance('1302'), 80_000_000n);
  assert.equal(await balance('1301'), -50_000_000n - 80_000_000n);

  await chequeEvent(db, userId, { chequeId: cheque.id, type: 'DEPOSIT', date: d(3, 18), bankAccountId: bankB });
  assert.equal((await db.cheque.findUniqueOrThrow({ where: { id: cheque.id } })).status, 'DEPOSITED');
  assert.equal(await balance('1302'), 0n);
  assert.equal(await balance('1303'), 80_000_000n);

  await chequeEvent(db, userId, { chequeId: cheque.id, type: 'CLEAR', date: d(3, 20), bankAccountId: bankB, feeAmount: 20_000n, businessDimId: dim.ARZINO });
  assert.equal((await db.cheque.findUniqueOrThrow({ where: { id: cheque.id } })).status, 'CLEARED');
  assert.equal(await balance('1303'), 0n);
  const balances = await bankBalances(db, [entityId]);
  assert.equal(balances.get(bankBDim), 20_000_000n + 80_000_000n - 20_000n);
});

test('چک دریافتی برگشتی دوباره به حساب دریافتنی مشتری می‌رود', async () => {
  const cheque = await createCheque(
    db,
    userId,
    { entityId, direction: 'RECEIVED', serialNo: '555000', bankName: 'تجارت', amount: 12_000_000n, dueDate: d(5, 10), partyId: customer, businessDimId: dim.BLUEPAL },
    { postRegister: true },
  );
  const arBefore = await balance('1301');
  await chequeEvent(db, userId, { chequeId: cheque.id, type: 'DEPOSIT', date: d(5, 10), bankAccountId: bankA });
  await chequeEvent(db, userId, { chequeId: cheque.id, type: 'BOUNCE', date: d(5, 12), bankAccountId: bankA, feeAmount: 30_000n, businessDimId: dim.HQ });
  const after = await db.cheque.findUniqueOrThrow({ where: { id: cheque.id } });
  assert.equal(after.status, 'BOUNCED');
  assert.equal(await balance('1301'), arBefore + 12_000_000n);
  assert.equal(await balance('1303'), 0n);
});

test('خرج کردن چک دریافتی به تأمین‌کننده', async () => {
  const cheque = await createCheque(
    db,
    userId,
    { entityId, direction: 'RECEIVED', serialNo: '777111', bankName: 'سپه', amount: 25_000_000n, dueDate: d(6, 1), partyId: customer },
    { postRegister: true },
  );
  const txn = await saveTreasury(db, userId, {
    entityId,
    type: 'PAYMENT',
    date: d(5, 20),
    partyId: supplier,
    businessDimId: dim.HQ,
    description: 'واگذاری چک مشتری به تأمین‌کننده',
    items: [{ method: 'CHEQUE_ENDORSE', chequeId: cheque.id, amount: 25_000_000n }],
    allocations: [{ accountId: acc['3101'], partyId: supplier, amount: 25_000_000n }],
  });
  await postTreasury(db, userId, txn.id);
  const after = await db.cheque.findUniqueOrThrow({ where: { id: cheque.id }, include: { events: true } });
  assert.equal(after.status, 'ENDORSED');
  assert.ok(after.events.some((e) => e.type === 'ENDORSE'));
  assert.equal(await balance('1302'), 0n);
});

test('چک تضمینی فقط در حساب‌های انتظامی ثبت می‌شود', async () => {
  const arBefore = await balance('1301');
  const cheque = await createCheque(
    db,
    userId,
    { entityId, direction: 'ISSUED', serialNo: 'G-1', bankName: 'ملت', amount: 100_000_000n, dueDate: d(12, 1), partyId: supplier, isGuarantee: true, bankAccountId: bankA },
    { postRegister: true },
  );
  assert.equal(await balance('9101'), 100_000_000n);
  assert.equal(await balance('9201'), -100_000_000n);
  assert.equal(await balance('1301'), arBefore);
  await chequeEvent(db, userId, { chequeId: cheque.id, type: 'RETURN', date: d(12, 20) });
  assert.equal(await balance('9101'), 0n);
  assert.equal(await balance('9201'), 0n);
});

test('سند خزانهٔ قطعی‌شده فقط با سند برگشت اصلاح می‌شود', async () => {
  const txn = await saveTreasury(db, userId, {
    entityId,
    type: 'RECEIPT',
    date: d(6, 2),
    partyId: customer,
    businessDimId: dim.HQ,
    items: [{ method: 'CASH', bankAccountId: cashBox, amount: 1_000_000n }],
    allocations: [{ accountId: acc['1301'], partyId: customer, amount: 1_000_000n }],
  });
  await postTreasury(db, userId, txn.id);
  await assert.rejects(
    saveTreasury(db, userId, { entityId, type: 'RECEIPT', date: d(6, 2), items: [{ method: 'CASH', bankAccountId: cashBox, amount: 2n }], allocations: [{ accountId: acc['1301'], partyId: customer, amount: 2n }] }, txn.id),
    /قطعی/,
  );
  const rev = await reverseTreasury(db, userId, txn.id, d(6, 3));
  assert.equal(rev.type, 'REVERSAL');
  const bal = (await bankBalances(db, [entityId])).get((await db.bankAccount.findUniqueOrThrow({ where: { id: cashBox } })).dimensionValueId);
  assert.equal(bal, 0n);
});

test('اعتبارسنجی: جمع «از طریق» باید با جمع «بابت» برابر باشد', async () => {
  await assert.rejects(
    saveTreasury(db, userId, {
      entityId,
      type: 'RECEIPT',
      date: d(6, 5),
      partyId: customer,
      items: [{ method: 'CASH', bankAccountId: cashBox, amount: 10n }],
      allocations: [{ accountId: acc['1301'], partyId: customer, amount: 9n }],
    }),
    /برابر نیست/,
  );
});
