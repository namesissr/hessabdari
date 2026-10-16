import { Prisma, type PrismaClient } from '@prisma/client';
import { AppError } from '@/lib/errors';
import { writeAudit } from '@/lib/audit';
import { addJMonths, dateToJ, jToDate, jMonthTitle, monthLength } from '@/lib/jalali';
import { createAndPostTx, type LineInput } from '@/modules/ledger/posting';
import { dimTypeIds } from '@/modules/treasury/accounts';
import { normalizeSettings, payrollSettings, type ResolvedSettings } from './settings';

type Tx = Prisma.TransactionClient;

/**
 * محاسبهٔ حقوق و دستمزد ماهانه.
 * همهٔ نرخ‌ها از تنظیمات سال می‌آیند؛ هیچ عددی در کد ثابت نیست.
 */

export type PayrollInputs = {
  workingDays: number; // کارکرد (روز)
  absenceDays: number; // غیبت بدون حقوق
  overtimeHours: number;
  holidayHours: number;
  nightHours: number;
  missionDays: number;
  bonus: bigint;
  otherDeduction: bigint;
  advanceDeduction: bigint;
  loanDeduction: bigint;
  note?: string | null;
};

export const EMPTY_INPUTS: PayrollInputs = {
  workingDays: 30,
  absenceDays: 0,
  overtimeHours: 0,
  holidayHours: 0,
  nightHours: 0,
  missionDays: 0,
  bonus: 0n,
  otherDeduction: 0n,
  advanceDeduction: 0n,
  loanDeduction: 0n,
};

export type EmployeeForPayroll = {
  id: string;
  baseSalary: bigint;
  housingAllowance: bigint;
  foodAllowance: bigint;
  childAllowance: bigint;
  transportAllowance: bigint;
  otherAllowance: bigint;
  childrenCount: number;
  insured: boolean;
  taxExempt: boolean;
  hireDate: Date;
  severanceStartDate: Date | null;
};

export type PayrollCalc = {
  baseAmount: bigint;
  housingAllowance: bigint;
  foodAllowance: bigint;
  childAllowance: bigint;
  transportAllowance: bigint;
  otherAllowance: bigint;
  overtimeAmount: bigint;
  holidayAmount: bigint;
  nightAmount: bigint;
  missionAmount: bigint;
  bonus: bigint;
  grossEarnings: bigint;
  insuranceBase: bigint;
  insuranceEmployee: bigint;
  insuranceEmployer: bigint;
  taxBase: bigint;
  tax: bigint;
  loanDeduction: bigint;
  advanceDeduction: bigint;
  otherDeduction: bigint;
  totalDeductions: bigint;
  netPay: bigint;
  severanceAccrual: bigint;
  employerCost: bigint;
  hourlyRate: bigint;
};

const r = (n: number) => BigInt(Math.round(n));
const mul = (amount: bigint, factor: number) => BigInt(Math.round(Number(amount) * factor));

/** مالیات حقوق بر اساس پلکان سال (بعد از کسر معافیت ماهانه) */
export function monthlyTax(taxable: bigint, exempt: bigint, brackets: { to: number | null; rate: number }[]): bigint {
  const over = taxable - exempt;
  if (over <= 0n) return 0n;
  let remaining = over;
  let lower = 0n;
  let tax = 0n;
  for (const b of brackets) {
    const cap = b.to === null ? null : BigInt(b.to) - exempt;
    const slice = cap === null ? remaining : cap - lower < remaining ? cap - lower : remaining;
    if (slice <= 0n) continue;
    tax += mul(slice, b.rate / 100);
    remaining -= slice;
    lower += slice;
    if (remaining <= 0n) break;
  }
  return tax;
}

