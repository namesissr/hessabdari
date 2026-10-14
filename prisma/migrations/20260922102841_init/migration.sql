-- CreateEnum
CREATE TYPE "EntityStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "OwnershipMethod" AS ENUM ('SUBSIDIARY', 'ASSOCIATE', 'COST');

-- CreateEnum
CREATE TYPE "FiscalYearStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "PeriodStatus" AS ENUM ('OPEN', 'LOCKED', 'CLOSED');

-- CreateEnum
CREATE TYPE "BusinessKind" AS ENUM ('WEBSITE', 'TRADING', 'PROJECT', 'INVESTMENT', 'HEADQUARTERS', 'OTHER');

-- CreateEnum
CREATE TYPE "AccountLevel" AS ENUM ('GROUP', 'GL', 'SUBSIDIARY');

-- CreateEnum
CREATE TYPE "AccountCategory" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE', 'MEMO');

-- CreateEnum
CREATE TYPE "NormalSide" AS ENUM ('DEBIT', 'CREDIT', 'BOTH');

-- CreateEnum
CREATE TYPE "DimRequirement" AS ENUM ('REQUIRED', 'OPTIONAL', 'FORBIDDEN');

-- CreateEnum
CREATE TYPE "VoucherType" AS ENUM ('OPENING', 'NORMAL', 'ADJUSTMENT', 'ALLOCATION', 'REVERSAL', 'SYSTEM', 'PL_CLOSING', 'CLOSING');

-- CreateEnum
CREATE TYPE "VoucherStatus" AS ENUM ('DRAFT', 'REVIEWED', 'POSTED');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'FINANCE_MANAGER', 'ACCOUNTANT', 'VIEWER');

