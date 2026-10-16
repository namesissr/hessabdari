/**
 * تست یکپارچهٔ کارکنان و حقوق و دستمزد.
 * اجرا: DATABASE_URL=<دیتابیس تست خالی> bash tests/setup.sh && npx tsx --test tests/payroll.test.ts
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { addContract, addLeave, addLoan, employeeProfile, saveEmployee } from '@/modules/hr/employees';
import { calculatePayslip, createRun, deleteRun, employeeYearSummary, monthlyTax, postRun, updateItem, EMPTY_INPUTS } from '@/modules/hr/payroll';
import { DEFAULT_ACCOUNTS, DEFAULT_SETTINGS, DEFAULT_TAX_BRACKETS, payrollSettings, validateBrackets } from '@/modules/hr/settings';
import { saveBankAccount } from '@/modules/treasury/masters';
import { dateToJ, jToDate } from '@/lib/jalali';

const db = new PrismaClient();
let userId: string, entityId: string;
const acc: Record<string, string> = {};
const dim: Record<string, string> = {};
let jy = 1405;
let employeeId = '';
let bankId = '';
const baseline = new Map<string, bigint>();

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

const SETTINGS = {
  id: null,
  jy: 1405,
  ...DEFAULT_SETTINGS,
  taxBrackets: DEFAULT_TAX_BRACKETS,
  accounts: DEFAULT_ACCOUNTS,
};

const EMP = {
  id: 'x',
  baseSalary: 200_000_000n,
  housingAllowance: 9_000_000n,
  foodAllowance: 20_000_000n,
  childAllowance: 0n,
  transportAllowance: 10_000_000n,
  otherAllowance: 0n,
  childrenCount: 2,
  insured: true,
  taxExempt: false,
  hireDate: new Date('2024-01-01'),
  severanceStartDate: null,
};

before(async () => {
  userId = (await db.user.findFirstOrThrow()).id;
  const e = await db.entity.findUniqueOrThrow({ where: { code: 'RAI' } });
  entityId = e.id;
  for (const a of await db.account.findMany({ where: { chartId: e.chartId } })) acc[a.code] = a.id;
  for (const v of await db.dimensionValue.findMany()) dim[v.code] = v.id;
  const fy = await db.fiscalYear.findFirstOrThrow({ where: { entityId, status: 'OPEN' }, orderBy: { startDate: 'asc' } });
  jy = dateToJ(fy.startDate).jy;
  const b = await saveBankAccount(db, userId, { entityId, name: 'بانک حقوق', kind: 'BANK', bankName: 'ملت', glAccountId: acc['1101'] });
  bankId = b.id;
  for (const code of ['1101', '1401', '3202', '3203', '3204', '4201', '8101', '8102', '8103', '8104']) baseline.set(code, await rawBalance(code));
});

after(async () => db.$disconnect());

// ───────────────────────── محاسبه

test('مالیات پلکانی حقوق درست محاسبه می‌شود', () => {
  const exempt = 120_000_000n;
  // تا سقف معافیت → بدون مالیات
  assert.equal(monthlyTax(100_000_000n, exempt, DEFAULT_TAX_BRACKETS), 0n);
  assert.equal(monthlyTax(120_000_000n, exempt, DEFAULT_TAX_BRACKETS), 0n);
  // ۲۰ میلیون مازاد در پلهٔ ۱۰٪
  assert.equal(monthlyTax(140_000_000n, exempt, DEFAULT_TAX_BRACKETS), 2_000_000n);
  // تا سقف پلهٔ اول (۲۴۰) → ۱۲۰ میلیون × ۱۰٪
  assert.equal(monthlyTax(240_000_000n, exempt, DEFAULT_TAX_BRACKETS), 12_000_000n);
  // ۳۰۰ میلیون: ۱۲۰×۱۰٪ + ۶۰×۱۵٪
  assert.equal(monthlyTax(300_000_000n, exempt, DEFAULT_TAX_BRACKETS), 12_000_000n + 9_000_000n);
  // ۵۰۰ میلیون: ۱۲۰×۱۰٪ + ۱۲۰×۱۵٪ + ۱۲۰×۲۰٪ + ۲۰×۳۰٪
  assert.equal(monthlyTax(500_000_000n, exempt, DEFAULT_TAX_BRACKETS), 12_000_000n + 18_000_000n + 24_000_000n + 6_000_000n);
});

test('اعتبارسنجی پلکان مالیات', () => {
  assert.throws(() => validateBrackets([{ to: 100, rate: 10 }]), /بدون سقف/);
  assert.throws(() => validateBrackets([{ to: 200, rate: 10 }, { to: 100, rate: 15 }, { to: null, rate: 20 }]), /صعودی/);
  assert.deepEqual(validateBrackets(DEFAULT_TAX_BRACKETS), DEFAULT_TAX_BRACKETS);
});

test('فیش حقوقی کامل: مزایا، بیمه، مالیات و خالص پرداختی', () => {
  const c = calculatePayslip(EMP, { ...EMPTY_INPUTS, workingDays: 30 }, SETTINGS, 30);
  const child = DEFAULT_SETTINGS.childAllowanceRate * 2n;
  const gross = 200_000_000n + 9_000_000n + 20_000_000n + child + 10_000_000n;
  assert.equal(c.grossEarnings, gross);
  assert.equal(c.childAllowance, child);
  // حق اولاد مشمول بیمه نیست
  assert.equal(c.insuranceBase, gross - child);
  assert.equal(c.insuranceEmployee, (gross - child) * 7n / 100n);
  assert.equal(c.insuranceEmployer, (gross - child) * 23n / 100n);
  assert.equal(c.taxBase, gross - child - c.insuranceEmployee);
  assert.equal(c.tax, monthlyTax(c.taxBase, SETTINGS.taxExemptMonthly, DEFAULT_TAX_BRACKETS));
  assert.equal(c.netPay, gross - c.insuranceEmployee - c.tax);
  assert.equal(c.employerCost, gross + c.insuranceEmployer + c.severanceAccrual);
  assert.ok(c.severanceAccrual > 0n);
});

test('کارکرد ناقص، اضافه‌کار و کسورات', () => {
  const full = calculatePayslip(EMP, { ...EMPTY_INPUTS, workingDays: 30 }, SETTINGS, 30);
  const half = calculatePayslip(EMP, { ...EMPTY_INPUTS, workingDays: 15 }, SETTINGS, 30);
  assert.equal(half.baseAmount, full.baseAmount / 2n);
  assert.equal(half.housingAllowance, full.housingAllowance / 2n);

  const withOt = calculatePayslip(EMP, { ...EMPTY_INPUTS, workingDays: 30, overtimeHours: 10 }, SETTINGS, 30);
  const hourly = BigInt(Math.round(200_000_000 / 192));
  assert.equal(withOt.hourlyRate, hourly);
  assert.equal(withOt.overtimeAmount, BigInt(Math.round(Number(hourly) * 10 * 1.4)));
  assert.equal(withOt.grossEarnings, full.grossEarnings + withOt.overtimeAmount);

  const withDeductions = calculatePayslip(EMP, { ...EMPTY_INPUTS, workingDays: 30, loanDeduction: 5_000_000n, otherDeduction: 1_000_000n }, SETTINGS, 30);
  assert.equal(withDeductions.netPay, full.netPay - 6_000_000n);
  // کسورات بر مالیات و بیمه اثر ندارند
  assert.equal(withDeductions.tax, full.tax);
});

test('کارمند بیمه‌نشده و معاف از مالیات', () => {
  const c = calculatePayslip({ ...EMP, insured: false, taxExempt: true }, { ...EMPTY_INPUTS, workingDays: 30 }, SETTINGS, 30);
  assert.equal(c.insuranceEmployee, 0n);
  assert.equal(c.insuranceEmployer, 0n);
  assert.equal(c.tax, 0n);
  assert.equal(c.netPay, c.grossEarnings);
});

test('سقف دستمزد مشمول بیمه رعایت می‌شود', () => {
  const capped = calculatePayslip(EMP, { ...EMPTY_INPUTS, workingDays: 30 }, { ...SETTINGS, insuranceCeiling: 100_000_000n }, 30);
  assert.equal(capped.insuranceBase, 100_000_000n);
  assert.equal(capped.insuranceEmployee, 7_000_000n);
});

// ───────────────────────── پروندهٔ کارمند

test('ثبت کارمند، طرف حساب و قرارداد اولیه خودکار ساخته می‌شود', async () => {
  const emp = await saveEmployee(db, userId, {
    entityId,
    firstName: 'علی',
    lastName: 'رضایی',
    nationalCode: '0012345678',
    gender: 'MALE',
    maritalStatus: 'MARRIED',
    childrenCount: 2,
    mobile: '09120000000',
    hireDate: jToDate(jy - 2, 1, 15),
    contractType: 'PERMANENT',
    position: 'برنامه‌نویس',
    businessDimId: dim.HQ,
    costCenterDimId: dim['110'],
    insured: true,
    taxExempt: false,
    iban: 'IR123456789012345678901234',
    baseSalary: 200_000_000n,
    housingAllowance: 9_000_000n,
    foodAllowance: 20_000_000n,
    childAllowance: 0n,
    transportAllowance: 10_000_000n,
    otherAllowance: 0n,
    status: 'ACTIVE',
  });
  employeeId = emp.id;

  const profile = await employeeProfile(db, emp.id);
  assert.ok(profile);
  assert.equal(profile!.party.dimensionValue.name, 'علی رضایی');
  assert.equal(profile!.party.roles.includes('EMPLOYEE'), true);
  assert.equal(profile!.contracts.length, 1);
  assert.equal(profile!.contracts[0].baseSalary, 200_000_000n);
  assert.match(profile!.code, /^\d{4}$/);
});

test('حکم جدید حقوق کارمند را از تاریخ معین تغییر می‌دهد', async () => {
  await addContract(db, userId, {
    employeeId,
    startDate: jToDate(jy, 1, 1),
    contractType: 'PERMANENT',
    position: 'سرپرست فنی',
    baseSalary: 260_000_000n,
    housingAllowance: 9_000_000n,
    foodAllowance: 20_000_000n,
    transportAllowance: 10_000_000n,
    otherAllowance: 0n,
    note: 'افزایش سالانه',
    applyToEmployee: true,
  });
  const emp = await db.employee.findUniqueOrThrow({ where: { id: employeeId } });
  assert.equal(emp.baseSalary, 260_000_000n);
  assert.equal(emp.position, 'سرپرست فنی');
  assert.equal((await db.employeeContract.count({ where: { employeeId } })), 2);
});

test('مرخصی و وام کارمند ثبت می‌شود و وام سند می‌خورد', async () => {
  await addLeave(db, userId, { employeeId, type: 'ANNUAL', fromDate: jToDate(jy, 2, 5), toDate: jToDate(jy, 2, 7), days: 3, note: 'مرخصی استحقاقی' });
  assert.equal(await db.leaveRecord.count({ where: { employeeId } }), 1);

  await addLoan(db, userId, { employeeId, date: jToDate(jy, 2, 1), amount: 60_000_000n, installmentAmount: 10_000_000n, isAdvance: false, description: 'وام ضروری', bankAccountId: bankId });
  assert.equal(await balance('1401'), 60_000_000n);
  assert.equal(await balance('1101'), -60_000_000n);
});

// ───────────────────────── لیست حقوق

test('ساخت لیست حقوق ماه، ویرایش کارکرد و قطعی کردن با سند تراز', async () => {
  const run = await createRun(db, userId, { entityId, jy, jm: 3 });
  const items = await db.payrollItem.findMany({ where: { runId: run.id } });
  assert.equal(items.length, 1);
  // قسط وام خودکار در فیش می‌آید
  assert.equal(items[0].loanDeduction, 10_000_000n);

  await updateItem(db, userId, items[0].id, { overtimeHours: 20, bonus: 5_000_000n });
  const updated = await db.payrollItem.findUniqueOrThrow({ where: { id: items[0].id } });
  assert.ok(updated.overtimeAmount > 0n);
  assert.equal(updated.bonus, 5_000_000n);

  const runBefore = await db.payrollRun.findUniqueOrThrow({ where: { id: run.id } });
  assert.equal(runBefore.totalNet, updated.netPay);

  const posted = await postRun(db, userId, run.id);
  assert.equal(posted.status, 'POSTED');
  const voucher = await db.voucher.findUniqueOrThrow({ where: { id: posted.voucherId! }, include: { lines: true } });
  assert.equal(voucher.lines.reduce((s, l) => s + l.debit, 0n), voucher.lines.reduce((s, l) => s + l.credit, 0n));

  // کنترل حساب‌ها
  assert.equal(await balance('3204'), -updated.netPay);
  assert.equal(await balance('3203'), -(updated.insuranceEmployee + updated.insuranceEmployer));
  assert.equal(await balance('3202'), -updated.tax);
  assert.equal(await balance('4201'), -updated.severanceAccrual);
  assert.equal(await balance('8103'), updated.insuranceEmployer);
  assert.equal(await balance('8104'), updated.severanceAccrual);
  // قسط وام از ماندهٔ وام کم شده
  assert.equal(await balance('1401'), 60_000_000n - 10_000_000n);
  const loan = await db.employeeLoan.findFirstOrThrow({ where: { employeeId } });
  assert.equal(loan.paidAmount, 10_000_000n);
  assert.equal(loan.status, 'ACTIVE');

  await assert.rejects(postRun(db, userId, run.id), /قبلاً قطعی/);
  await assert.rejects(updateItem(db, userId, items[0].id, { overtimeHours: 1 }), /قطعی/);
  await assert.rejects(deleteRun(db, userId, run.id), /حذف نمی‌شود/);
});

test('لیست تکراری همان ماه ساخته نمی‌شود', async () => {
  await assert.rejects(createRun(db, userId, { entityId, jy, jm: 3 }), /قبلاً ساخته شده/);
});

test('خلاصهٔ سالانهٔ کارمند و ماندهٔ سنوات', async () => {
  const sum = await employeeYearSummary(db, employeeId, jy);
  assert.equal(sum.items.length, 1);
  assert.ok(sum.totals.gross > 0n);
  assert.ok(sum.totals.severance > 0n);
  assert.equal(sum.totals.net, sum.items[0].netPay);
});

test('تنظیمات سال با مقادیر پیش‌فرض برمی‌گردد و قابل ذخیره است', async () => {
  const s = await payrollSettings(db, entityId, jy);
  assert.equal(s.insuranceEmployeeRate, 7);
  assert.equal(s.accounts.salaryPayable, '3204');

  await db.payrollSettings.create({
    data: {
      entityId,
      jy,
      dailyMinWage: 3_000_000n,
      taxExemptMonthly: 150_000_000n,
      taxBrackets: DEFAULT_TAX_BRACKETS as object,
      accounts: DEFAULT_ACCOUNTS as object,
      insuranceEmployeeRate: 7,
      insuranceEmployerRate: 23,
    },
  });
  const saved = await payrollSettings(db, entityId, jy);
  assert.equal(saved.taxExemptMonthly, 150_000_000n);
  assert.equal(saved.dailyMinWage, 3_000_000n);
});
