import { Prisma, type ContractType, type EmployeeStatus, type Gender, type LeaveType, type MaritalStatus, type PrismaClient } from '@prisma/client';
import { AppError } from '@/lib/errors';
import { writeAudit } from '@/lib/audit';
import { createAndPostTx } from '@/modules/ledger/posting';
import { dimTypeIds } from '@/modules/treasury/accounts';
import { nextSequence } from '@/modules/ledger/posting';
import { payrollSettings } from './settings';

export const STATUS_LABEL: Record<EmployeeStatus, string> = {
  ACTIVE: 'شاغل',
  ON_LEAVE: 'مرخصی بلندمدت',
  SUSPENDED: 'تعلیق',
  TERMINATED: 'پایان همکاری',
};

export const CONTRACT_LABEL: Record<ContractType, string> = {
  PERMANENT: 'دائم',
  TEMPORARY: 'مدت معین',
  PROJECT: 'پروژه‌ای',
  HOURLY: 'ساعتی',
  CONTRACTOR: 'پیمانکار',
  INTERN: 'کارآموز',
};

export const LEAVE_LABEL: Record<LeaveType, string> = {
  ANNUAL: 'استحقاقی',
  SICK: 'استعلاجی',
  UNPAID: 'بدون حقوق',
  MISSION: 'مأموریت',
  OTHER: 'سایر',
};

export type EmployeeInput = {
  entityId: string;
  code?: string | null;
  firstName: string;
  lastName: string;
  fatherName?: string | null;
  nationalCode?: string | null;
  idNumber?: string | null;
  birthDate?: Date | null;
  gender: Gender;
  maritalStatus: MaritalStatus;
  childrenCount: number;
  mobile?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  emergencyName?: string | null;
  emergencyPhone?: string | null;
  hireDate: Date;
  contractType: ContractType;
  position?: string | null;
  businessDimId?: string | null;
  costCenterDimId?: string | null;
  managerId?: string | null;
  insuranceNo?: string | null;
  insured: boolean;
  taxFileNo?: string | null;
  taxExempt: boolean;
  bankName?: string | null;
  accountNo?: string | null;
  iban?: string | null;
  baseSalary: bigint;
  housingAllowance: bigint;
  foodAllowance: bigint;
  childAllowance: bigint;
  transportAllowance: bigint;
  otherAllowance: bigint;
  severanceStartDate?: Date | null;
  status: EmployeeStatus;
  terminationDate?: Date | null;
  terminationReason?: string | null;
  notes?: string | null;
};

function validate(input: EmployeeInput) {
  if (!input.firstName.trim() || !input.lastName.trim()) throw new AppError('نام و نام خانوادگی الزامی است.');
  if (input.nationalCode && !/^\d{10}$/.test(input.nationalCode)) throw new AppError('کد ملی باید ۱۰ رقم باشد.');
  if (input.iban && !/^(IR)?\d{24}$/.test(input.iban.replace(/\s/g, ''))) throw new AppError('شمارهٔ شبا باید ۲۴ رقم باشد.');
  if (input.baseSalary < 0n) throw new AppError('حقوق پایه نمی‌تواند منفی باشد.');
  if (input.childrenCount < 0 || input.childrenCount > 20) throw new AppError('تعداد فرزندان معتبر نیست.');
  if (input.status === 'TERMINATED' && !input.terminationDate) throw new AppError('برای پایان همکاری، تاریخ آن را وارد کنید.');
}

