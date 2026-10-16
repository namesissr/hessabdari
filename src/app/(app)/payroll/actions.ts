'use server';

import prisma from '@/lib/prisma';
import { assertEntityAccess, requireUser } from '@/lib/auth';
import { run, str, optStr, type ActionResult } from '@/lib/action';
import { AppError } from '@/lib/errors';
import { parseJ } from '@/lib/jalali';
import { toBig } from '@/lib/money';
import { createRun, deleteRun, postRun, removeItem, updateItem } from '@/modules/hr/payroll';
import { validateBrackets, type PayrollAccounts, type TaxBracket } from '@/modules/hr/settings';

export async function createRunAction(fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser('voucher.edit');
    const entityId = str(fd, 'entityId');
    assertEntityAccess(user, entityId);
    const jy = Number(str(fd, 'jy'));
    const jm = Number(str(fd, 'jm'));
    if (!jy || jm < 1 || jm > 12) throw new AppError('سال و ماه را درست انتخاب کنید.');
    const runRow = await createRun(prisma, user.id, { entityId, jy, jm, payDate: parseJ(str(fd, 'payDate')), note: optStr(fd, 'note') });
    return { redirect: `/payroll/${runRow.id}`, message: 'لیست حقوق ساخته شد.' };
  });
}

export async function updateItemAction(itemId: string, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser('voucher.edit');
    const item = await prisma.payrollItem.findUniqueOrThrow({ where: { id: itemId }, include: { run: true } });
    assertEntityAccess(user, item.run.entityId);
    const num = (k: string, d: number) => {
      const v = str(fd, k);
      return v === '' ? d : Number(v.replace(/[^\d.]/g, ''));
    };
    await updateItem(prisma, user.id, itemId, {
      workingDays: num('workingDays', Number(item.workingDays)),
      absenceDays: num('absenceDays', 0),
      overtimeHours: num('overtimeHours', 0),
      holidayHours: num('holidayHours', 0),
      nightHours: num('nightHours', 0),
      missionDays: num('missionDays', 0),
      bonus: toBig(str(fd, 'bonus') || '0'),
      otherDeduction: toBig(str(fd, 'otherDeduction') || '0'),
      loanDeduction: toBig(str(fd, 'loanDeduction') || '0'),
      advanceDeduction: toBig(str(fd, 'advanceDeduction') || '0'),
      note: optStr(fd, 'note'),
    });
    return { message: 'فیش به‌روز شد.' };
  });
}

export async function removeItemAction(itemId: string): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser('voucher.edit');
    const item = await prisma.payrollItem.findUniqueOrThrow({ where: { id: itemId }, include: { run: true } });
    assertEntityAccess(user, item.run.entityId);
    await removeItem(prisma, user.id, itemId);
    return { message: 'از لیست حذف شد.' };
  });
}

export async function postRunAction(runId: string): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser('voucher.post');
    const r = await prisma.payrollRun.findUniqueOrThrow({ where: { id: runId } });
    assertEntityAccess(user, r.entityId);
    await postRun(prisma, user.id, runId);
    return { message: 'لیست حقوق قطعی شد و سند حسابداری صادر شد.' };
  });
}

export async function deleteRunAction(runId: string): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser('voucher.edit');
    const r = await prisma.payrollRun.findUniqueOrThrow({ where: { id: runId } });
    assertEntityAccess(user, r.entityId);
    await deleteRun(prisma, user.id, runId);
    return { redirect: '/payroll' };
  });
}

export async function saveSettingsAction(fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser('settings.accounting');
    const entityId = str(fd, 'entityId');
    assertEntityAccess(user, entityId);
    const jy = Number(str(fd, 'jy'));
    if (!jy) throw new AppError('سال را وارد کنید.');

    const brackets: TaxBracket[] = [];
    for (let i = 0; i < 8; i++) {
      const to = str(fd, `bracketTo${i}`);
      const rate = str(fd, `bracketRate${i}`);
      if (!rate) continue;
      brackets.push({ to: to ? Number(to.replace(/[^\d]/g, '')) : null, rate: Number(rate) });
    }
    validateBrackets(brackets);

    const accounts: PayrollAccounts = {
      salaryExpense: str(fd, 'acc_salaryExpense'),
      overtimeExpense: str(fd, 'acc_overtimeExpense'),
      employerInsuranceExpense: str(fd, 'acc_employerInsuranceExpense'),
      severanceExpense: str(fd, 'acc_severanceExpense'),
      salaryPayable: str(fd, 'acc_salaryPayable'),
      insurancePayable: str(fd, 'acc_insurancePayable'),
      taxPayable: str(fd, 'acc_taxPayable'),
      severanceProvision: str(fd, 'acc_severanceProvision'),
      employeeLoan: str(fd, 'acc_employeeLoan'),
    };
    for (const [k, code] of Object.entries(accounts)) {
      if (!/^\d{3,6}$/.test(code)) throw new AppError(`کد حساب «${k}» معتبر نیست.`);
    }

    const data = {
      dailyMinWage: toBig(str(fd, 'dailyMinWage') || '0'),
      monthlyWorkHours: Number(str(fd, 'monthlyWorkHours') || '192'),
      insuranceEmployeeRate: Number(str(fd, 'insuranceEmployeeRate') || '7'),
      insuranceEmployerRate: Number(str(fd, 'insuranceEmployerRate') || '23'),
      insuranceCeiling: toBig(str(fd, 'insuranceCeiling') || '0'),
      taxExemptMonthly: toBig(str(fd, 'taxExemptMonthly') || '0'),
      taxBrackets: brackets as unknown as object,
      childAllowanceRate: toBig(str(fd, 'childAllowanceRate') || '0'),
      housingDefault: toBig(str(fd, 'housingDefault') || '0'),
      foodDefault: toBig(str(fd, 'foodDefault') || '0'),
      overtimeFactor: Number(str(fd, 'overtimeFactor') || '1.4'),
      holidayFactor: Number(str(fd, 'holidayFactor') || '1.4'),
      nightFactor: Number(str(fd, 'nightFactor') || '0.35'),
      severanceDaysPerYear: Number(str(fd, 'severanceDaysPerYear') || '30'),
      accounts: accounts as unknown as object,
    };
    await prisma.payrollSettings.upsert({
      where: { entityId_jy: { entityId, jy } },
      update: data,
      create: { entityId, jy, ...data },
    });
    return { message: `تنظیمات سال ${jy} ذخیره شد.` };
  });
}
