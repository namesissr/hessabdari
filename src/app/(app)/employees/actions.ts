'use server';

import type { ContractType, EmployeeStatus, Gender, LeaveType, MaritalStatus } from '@prisma/client';
import prisma from '@/lib/prisma';
import { assertEntityAccess, requireUser } from '@/lib/auth';
import { run, str, optStr, type ActionResult } from '@/lib/action';
import { AppError } from '@/lib/errors';
import { parseJ } from '@/lib/jalali';
import { toBig } from '@/lib/money';
import { addContract, addLeave, addLoan, cancelLoan, deleteLeave, saveEmployee } from '@/modules/hr/employees';

export async function saveEmployeeAction(fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser('voucher.edit');
    const entityId = str(fd, 'entityId');
    assertEntityAccess(user, entityId);
    const id = optStr(fd, 'id');
    const hireDate = parseJ(str(fd, 'hireDate'));
    if (!hireDate) throw new AppError('تاریخ استخدام را وارد کنید.');
    const emp = await saveEmployee(
      prisma,
      user.id,
      {
        entityId,
        code: optStr(fd, 'code'),
        firstName: str(fd, 'firstName'),
        lastName: str(fd, 'lastName'),
        fatherName: optStr(fd, 'fatherName'),
        nationalCode: optStr(fd, 'nationalCode'),
        idNumber: optStr(fd, 'idNumber'),
        birthDate: parseJ(str(fd, 'birthDate')),
        gender: (str(fd, 'gender') || 'MALE') as Gender,
        maritalStatus: (str(fd, 'maritalStatus') || 'SINGLE') as MaritalStatus,
        childrenCount: Number(str(fd, 'childrenCount') || '0'),
        mobile: optStr(fd, 'mobile'),
        phone: optStr(fd, 'phone'),
        email: optStr(fd, 'email'),
        address: optStr(fd, 'address'),
        emergencyName: optStr(fd, 'emergencyName'),
        emergencyPhone: optStr(fd, 'emergencyPhone'),
        hireDate,
        contractType: (str(fd, 'contractType') || 'PERMANENT') as ContractType,
        position: optStr(fd, 'position'),
        businessDimId: optStr(fd, 'businessDimId'),
        costCenterDimId: optStr(fd, 'costCenterDimId'),
        managerId: optStr(fd, 'managerId'),
        insuranceNo: optStr(fd, 'insuranceNo'),
        insured: fd.get('insured') === 'on',
        taxFileNo: optStr(fd, 'taxFileNo'),
        taxExempt: fd.get('taxExempt') === 'on',
        bankName: optStr(fd, 'bankName'),
        accountNo: optStr(fd, 'accountNo'),
        iban: optStr(fd, 'iban'),
        baseSalary: toBig(str(fd, 'baseSalary') || '0'),
        housingAllowance: toBig(str(fd, 'housingAllowance') || '0'),
        foodAllowance: toBig(str(fd, 'foodAllowance') || '0'),
        childAllowance: toBig(str(fd, 'childAllowance') || '0'),
        transportAllowance: toBig(str(fd, 'transportAllowance') || '0'),
        otherAllowance: toBig(str(fd, 'otherAllowance') || '0'),
        severanceStartDate: parseJ(str(fd, 'severanceStartDate')),
        status: (str(fd, 'status') || 'ACTIVE') as EmployeeStatus,
        terminationDate: parseJ(str(fd, 'terminationDate')),
        terminationReason: optStr(fd, 'terminationReason'),
        notes: optStr(fd, 'notes'),
      },
      id,
    );
    return { redirect: `/employees/${emp.id}`, message: id ? 'ذخیره شد.' : 'کارمند ثبت شد.' };
  });
}

export async function addContractAction(employeeId: string, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser('voucher.edit');
    const emp = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } });
    assertEntityAccess(user, emp.entityId);
    const startDate = parseJ(str(fd, 'startDate'));
    if (!startDate) throw new AppError('تاریخ شروع حکم را وارد کنید.');
    await addContract(prisma, user.id, {
      employeeId,
      startDate,
      endDate: parseJ(str(fd, 'endDate')),
      contractType: (str(fd, 'contractType') || emp.contractType) as ContractType,
      position: optStr(fd, 'position'),
      baseSalary: toBig(str(fd, 'baseSalary') || '0'),
      housingAllowance: toBig(str(fd, 'housingAllowance') || '0'),
      foodAllowance: toBig(str(fd, 'foodAllowance') || '0'),
      transportAllowance: toBig(str(fd, 'transportAllowance') || '0'),
      otherAllowance: toBig(str(fd, 'otherAllowance') || '0'),
      note: optStr(fd, 'note'),
      applyToEmployee: fd.get('apply') === 'on',
    });
    return { message: 'حکم جدید ثبت شد.' };
  });
}

export async function addLeaveAction(employeeId: string, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser('voucher.edit');
    const emp = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } });
    assertEntityAccess(user, emp.entityId);
    const fromDate = parseJ(str(fd, 'fromDate'));
    const toDate = parseJ(str(fd, 'toDate'));
    if (!fromDate || !toDate) throw new AppError('تاریخ شروع و پایان مرخصی را وارد کنید.');
    const days = Number(str(fd, 'days') || '0') || (toDate.getTime() - fromDate.getTime()) / 86400000 + 1;
    await addLeave(prisma, user.id, { employeeId, type: (str(fd, 'type') || 'ANNUAL') as LeaveType, fromDate, toDate, days, note: optStr(fd, 'note') });
    return { message: 'مرخصی ثبت شد.' };
  });
}

export async function deleteLeaveAction(id: string): Promise<ActionResult> {
  return run(async () => {
    await requireUser('voucher.edit');
    await deleteLeave(prisma, id);
    return { message: 'حذف شد.' };
  });
}

export async function addLoanAction(employeeId: string, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser('voucher.post');
    const emp = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } });
    assertEntityAccess(user, emp.entityId);
    const date = parseJ(str(fd, 'date'));
    if (!date) throw new AppError('تاریخ پرداخت را وارد کنید.');
    await addLoan(prisma, user.id, {
      employeeId,
      date,
      amount: toBig(str(fd, 'amount') || '0'),
      installmentAmount: toBig(str(fd, 'installmentAmount') || '0'),
      isAdvance: fd.get('isAdvance') === 'on',
      description: optStr(fd, 'description'),
      bankAccountId: optStr(fd, 'bankAccountId'),
    });
    return { message: 'وام/مساعده ثبت شد.' };
  });
}

export async function cancelLoanAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser('voucher.post');
    await cancelLoan(prisma, user.id, id);
    return { message: 'ابطال شد.' };
  });
}