/** ثبت/ویرایش کارمند؛ طرف حساب متناظر خودکار ساخته و هم‌نام می‌شود */
export async function saveEmployee(db: PrismaClient, userId: string, input: EmployeeInput, id?: string | null) {
  validate(input);
  const fullName = `${input.firstName.trim()} ${input.lastName.trim()}`;
  return db.$transaction(async (tx) => {
    const data = {
      entityId: input.entityId,
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      fatherName: input.fatherName ?? null,
      nationalCode: input.nationalCode ?? null,
      idNumber: input.idNumber ?? null,
      birthDate: input.birthDate ?? null,
      gender: input.gender,
      maritalStatus: input.maritalStatus,
      childrenCount: input.childrenCount,
      mobile: input.mobile ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      address: input.address ?? null,
      emergencyName: input.emergencyName ?? null,
      emergencyPhone: input.emergencyPhone ?? null,
      hireDate: input.hireDate,
      contractType: input.contractType,
      position: input.position ?? null,
      businessDimId: input.businessDimId ?? null,
      costCenterDimId: input.costCenterDimId ?? null,
      managerId: input.managerId ?? null,
      insuranceNo: input.insuranceNo ?? null,
      insured: input.insured,
      taxFileNo: input.taxFileNo ?? null,
      taxExempt: input.taxExempt,
      bankName: input.bankName ?? null,
      accountNo: input.accountNo ?? null,
      iban: input.iban ? input.iban.replace(/\s/g, '') : null,
      baseSalary: input.baseSalary,
      housingAllowance: input.housingAllowance,
      foodAllowance: input.foodAllowance,
      childAllowance: input.childAllowance,
      transportAllowance: input.transportAllowance,
      otherAllowance: input.otherAllowance,
      severanceStartDate: input.severanceStartDate ?? null,
      status: input.status,
      terminationDate: input.terminationDate ?? null,
      terminationReason: input.terminationReason ?? null,
      notes: input.notes ?? null,
    };

    if (id) {
      const old = await tx.employee.findUniqueOrThrow({ where: { id }, include: { party: true } });
      const employee = await tx.employee.update({ where: { id }, data: { ...data, ...(input.code ? { code: input.code.trim() } : {}) } });
      await tx.dimensionValue.update({
        where: { id: old.party.dimensionValueId },
        data: { name: fullName, active: input.status !== 'TERMINATED' },
      });
      await tx.party.update({ where: { id: old.partyId }, data: { nationalCode: data.nationalCode, mobile: data.mobile, iban: data.iban, bankName: data.bankName, accountNo: data.accountNo, active: input.status !== 'TERMINATED' } });
      await writeAudit(tx, { userId, action: 'employee.update', objectType: 'Employee', objectId: id, entityId: input.entityId, data: { name: fullName, status: input.status } });
      return employee;
    }

    const code = input.code?.trim() || String(await nextSequence(tx, `employee:${input.entityId}`)).padStart(4, '0');
    const partyType = await tx.dimensionType.findUniqueOrThrow({ where: { code: 'PARTY' } });
    const value = await tx.dimensionValue.create({ data: { typeId: partyType.id, code: `E-${code}`, name: fullName, entityId: input.entityId } });
    const party = await tx.party.create({
      data: {
        dimensionValueId: value.id,
        entityId: input.entityId,
        kind: 'PERSON',
        nationalCode: data.nationalCode,
        mobile: data.mobile,
        iban: data.iban,
        bankName: data.bankName,
        accountNo: data.accountNo,
        roles: ['EMPLOYEE'],
      },
    });
    const employee = await tx.employee.create({ data: { ...data, code, partyId: party.id, createdById: userId } });
    await tx.employeeContract.create({
      data: {
        employeeId: employee.id,
        startDate: input.hireDate,
        contractType: input.contractType,
        position: input.position ?? null,
        baseSalary: input.baseSalary,
        housingAllowance: input.housingAllowance,
        foodAllowance: input.foodAllowance,
        transportAllowance: input.transportAllowance,
        otherAllowance: input.otherAllowance,
        note: 'قرارداد اولیه',
      },
    });
    await writeAudit(tx, { userId, action: 'employee.create', objectType: 'Employee', objectId: employee.id, entityId: input.entityId, data: { code, name: fullName } });
    return employee;
  });
}

/** حکم/قرارداد جدید: حقوق کارمند از این تاریخ به بعد تغییر می‌کند */
export async function addContract(
  db: PrismaClient,
  userId: string,
  input: {
    employeeId: string;
    startDate: Date;
    endDate?: Date | null;
    contractType: ContractType;
    position?: string | null;
    baseSalary: bigint;
    housingAllowance: bigint;
    foodAllowance: bigint;
    transportAllowance: bigint;
    otherAllowance: bigint;
    note?: string | null;
    applyToEmployee: boolean;
  },
) {
  return db.$transaction(async (tx) => {
    const emp = await tx.employee.findUniqueOrThrow({ where: { id: input.employeeId } });
    const contract = await tx.employeeContract.create({
      data: {
        employeeId: input.employeeId,
        startDate: input.startDate,
        endDate: input.endDate ?? null,
        contractType: input.contractType,
        position: input.position ?? null,
        baseSalary: input.baseSalary,
        housingAllowance: input.housingAllowance,
        foodAllowance: input.foodAllowance,
        transportAllowance: input.transportAllowance,
        otherAllowance: input.otherAllowance,
        note: input.note ?? null,
      },
    });
    if (input.applyToEmployee) {
      await tx.employee.update({
        where: { id: input.employeeId },
        data: {
          contractType: input.contractType,
          position: input.position ?? emp.position,
          baseSalary: input.baseSalary,
          housingAllowance: input.housingAllowance,
          foodAllowance: input.foodAllowance,
          transportAllowance: input.transportAllowance,
          otherAllowance: input.otherAllowance,
        },
      });
    }
    await writeAudit(tx, { userId, action: 'employee.contract', objectType: 'Employee', objectId: input.employeeId, entityId: emp.entityId, data: { baseSalary: input.baseSalary } });
    return contract;
  });
}