/** محاسبهٔ یک فیش حقوقی */
export function calculatePayslip(emp: EmployeeForPayroll, inputs: PayrollInputs, s: ResolvedSettings, daysInMonth = 30): PayrollCalc {
  if (inputs.workingDays < 0 || inputs.workingDays > 31) throw new AppError('کارکرد باید بین ۰ تا ۳۱ روز باشد.');
  const paidDays = Math.max(0, inputs.workingDays - inputs.absenceDays);
  const ratio = paidDays / daysInMonth;

  const baseAmount = mul(emp.baseSalary, ratio);
  const housingAllowance = mul(emp.housingAllowance > 0n ? emp.housingAllowance : s.housingDefault, ratio);
  const foodAllowance = mul(emp.foodAllowance > 0n ? emp.foodAllowance : s.foodDefault, ratio);
  const childBase = emp.childAllowance > 0n ? emp.childAllowance : s.childAllowanceRate * BigInt(emp.childrenCount);
  const childAllowance = mul(childBase, ratio);
  const transportAllowance = mul(emp.transportAllowance, ratio);
  const otherAllowance = mul(emp.otherAllowance, ratio);

  // نرخ ساعتی بر مبنای حقوق پایهٔ ماهانه
  const hourlyRate = s.monthlyWorkHours > 0 ? BigInt(Math.round(Number(emp.baseSalary) / s.monthlyWorkHours)) : 0n;
  const overtimeAmount = r(Number(hourlyRate) * inputs.overtimeHours * s.overtimeFactor);
  const holidayAmount = r(Number(hourlyRate) * inputs.holidayHours * s.holidayFactor);
  const nightAmount = r(Number(hourlyRate) * inputs.nightHours * s.nightFactor);
  const dailyRate = BigInt(Math.round(Number(emp.baseSalary) / daysInMonth));
  const missionAmount = r(Number(dailyRate) * inputs.missionDays);

  const grossEarnings =
    baseAmount + housingAllowance + foodAllowance + childAllowance + transportAllowance + otherAllowance + overtimeAmount + holidayAmount + nightAmount + missionAmount + inputs.bonus;

  // مبنای بیمه: کل دریافتی به‌جز حق اولاد و مأموریت (طبق رویهٔ تأمین اجتماعی)
  let insuranceBase = grossEarnings - childAllowance - missionAmount;
  if (s.insuranceCeiling > 0n && insuranceBase > s.insuranceCeiling) insuranceBase = s.insuranceCeiling;
  const insuranceEmployee = emp.insured ? mul(insuranceBase, s.insuranceEmployeeRate / 100) : 0n;
  const insuranceEmployer = emp.insured ? mul(insuranceBase, s.insuranceEmployerRate / 100) : 0n;

  // مبنای مالیات: کل دریافتی منهای حق بیمهٔ سهم کارمند، حق اولاد، بن و مسکن معاف نیستند
  const taxBase = grossEarnings - childAllowance - insuranceEmployee - missionAmount;
  const tax = emp.taxExempt ? 0n : monthlyTax(taxBase, s.taxExemptMonthly, s.taxBrackets);

  const totalDeductions = insuranceEmployee + tax + inputs.loanDeduction + inputs.advanceDeduction + inputs.otherDeduction;
  const netPay = grossEarnings - totalDeductions;

  // سنوات: (روزهای سنوات در سال ÷ ۳۶۵) × حقوق روزانه × روزهای کارکرد  → تقریب ماهانهٔ یک ماه حقوق در سال
  const severanceDaily = Number(emp.baseSalary + (emp.housingAllowance > 0n ? emp.housingAllowance : s.housingDefault) + (emp.foodAllowance > 0n ? emp.foodAllowance : s.foodDefault)) / daysInMonth;
  const severanceAccrual = r((severanceDaily * s.severanceDaysPerYear * paidDays) / 365);

  return {
    baseAmount,
    housingAllowance,
    foodAllowance,
    childAllowance,
    transportAllowance,
    otherAllowance,
    overtimeAmount,
    holidayAmount,
    nightAmount,
    missionAmount,
    bonus: inputs.bonus,
    grossEarnings,
    insuranceBase,
    insuranceEmployee,
    insuranceEmployer,
    taxBase,
    tax,
    loanDeduction: inputs.loanDeduction,
    advanceDeduction: inputs.advanceDeduction,
    otherDeduction: inputs.otherDeduction,
    totalDeductions,
    netPay,
    severanceAccrual,
    employerCost: grossEarnings + insuranceEmployer + severanceAccrual,
    hourlyRate,
  };
}