-- CreateTable
CREATE TABLE "entities" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "legalType" TEXT,
    "nationalId" TEXT,
    "economicCode" TEXT,
    "registrationNo" TEXT,
    "address" TEXT,
    "baseCurrency" TEXT NOT NULL DEFAULT 'IRR',
    "fiscalStartMonth" INTEGER NOT NULL DEFAULT 1,
    "fiscalStartDay" INTEGER NOT NULL DEFAULT 1,
    "parentId" TEXT,
    "chartId" TEXT NOT NULL,
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity_ownerships" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "ownedId" TEXT NOT NULL,
    "percent" DECIMAL(9,4) NOT NULL,
    "method" "OwnershipMethod" NOT NULL,
    "validFrom" DATE NOT NULL,
    "validTo" DATE,

    CONSTRAINT "entity_ownerships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_years" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "FiscalYearStatus" NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fiscal_years_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_periods" (
    "id" TEXT NOT NULL,
    "fiscalYearId" TEXT NOT NULL,
    "no" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "PeriodStatus" NOT NULL DEFAULT 'OPEN',

    CONSTRAINT "fiscal_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dimension_types" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isHierarchical" BOOLEAN NOT NULL DEFAULT false,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dimension_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dimension_values" (
    "id" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "entityId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "attributes" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dimension_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_units" (
    "dimensionValueId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "kind" "BusinessKind" NOT NULL DEFAULT 'WEBSITE',
    "domain" TEXT,
    "launchedAt" DATE,
    "description" TEXT,

    CONSTRAINT "business_units_pkey" PRIMARY KEY ("dimensionValueId")
);

-- CreateTable
CREATE TABLE "dimension_sets" (
    "id" SERIAL NOT NULL,
    "hash" TEXT NOT NULL,

    CONSTRAINT "dimension_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dimension_set_items" (
    "setId" INTEGER NOT NULL,
    "typeId" TEXT NOT NULL,
    "valueId" TEXT NOT NULL,

    CONSTRAINT "dimension_set_items_pkey" PRIMARY KEY ("setId","typeId")
);

-- CreateTable
CREATE TABLE "charts" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isGroupTemplate" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "charts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "chartId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" "AccountLevel" NOT NULL,
    "parentId" TEXT,
    "category" "AccountCategory" NOT NULL,
    "normalSide" "NormalSide" NOT NULL,
    "isPostable" BOOLEAN NOT NULL DEFAULT false,
    "allowFx" BOOLEAN NOT NULL DEFAULT false,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "systemRole" TEXT,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_dimension_rules" (
    "accountId" TEXT NOT NULL,
    "dimensionTypeId" TEXT NOT NULL,
    "requirement" "DimRequirement" NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "account_dimension_rules_pkey" PRIMARY KEY ("accountId","dimensionTypeId")
);

-- CreateTable
CREATE TABLE "vouchers" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "fiscalYearId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "number" INTEGER,
    "draftNo" INTEGER NOT NULL,
    "dailyNo" INTEGER,
    "date" DATE NOT NULL,
    "type" "VoucherType" NOT NULL DEFAULT 'NORMAL',
    "status" "VoucherStatus" NOT NULL DEFAULT 'DRAFT',
    "description" TEXT,
    "sourceModule" TEXT,
    "sourceRef" TEXT,
    "idempotencyKey" TEXT,
    "reversalOfId" TEXT,
    "totalAmount" BIGINT NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "reviewedById" TEXT,
    "postedById" TEXT,
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vouchers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voucher_lines" (
    "id" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "accountId" TEXT NOT NULL,
    "dimensionSetId" INTEGER NOT NULL,
    "debit" BIGINT NOT NULL DEFAULT 0,
    "credit" BIGINT NOT NULL DEFAULT 0,
    "currency" TEXT,
    "fxAmount" DECIMAL(28,6),
    "fxRate" DECIMAL(24,6),
    "quantity" DECIMAL(28,10),
    "unit" TEXT,
    "dueDate" DATE,
    "description" TEXT,

    CONSTRAINT "voucher_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gl_balances" (
    "entityId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "dimensionSetId" INTEGER NOT NULL,
    "debit" BIGINT NOT NULL DEFAULT 0,
    "credit" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "gl_balances_pkey" PRIMARY KEY ("periodId","accountId","dimensionSetId")
);

-- CreateTable
CREATE TABLE "number_sequences" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "number_sequences_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "exchange_rates" (
    "id" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "rate" DECIMAL(24,6) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'ACCOUNTANT',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_scopes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entityId" TEXT,
    "dimensionValueId" TEXT,

    CONSTRAINT "user_scopes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "objectType" TEXT NOT NULL,
    "objectId" TEXT,
    "entityId" TEXT,
    "data" JSONB,
    "prevHash" TEXT,
    "hash" TEXT NOT NULL,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "entities_code_key" ON "entities"("code");

-- CreateIndex
CREATE INDEX "fiscal_years_entityId_startDate_idx" ON "fiscal_years"("entityId", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_years_entityId_title_key" ON "fiscal_years"("entityId", "title");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_periods_fiscalYearId_no_key" ON "fiscal_periods"("fiscalYearId", "no");

-- CreateIndex
CREATE UNIQUE INDEX "dimension_types_code_key" ON "dimension_types"("code");

-- CreateIndex
CREATE UNIQUE INDEX "dimension_values_typeId_code_key" ON "dimension_values"("typeId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "dimension_sets_hash_key" ON "dimension_sets"("hash");

-- CreateIndex
CREATE INDEX "dimension_set_items_valueId_idx" ON "dimension_set_items"("valueId");

-- CreateIndex
CREATE UNIQUE INDEX "charts_code_key" ON "charts"("code");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_chartId_code_key" ON "accounts"("chartId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_chartId_systemRole_key" ON "accounts"("chartId", "systemRole");

-- CreateIndex
CREATE UNIQUE INDEX "vouchers_idempotencyKey_key" ON "vouchers"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "vouchers_reversalOfId_key" ON "vouchers"("reversalOfId");

-- CreateIndex
CREATE INDEX "vouchers_entityId_date_idx" ON "vouchers"("entityId", "date");

-- CreateIndex
CREATE INDEX "vouchers_status_idx" ON "vouchers"("status");

-- CreateIndex
CREATE UNIQUE INDEX "vouchers_fiscalYearId_number_key" ON "vouchers"("fiscalYearId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "vouchers_fiscalYearId_draftNo_key" ON "vouchers"("fiscalYearId", "draftNo");

-- CreateIndex
CREATE INDEX "voucher_lines_voucherId_idx" ON "voucher_lines"("voucherId");

-- CreateIndex
CREATE INDEX "voucher_lines_accountId_idx" ON "voucher_lines"("accountId");

-- CreateIndex
CREATE INDEX "voucher_lines_dimensionSetId_idx" ON "voucher_lines"("dimensionSetId");

-- CreateIndex
CREATE INDEX "gl_balances_entityId_idx" ON "gl_balances"("entityId");

-- CreateIndex
CREATE UNIQUE INDEX "exchange_rates_currency_date_source_key" ON "exchange_rates"("currency", "date", "source");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "audit_log_objectType_objectId_idx" ON "audit_log"("objectType", "objectId");

-- AddForeignKey
ALTER TABLE "entities" ADD CONSTRAINT "entities_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entities" ADD CONSTRAINT "entities_chartId_fkey" FOREIGN KEY ("chartId") REFERENCES "charts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_ownerships" ADD CONSTRAINT "entity_ownerships_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_ownerships" ADD CONSTRAINT "entity_ownerships_ownedId_fkey" FOREIGN KEY ("ownedId") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_years" ADD CONSTRAINT "fiscal_years_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_periods" ADD CONSTRAINT "fiscal_periods_fiscalYearId_fkey" FOREIGN KEY ("fiscalYearId") REFERENCES "fiscal_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dimension_values" ADD CONSTRAINT "dimension_values_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "dimension_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dimension_values" ADD CONSTRAINT "dimension_values_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dimension_values" ADD CONSTRAINT "dimension_values_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "dimension_values"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_units" ADD CONSTRAINT "business_units_dimensionValueId_fkey" FOREIGN KEY ("dimensionValueId") REFERENCES "dimension_values"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_units" ADD CONSTRAINT "business_units_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dimension_set_items" ADD CONSTRAINT "dimension_set_items_setId_fkey" FOREIGN KEY ("setId") REFERENCES "dimension_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dimension_set_items" ADD CONSTRAINT "dimension_set_items_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "dimension_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dimension_set_items" ADD CONSTRAINT "dimension_set_items_valueId_fkey" FOREIGN KEY ("valueId") REFERENCES "dimension_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_chartId_fkey" FOREIGN KEY ("chartId") REFERENCES "charts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_dimension_rules" ADD CONSTRAINT "account_dimension_rules_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_dimension_rules" ADD CONSTRAINT "account_dimension_rules_dimensionTypeId_fkey" FOREIGN KEY ("dimensionTypeId") REFERENCES "dimension_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_fiscalYearId_fkey" FOREIGN KEY ("fiscalYearId") REFERENCES "fiscal_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "fiscal_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "vouchers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voucher_lines" ADD CONSTRAINT "voucher_lines_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "vouchers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voucher_lines" ADD CONSTRAINT "voucher_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voucher_lines" ADD CONSTRAINT "voucher_lines_dimensionSetId_fkey" FOREIGN KEY ("dimensionSetId") REFERENCES "dimension_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_balances" ADD CONSTRAINT "gl_balances_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "fiscal_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_balances" ADD CONSTRAINT "gl_balances_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_balances" ADD CONSTRAINT "gl_balances_dimensionSetId_fkey" FOREIGN KEY ("dimensionSetId") REFERENCES "dimension_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_scopes" ADD CONSTRAINT "user_scopes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_scopes" ADD CONSTRAINT "user_scopes_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_scopes" ADD CONSTRAINT "user_scopes_dimensionValueId_fkey" FOREIGN KEY ("dimensionValueId") REFERENCES "dimension_values"("id") ON DELETE SET NULL ON UPDATE CASCADE;