export async function addLeave(db: PrismaClient, userId: string, input: { employeeId: string; type: LeaveType; fromDate: Date; toDate: Date; days: number; note?: string | null }) {
  if (input.toDate < input.fromDate) throw new AppError('تاریخ پایان مرخصی قبل از شروع است.');
  if (input.days <= 0) throw new AppError('تعداد روز مرخصی باید بزرگ‌تر از صفر باشد.');
  return db.leaveRecord.create({
    data: { employeeId: input.employeeId, type: input.type, fromDate: input.fromDate, toDate: input.toDate, days: new Prisma.Decimal(input.days), note: input.note ?? null },
  });
}

export async function deleteLeave(db: PrismaClient, id: string) {
  await db.leaveRecord.delete({ where: { id } });
}

/** وام یا مساعده به کارمند؛ در صورت پرداخت نقدی، سند هم صادر می‌شود */
export async function addLoan(
  db: PrismaClient,
  userId: string,
  input: { employeeId: string; date: Date; amount: bigint; installmentAmount: bigint; isAdvance: boolean; description?: string | null; bankAccountId?: string | null },
) {
  if (input.amount <= 0n) throw new AppError('مبلغ وام باید بزرگ‌تر از صفر باشد.');
  return db.$transaction(async (tx) => {
    const emp = await tx.employee.findUniqueOrThrow({ where: { id: input.employeeId }, include: { party: true, entity: true } });
    let voucherId: string | null = null;

    if (input.bankAccountId) {
      const bank = await tx.bankAccount.findUniqueOrThrow({ where: { id: input.bankAccountId } });
      const settings = await payrollSettings(tx, emp.entityId, 1400);
      const loanAcc = await tx.account.findFirst({ where: { chartId: emp.entity.chartId, code: settings.accounts.employeeLoan } });
      if (!loanAcc) throw new AppError('حساب وام کارکنان در چارت پیدا نشد.');
      const dims = await dimTypeIds(tx);
      const v = await createAndPostTx(tx, userId, {
        entityId: emp.entityId,
        date: input.date,
        type: 'SYSTEM',
        sourceModule: 'payroll-loan',
        sourceRef: input.employeeId,
        description: `${input.isAdvance ? 'مساعده' : 'وام'} به ${emp.firstName} ${emp.lastName}`,
        lines: [
          { accountId: loanAcc.id, debit: input.amount, dims: { [dims.PARTY]: emp.party.dimensionValueId } },
          { accountId: bank.glAccountId, credit: input.amount, dims: { [dims.BANK_ACCOUNT]: bank.dimensionValueId } },
        ],
      });
      voucherId = v.id;
    }

    const loan = await tx.employeeLoan.create({
      data: {
        employeeId: input.employeeId,
        date: input.date,
        amount: input.amount,
        installmentAmount: input.installmentAmount,
        isAdvance: input.isAdvance,
        description: input.description ?? null,
        voucherId,
        createdById: userId,
      },
    });
    await writeAudit(tx, { userId, action: 'employee.loan', objectType: 'Employee', objectId: input.employeeId, entityId: emp.entityId, data: { amount: input.amount, isAdvance: input.isAdvance } });
    return loan;
  });
}

export async function cancelLoan(db: PrismaClient, userId: string, id: string) {
  return db.$transaction(async (tx) => {
    const loan = await tx.employeeLoan.findUniqueOrThrow({ where: { id } });
    if (loan.paidAmount > 0n) throw new AppError('برای این وام قسط کسر شده؛ قابل ابطال نیست.');
    await tx.employeeLoan.update({ where: { id }, data: { status: 'CANCELLED' } });
    await writeAudit(tx, { userId, action: 'employee.loan_cancel', objectType: 'EmployeeLoan', objectId: id });
  });
}

/** پروندهٔ کامل یک کارمند */
export async function employeeProfile(db: PrismaClient, id: string) {
  return db.employee.findUnique({
    where: { id },
    include: {
      party: { include: { dimensionValue: true } },
      manager: true,
      contracts: { orderBy: { startDate: 'desc' } },
      leaves: { orderBy: { fromDate: 'desc' } },
      loans: { orderBy: { date: 'desc' } },
      payslips: { include: { run: true }, orderBy: [{ run: { jy: 'desc' } }, { run: { jm: 'desc' } }] },
      entity: true,
    },
  });
}