/** ایجاد لیست حقوق ماه با پر کردن خودکار همهٔ کارمندان شاغل */
export async function createRun(db: PrismaClient, userId: string, input: { entityId: string; jy: number; jm: number; payDate?: Date | null; note?: string | null }) {
  return db.$transaction(async (tx) => {
    const exists = await tx.payrollRun.findUnique({ where: { entityId_jy_jm: { entityId: input.entityId, jy: input.jy, jm: input.jm } } });
    if (exists) throw new AppError(`لیست حقوق ${jMonthTitle(input.jy, input.jm)} قبلاً ساخته شده است.`);

    const monthEnd = jToDate(input.jy, input.jm, monthLength(input.jy, input.jm));
    const fy = await tx.fiscalYear.findFirst({ where: { entityId: input.entityId, startDate: { lte: monthEnd }, endDate: { gte: monthEnd } }, include: { periods: true } });
    if (!fy) throw new AppError('برای این ماه سال مالی تعریف نشده است.');
    if (fy.status === 'CLOSED') throw new AppError('سال مالی این ماه بسته شده است.');
    const period = fy.periods.find((p) => p.startDate <= monthEnd && p.endDate >= monthEnd);
    if (!period) throw new AppError('دورهٔ مالی این ماه پیدا نشد.');

    const settings = await payrollSettings(tx, input.entityId, input.jy);
    const employees = await tx.employee.findMany({
      where: { entityId: input.entityId, status: { in: ['ACTIVE', 'ON_LEAVE'] }, hireDate: { lte: monthEnd } },
      orderBy: { code: 'asc' },
    });
    if (!employees.length) throw new AppError('کارمند فعالی برای این ماه وجود ندارد.');

    const run = await tx.payrollRun.create({
      data: {
        entityId: input.entityId,
        periodId: period.id,
        jy: input.jy,
        jm: input.jm,
        title: jMonthTitle(input.jy, input.jm),
        payDate: input.payDate ?? null,
        note: input.note ?? null,
        settings: settings as unknown as object,
        createdById: userId,
      },
    });

    const daysInMonth = monthLength(input.jy, input.jm);
    for (const emp of employees) {
      const openLoans = await tx.employeeLoan.findMany({ where: { employeeId: emp.id, status: 'ACTIVE' } });
      const loanDeduction = openLoans
        .filter((l) => !l.isAdvance)
        .reduce((s, l) => {
          const remaining = l.amount - l.paidAmount;
          const inst = l.installmentAmount > 0n ? l.installmentAmount : remaining;
          return s + (inst < remaining ? inst : remaining);
        }, 0n);
      const advanceDeduction = openLoans.filter((l) => l.isAdvance).reduce((s, l) => s + (l.amount - l.paidAmount), 0n);

      const calc = calculatePayslip(emp, { ...EMPTY_INPUTS, workingDays: daysInMonth, loanDeduction, advanceDeduction }, settings, daysInMonth);
      await tx.payrollItem.create({
        data: {
          runId: run.id,
          employeeId: emp.id,
          workingDays: new Prisma.Decimal(daysInMonth),
          loanDeduction,
          advanceDeduction,
          ...toItemData(calc),
        },
      });
    }

    await recalcTotals(tx, run.id);
    await writeAudit(tx, { userId, action: 'payroll.create', objectType: 'PayrollRun', objectId: run.id, entityId: input.entityId, data: { title: run.title, employees: employees.length } });
    return run;
  }, { maxWait: 10000, timeout: 120000 });
}

