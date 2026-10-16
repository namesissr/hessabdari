-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "ContractType" AS ENUM ('PERMANENT', 'TEMPORARY', 'PROJECT', 'HOURLY', 'CONTRACTOR', 'INTERN');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE');

-- CreateEnum
CREATE TYPE "MaritalStatus" AS ENUM ('SINGLE', 'MARRIED');

-- CreateEnum
CREATE TYPE "LeaveType" AS ENUM ('ANNUAL', 'SICK', 'UNPAID', 'MISSION', 'OTHER');

-- CreateEnum
CREATE TYPE "EmployeeLoanStatus" AS ENUM ('ACTIVE', 'SETTLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PayrollStatus" AS ENUM ('DRAFT', 'POSTED');

-- CreateTable
CREATE TABLE "employees" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "fatherName" TEXT,
    "nationalCode" TEXT,
    "idNumber" TEXT,
    "birthDate" DATE,
    "gender" "Gender" NOT NULL DEFAULT 'MALE',
    "maritalStatus" "MaritalStatus" NOT NULL DEFAULT 'SINGLE',
    "childrenCount" INTEGER NOT NULL DEFAULT 0,
    "mobile" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "emergencyName" TEXT,
    "emergencyPhone" TEXT,
    "hireDate" DATE NOT NULL,
    "contractType" "ContractType" NOT NULL DEFAULT 'PERMANENT',
    "position" TEXT,
    "businessDimId" TEXT,
    "costCenterDimId" TEXT,
    "managerId" TEXT,
    "insuranceNo" TEXT,
    "insured" BOOLEAN NOT NULL DEFAULT true,
    "taxFileNo" TEXT,
    "taxExempt" BOOLEAN NOT NULL DEFAULT false,
    "bankName" TEXT,
    "accountNo" TEXT,
    "iban" TEXT,
    "baseSalary" BIGINT NOT NULL DEFAULT 0,
    "housingAllowance" BIGINT NOT NULL DEFAULT 0,
    "foodAllowance" BIGINT NOT NULL DEFAULT 0,
    "childAllowance" BIGINT NOT NULL DEFAULT 0,
    "transportAllowance" BIGINT NOT NULL DEFAULT 0,
    "otherAllowance" BIGINT NOT NULL DEFAULT 0,
    "severanceStartDate" DATE,
    "status" "EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
    "terminationDate" DATE,
    "terminationReason" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_contracts" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "contractType" "ContractType" NOT NULL,
    "position" TEXT,
    "baseSalary" BIGINT NOT NULL,
    "housingAllowance" BIGINT NOT NULL DEFAULT 0,
    "foodAllowance" BIGINT NOT NULL DEFAULT 0,
    "transportAllowance" BIGINT NOT NULL DEFAULT 0,
    "otherAllowance" BIGINT NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_records" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" "LeaveType" NOT NULL,
    "fromDate" DATE NOT NULL,
    "toDate" DATE NOT NULL,
    "days" DECIMAL(6,2) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leave_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_loans" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amount" BIGINT NOT NULL,
    "installmentAmount" BIGINT NOT NULL DEFAULT 0,
    "paidAmount" BIGINT NOT NULL DEFAULT 0,
    "isAdvance" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "voucherId" TEXT,
    "status" "EmployeeLoanStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_loans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_runs" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "jy" INTEGER NOT NULL,
    "jm" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "payDate" DATE,
    "status" "PayrollStatus" NOT NULL DEFAULT 'DRAFT',
    "voucherId" TEXT,
    "totalGross" BIGINT NOT NULL DEFAULT 0,
    "totalNet" BIGINT NOT NULL DEFAULT 0,
    "totalTax" BIGINT NOT NULL DEFAULT 0,
    "totalInsurance" BIGINT NOT NULL DEFAULT 0,
    "totalEmployerCost" BIGINT NOT NULL DEFAULT 0,
    "settings" JSONB,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_items" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "workingDays" DECIMAL(6,2) NOT NULL DEFAULT 30,
    "absenceDays" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "overtimeHours" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "holidayHours" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "nightHours" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "missionDays" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "baseAmount" BIGINT NOT NULL DEFAULT 0,
    "housingAllowance" BIGINT NOT NULL DEFAULT 0,
    "foodAllowance" BIGINT NOT NULL DEFAULT 0,
    "childAllowance" BIGINT NOT NULL DEFAULT 0,
    "transportAllowance" BIGINT NOT NULL DEFAULT 0,
    "otherAllowance" BIGINT NOT NULL DEFAULT 0,
    "overtimeAmount" BIGINT NOT NULL DEFAULT 0,
    "holidayAmount" BIGINT NOT NULL DEFAULT 0,
    "nightAmount" BIGINT NOT NULL DEFAULT 0,
    "missionAmount" BIGINT NOT NULL DEFAULT 0,
    "bonus" BIGINT NOT NULL DEFAULT 0,
    "grossEarnings" BIGINT NOT NULL DEFAULT 0,
    "insuranceBase" BIGINT NOT NULL DEFAULT 0,
    "insuranceEmployee" BIGINT NOT NULL DEFAULT 0,
    "insuranceEmployer" BIGINT NOT NULL DEFAULT 0,
    "taxBase" BIGINT NOT NULL DEFAULT 0,
    "tax" BIGINT NOT NULL DEFAULT 0,
    "loanDeduction" BIGINT NOT NULL DEFAULT 0,
    "advanceDeduction" BIGINT NOT NULL DEFAULT 0,
    "otherDeduction" BIGINT NOT NULL DEFAULT 0,
    "totalDeductions" BIGINT NOT NULL DEFAULT 0,
    "netPay" BIGINT NOT NULL DEFAULT 0,
    "severanceAccrual" BIGINT NOT NULL DEFAULT 0,
    "leaveAccrual" BIGINT NOT NULL DEFAULT 0,
    "employerCost" BIGINT NOT NULL DEFAULT 0,
    "note" TEXT,

    CONSTRAINT "payroll_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_settings" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "jy" INTEGER NOT NULL,
    "dailyMinWage" BIGINT NOT NULL DEFAULT 0,
    "monthlyWorkHours" DECIMAL(6,2) NOT NULL DEFAULT 192,
    "insuranceEmployeeRate" DECIMAL(5,2) NOT NULL DEFAULT 7,
    "insuranceEmployerRate" DECIMAL(5,2) NOT NULL DEFAULT 23,
    "insuranceCeiling" BIGINT NOT NULL DEFAULT 0,
    "taxExemptMonthly" BIGINT NOT NULL DEFAULT 0,
    "taxBrackets" JSONB NOT NULL,
    "childAllowanceRate" BIGINT NOT NULL DEFAULT 0,
    "housingDefault" BIGINT NOT NULL DEFAULT 0,
    "foodDefault" BIGINT NOT NULL DEFAULT 0,
    "overtimeFactor" DECIMAL(5,2) NOT NULL DEFAULT 1.4,
    "holidayFactor" DECIMAL(5,2) NOT NULL DEFAULT 1.4,
    "nightFactor" DECIMAL(5,2) NOT NULL DEFAULT 0.35,
    "severanceDaysPerYear" INTEGER NOT NULL DEFAULT 30,
    "accounts" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "employees_partyId_key" ON "employees"("partyId");

-- CreateIndex
CREATE INDEX "employees_entityId_status_idx" ON "employees"("entityId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "employees_entityId_code_key" ON "employees"("entityId", "code");

-- CreateIndex
CREATE INDEX "employee_contracts_employeeId_idx" ON "employee_contracts"("employeeId");

-- CreateIndex
CREATE INDEX "leave_records_employeeId_idx" ON "leave_records"("employeeId");

-- CreateIndex
CREATE INDEX "employee_loans_employeeId_idx" ON "employee_loans"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_runs_voucherId_key" ON "payroll_runs"("voucherId");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_runs_entityId_jy_jm_key" ON "payroll_runs"("entityId", "jy", "jm");

-- CreateIndex
CREATE INDEX "payroll_items_employeeId_idx" ON "payroll_items"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_items_runId_employeeId_key" ON "payroll_items"("runId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_settings_entityId_jy_key" ON "payroll_settings"("entityId", "jy");

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_contracts" ADD CONSTRAINT "employee_contracts_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_records" ADD CONSTRAINT "leave_records_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_loans" ADD CONSTRAINT "employee_loans_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_loans" ADD CONSTRAINT "employee_loans_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "vouchers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_loans" ADD CONSTRAINT "employee_loans_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "fiscal_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "vouchers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_runId_fkey" FOREIGN KEY ("runId") REFERENCES "payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_settings" ADD CONSTRAINT "payroll_settings_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