function toItemData(c: PayrollCalc) {
  return {
    baseAmount: c.baseAmount,
    housingAllowance: c.housingAllowance,
    foodAllowance: c.foodAllowance,
    childAllowance: c.childAllowance,
    transportAllowance: c.transportAllowance,
    otherAllowance: c.otherAllowance,
    overtimeAmount: c.overtimeAmount,
    holidayAmount: c.holidayAmount,
    nightAmount: c.nightAmount,
    missionAmount: c.missionAmount,
    bonus: c.bonus,
    grossEarnings: c.grossEarnings,
    insuranceBase: c.insuranceBase,
    insuranceEmployee: c.insuranceEmployee,
    insuranceEmployer: c.insuranceEmployer,
    taxBase: c.taxBase,
    tax: c.tax,
    otherDeduction: c.otherDeduction,
    totalDeductions: c.totalDeductions,
    netPay: c.netPay,
    severanceAccrual: c.severanceAccrual,
    employerCost: c.employerCost,
  };
}

async function recalcTotals(tx: Tx, runId: string) {
  const items = await tx.payrollItem.findMany({ where: { runId } });
  const totals = items.reduce(
    (s, i) => ({
      gross: s.gross + i.grossEarnings,
      net: s.net + i.netPay,
      tax: s.tax + i.tax,
      insurance: s.insurance + i.insuranceEmployee + i.insuranceEmployer,
      employer: s.employer + i.employerCost,
    }),
    { gross: 0n, net: 0n, tax: 0n, insurance: 0n, employer: 0n },
  );
  await tx.payrollRun.update({
    where: { id: runId },
    data: { totalGross: totals.gross, totalNet: totals.net, totalTax: totals.tax, totalInsurance: totals.insurance, totalEmployerCost: totals.employer },
  });
}

/** ویرایش کارکرد/اضافه‌کار/کسورات یک فیش و محاسبهٔ دوباره */
export async function updateItem(db: PrismaClient, userId: string, itemId: string, inputs: Partial<PayrollInputs>) {
  return db.$transaction(async (tx) => {
    const item = await tx.payrollItem.findUniqueOrThrow({ where: { id: itemId }, include: { run: true, employee: true } });
    if (item.run.status === 'POSTED') throw new AppError('لیست حقوق قطعی‌شده قابل ویرایش نیست.');
    const fallback = await payrollSettings(tx, item.run.entityId, item.run.jy);
    const settings = normalizeSettings(item.run.settings, fallback);
    const daysInMonth = monthLength(item.run.jy, item.run.jm);
    const merged: PayrollInputs = {
      workingDays: inputs.workingDays ?? Number(item.workingDays),
      absenceDays: inputs.absenceDays ?? Number(item.absenceDays),
      overtimeHours: inputs.overtimeHours ?? Number(item.overtimeHours),
      holidayHours: inputs.holidayHours ?? Number(item.holidayHours),
      nightHours: inputs.nightHours ?? Number(item.nightHours),
      missionDays: inputs.missionDays ?? Number(item.missionDays),
      bonus: inputs.bonus ?? item.bonus,
      otherDeduction: inputs.otherDeduction ?? item.otherDeduction,
      advanceDeduction: inputs.advanceDeduction ?? item.advanceDeduction,
      loanDeduction: inputs.loanDeduction ?? item.loanDeduction,
      note: inputs.note ?? item.note,
    };
    const calc = calculatePayslip(item.employee, merged, settings, daysInMonth);
    const updated = await tx.payrollItem.update({
      where: { id: itemId },
      data: {
        workingDays: new Prisma.Decimal(merged.workingDays),
        absenceDays: new Prisma.Decimal(merged.absenceDays),
        overtimeHours: new Prisma.Decimal(merged.overtimeHours),
        holidayHours: new Prisma.Decimal(merged.holidayHours),
        nightHours: new Prisma.Decimal(merged.nightHours),
        missionDays: new Prisma.Decimal(merged.missionDays),
        loanDeduction: merged.loanDeduction,
        advanceDeduction: merged.advanceDeduction,
        note: merged.note ?? null,
        ...toItemData(calc),
      },
    });
    await recalcTotals(tx, item.runId);
    return updated;
  });
}

export async function removeItem(db: PrismaClient, userId: string, itemId: string) {
  return db.$transaction(async (tx) => {
    const item = await tx.payrollItem.findUniqueOrThrow({ where: { id: itemId }, include: { run: true } });
    if (item.run.status === 'POSTED') throw new AppError('لیست حقوق قطعی‌شده قابل تغییر نیست.');
    await tx.payrollItem.delete({ where: { id: itemId } });
    await recalcTotals(tx, item.runId);
  });
}

async function accountIds(tx: Tx, chartId: string, codes: Record<string, string>) {
  const out: Record<string, string> = {};
  for (const [key, code] of Object.entries(codes)) {
    const acc = await tx.account.findFirst({ where: { chartId, code } });
    if (!acc) throw new AppError(`حساب با کد ${code} (${key}) در چارت تعریف نشده است.`);
    if (!acc.isPostable) throw new AppError(`حساب ${code} قابل ثبت نیست.`);
    out[key] = acc.id;
  }
  return out;
}

/** قطعی کردن لیست حقوق و صدور سند حسابداری */
export async function postRun(db: PrismaClient, userId: string, runId: string) {
  return db.$transaction(async (tx) => {
    const run = await tx.payrollRun.findUniqueOrThrow({
      where: { id: runId },
      include: { items: { include: { employee: { include: { party: true } } } }, entity: true, period: true },
    });
    if (run.status === 'POSTED') throw new AppError('این لیست قبلاً قطعی شده است.');
    if (!run.items.length) throw new AppError('لیست حقوق خالی است.');

    const settings = normalizeSettings(run.settings, await payrollSettings(tx, run.entityId, run.jy));
    const acc = await accountIds(tx, run.entity.chartId, settings.accounts as unknown as Record<string, string>);
    const dims = await dimTypeIds(tx);
    const date = run.payDate ?? jToDate(run.jy, run.jm, monthLength(run.jy, run.jm));

    const lines: LineInput[] = [];
    const push = (accountId: string, side: 'debit' | 'credit', amount: bigint, d: Record<string, string>, description?: string) => {
      if (amount <= 0n) return;
      lines.push(side === 'debit' ? { accountId, debit: amount, dims: d, description } : { accountId, credit: amount, dims: d, description });
    };

    for (const item of run.items) {
      const emp = item.employee;
      const empDims: Record<string, string> = {};
      if (emp.businessDimId) empDims[dims.BUSINESS] = emp.businessDimId;
      if (emp.costCenterDimId && dims.COST_CENTER) empDims[dims.COST_CENTER] = emp.costCenterDimId;
      const partyDims = { [dims.PARTY]: emp.party.dimensionValueId };
      const name = `${emp.firstName} ${emp.lastName}`;

      const salaryPart = item.grossEarnings - item.overtimeAmount - item.holidayAmount - item.nightAmount - item.bonus;
      push(acc.salaryExpense, 'debit', salaryPart, empDims, `حقوق ${name}`);
      push(acc.overtimeExpense, 'debit', item.overtimeAmount + item.holidayAmount + item.nightAmount + item.bonus, empDims, `اضافه‌کار و پاداش ${name}`);
      push(acc.employerInsuranceExpense, 'debit', item.insuranceEmployer, empDims, `بیمهٔ سهم کارفرما ${name}`);
      push(acc.severanceExpense, 'debit', item.severanceAccrual, empDims, `ذخیرهٔ سنوات ${name}`);

      push(acc.salaryPayable, 'credit', item.netPay, partyDims, `خالص پرداختنی ${name}`);
      push(acc.insurancePayable, 'credit', item.insuranceEmployee + item.insuranceEmployer, {}, `حق بیمهٔ ${name}`);
      push(acc.taxPayable, 'credit', item.tax, {}, `مالیات حقوق ${name}`);
      push(acc.employeeLoan, 'credit', item.loanDeduction + item.advanceDeduction, partyDims, `کسر وام/مساعدهٔ ${name}`);
      push(acc.severanceProvision, 'credit', item.severanceAccrual, partyDims, `ذخیرهٔ سنوات ${name}`);
      if (item.otherDeduction > 0n) push(acc.salaryPayable, 'debit', item.otherDeduction, partyDims, `سایر کسورات ${name}`);
    }

    const voucher = await createAndPostTx(tx, userId, {
      entityId: run.entityId,
      date,
      type: 'SYSTEM',
      sourceModule: 'payroll',
      sourceRef: run.id,
      idempotencyKey: `payroll:${run.id}`,
      description: `لیست حقوق ${run.title}`,
      lines,
    });

    // کسر اقساط وام از ماندهٔ وام کارکنان
    for (const item of run.items) {
      let toApply = item.loanDeduction + item.advanceDeduction;
      if (toApply <= 0n) continue;
      const loans = await tx.employeeLoan.findMany({ where: { employeeId: item.employeeId, status: 'ACTIVE' }, orderBy: { date: 'asc' } });
      for (const loan of loans) {
        if (toApply <= 0n) break;
        const remaining = loan.amount - loan.paidAmount;
        const pay = toApply < remaining ? toApply : remaining;
        await tx.employeeLoan.update({
          where: { id: loan.id },
          data: { paidAmount: { increment: pay }, status: pay >= remaining ? 'SETTLED' : 'ACTIVE' },
        });
        toApply -= pay;
      }
    }

    const updated = await tx.payrollRun.update({ where: { id: runId }, data: { status: 'POSTED', voucherId: voucher.id } });
    await writeAudit(tx, { userId, action: 'payroll.post', objectType: 'PayrollRun', objectId: runId, entityId: run.entityId, data: { title: run.title, net: run.totalNet, voucherId: voucher.id } });
    return updated;
  }, { maxWait: 10000, timeout: 180000 });
}

export async function deleteRun(db: PrismaClient, userId: string, runId: string) {
  return db.$transaction(async (tx) => {
    const run = await tx.payrollRun.findUniqueOrThrow({ where: { id: runId } });
    if (run.status === 'POSTED') throw new AppError('لیست قطعی‌شده حذف نمی‌شود؛ سند آن را برگشت بزنید.');
    await tx.payrollRun.delete({ where: { id: runId } });
    await writeAudit(tx, { userId, action: 'payroll.delete', objectType: 'PayrollRun', objectId: runId, entityId: run.entityId, data: { title: run.title } });
  });
}

/** بدهی سنوات هر کارمند تا امروز (بر اساس فیش‌های قطعی‌شده) */
export async function severanceLiability(db: PrismaClient, entityId: string) {
  const rows = await db.payrollItem.groupBy({
    by: ['employeeId'],
    where: { run: { entityId, status: 'POSTED' } },
    _sum: { severanceAccrual: true, grossEarnings: true, netPay: true, tax: true, insuranceEmployee: true },
    _count: true,
  });
  return new Map(rows.map((r) => [r.employeeId, r]));
}

/** خلاصهٔ سالانهٔ یک کارمند */
export async function employeeYearSummary(db: PrismaClient, employeeId: string, jy: number) {
  const items = await db.payrollItem.findMany({
    where: { employeeId, run: { jy, status: 'POSTED' } },
    include: { run: true },
    orderBy: { run: { jm: 'asc' } },
  });
  const totals = items.reduce(
    (s, i) => ({
      gross: s.gross + i.grossEarnings,
      net: s.net + i.netPay,
      tax: s.tax + i.tax,
      insurance: s.insurance + i.insuranceEmployee,
      employerInsurance: s.employerInsurance + i.insuranceEmployer,
      severance: s.severance + i.severanceAccrual,
      overtime: s.overtime + i.overtimeAmount,
    }),
    { gross: 0n, net: 0n, tax: 0n, insurance: 0n, employerInsurance: 0n, severance: 0n, overtime: 0n },
  );
  return { items, totals };
}

/** ماه بعدی که هنوز لیست حقوق ندارد */
export async function suggestNextMonth(db: PrismaClient, entityId: string, today: Date) {
  const last = await db.payrollRun.findFirst({ where: { entityId }, orderBy: [{ jy: 'desc' }, { jm: 'desc' }] });
  if (!last) {
    const { jy, jm } = dateToJ(today);
    return { jy, jm };
  }
  const next = addJMonths(last.jy, last.jm, 1);
  return { jy: next.jy, jm: next.jm };
}
