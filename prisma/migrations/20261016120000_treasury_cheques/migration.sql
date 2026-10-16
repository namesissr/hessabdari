-- CreateEnum
CREATE TYPE "PartyKind" AS ENUM ('PERSON', 'COMPANY');

-- CreateEnum
CREATE TYPE "BankAccountKind" AS ENUM ('BANK', 'CASH', 'PETTY_CASH');

-- CreateEnum
CREATE TYPE "ChequeDirection" AS ENUM ('RECEIVED', 'ISSUED');

-- CreateEnum
CREATE TYPE "ChequeStatus" AS ENUM ('IN_HAND', 'DEPOSITED', 'CLEARED', 'ENDORSED', 'ISSUED', 'PAID', 'BOUNCED', 'RETURNED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ChequeEventType" AS ENUM ('REGISTER', 'DEPOSIT', 'CLEAR', 'BOUNCE', 'ENDORSE', 'RETURN', 'CANCEL', 'PAY', 'NOTE');

-- CreateEnum
CREATE TYPE "TreasuryType" AS ENUM ('RECEIPT', 'PAYMENT', 'TRANSFER');

-- CreateEnum
CREATE TYPE "TreasuryStatus" AS ENUM ('DRAFT', 'POSTED');

-- CreateEnum
CREATE TYPE "PayMethod" AS ENUM ('CASH', 'BANK', 'CARD', 'GATEWAY', 'CHEQUE_NEW', 'CHEQUE_ENDORSE');

-- DropIndex
DROP INDEX "vouchers_entity_status_date_idx";

-- CreateTable
CREATE TABLE "parties" (
    "id" TEXT NOT NULL,
    "dimensionValueId" TEXT NOT NULL,
    "entityId" TEXT,
    "kind" "PartyKind" NOT NULL DEFAULT 'COMPANY',
    "nationalCode" TEXT,
    "economicCode" TEXT,
    "registrationNo" TEXT,
    "phone" TEXT,
    "mobile" TEXT,
    "email" TEXT,
    "address" TEXT,
    "bankName" TEXT,
    "accountNo" TEXT,
    "iban" TEXT,
    "roles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "parties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" TEXT NOT NULL,
    "dimensionValueId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "kind" "BankAccountKind" NOT NULL DEFAULT 'BANK',
    "bankName" TEXT,
    "branch" TEXT,
    "accountNo" TEXT,
    "iban" TEXT,
    "cardNo" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'IRR',
    "glAccountId" TEXT NOT NULL,
    "custodianPartyId" TEXT,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cheque_layouts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bankName" TEXT,
    "widthMm" DOUBLE PRECISION NOT NULL DEFAULT 195,
    "heightMm" DOUBLE PRECISION NOT NULL DEFAULT 85,
    "offsetXMm" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "offsetYMm" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fields" JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cheque_layouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cheque_books" (
    "id" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "serialFrom" TEXT,
    "serialTo" TEXT,
    "layoutId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cheque_books_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cheques" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "direction" "ChequeDirection" NOT NULL,
    "status" "ChequeStatus" NOT NULL,
    "bankAccountId" TEXT,
    "chequeBookId" TEXT,
    "serialNo" TEXT NOT NULL,
    "sayadId" TEXT,
    "bankName" TEXT,
    "branch" TEXT,
    "accountNo" TEXT,
    "drawerName" TEXT,
    "amount" BIGINT NOT NULL,
    "issueDate" DATE,
    "dueDate" DATE NOT NULL,
    "partyId" TEXT,
    "counterpartyName" TEXT,
    "description" TEXT,
    "businessDimId" TEXT,
    "projectDimId" TEXT,
    "isGuarantee" BOOLEAN NOT NULL DEFAULT false,
    "location" TEXT,
    "printedAt" TIMESTAMP(3),
    "printCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cheques_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cheque_events" (
    "id" TEXT NOT NULL,
    "chequeId" TEXT NOT NULL,
    "type" "ChequeEventType" NOT NULL,
    "date" DATE NOT NULL,
    "description" TEXT,
    "voucherId" TEXT,
    "bankAccountId" TEXT,
    "partyId" TEXT,
    "feeAmount" BIGINT NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cheque_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "treasury_txns" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "type" "TreasuryType" NOT NULL,
    "number" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "partyId" TEXT,
    "description" TEXT,
    "businessDimId" TEXT,
    "projectDimId" TEXT,
    "totalAmount" BIGINT NOT NULL DEFAULT 0,
    "status" "TreasuryStatus" NOT NULL DEFAULT 'DRAFT',
    "voucherId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "treasury_txns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "treasury_items" (
    "id" TEXT NOT NULL,
    "txnId" TEXT NOT NULL,
    "method" "PayMethod" NOT NULL,
    "bankAccountId" TEXT,
    "toBankAccountId" TEXT,
    "chequeId" TEXT,
    "amount" BIGINT NOT NULL,
    "feeAmount" BIGINT NOT NULL DEFAULT 0,
    "reference" TEXT,
    "description" TEXT,
    "meta" JSONB,

    CONSTRAINT "treasury_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "treasury_allocations" (
    "id" TEXT NOT NULL,
    "txnId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "partyId" TEXT,
    "businessDimId" TEXT,
    "costCenterDimId" TEXT,
    "projectDimId" TEXT,
    "amount" BIGINT NOT NULL,
    "description" TEXT,

    CONSTRAINT "treasury_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "parties_dimensionValueId_key" ON "parties"("dimensionValueId");

-- CreateIndex
CREATE UNIQUE INDEX "bank_accounts_dimensionValueId_key" ON "bank_accounts"("dimensionValueId");

-- CreateIndex
CREATE INDEX "cheques_entityId_direction_status_idx" ON "cheques"("entityId", "direction", "status");

-- CreateIndex
CREATE INDEX "cheques_dueDate_idx" ON "cheques"("dueDate");

-- CreateIndex
CREATE INDEX "cheque_events_chequeId_idx" ON "cheque_events"("chequeId");

-- CreateIndex
CREATE UNIQUE INDEX "treasury_txns_voucherId_key" ON "treasury_txns"("voucherId");

-- CreateIndex
CREATE INDEX "treasury_txns_entityId_date_idx" ON "treasury_txns"("entityId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "treasury_txns_entityId_type_number_key" ON "treasury_txns"("entityId", "type", "number");

-- CreateIndex
CREATE INDEX "treasury_items_txnId_idx" ON "treasury_items"("txnId");

-- CreateIndex
CREATE INDEX "treasury_allocations_txnId_idx" ON "treasury_allocations"("txnId");

-- AddForeignKey
ALTER TABLE "parties" ADD CONSTRAINT "parties_dimensionValueId_fkey" FOREIGN KEY ("dimensionValueId") REFERENCES "dimension_values"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parties" ADD CONSTRAINT "parties_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_dimensionValueId_fkey" FOREIGN KEY ("dimensionValueId") REFERENCES "dimension_values"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_glAccountId_fkey" FOREIGN KEY ("glAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_custodianPartyId_fkey" FOREIGN KEY ("custodianPartyId") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheque_books" ADD CONSTRAINT "cheque_books_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheque_books" ADD CONSTRAINT "cheque_books_layoutId_fkey" FOREIGN KEY ("layoutId") REFERENCES "cheque_layouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_chequeBookId_fkey" FOREIGN KEY ("chequeBookId") REFERENCES "cheque_books"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheque_events" ADD CONSTRAINT "cheque_events_chequeId_fkey" FOREIGN KEY ("chequeId") REFERENCES "cheques"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheque_events" ADD CONSTRAINT "cheque_events_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "vouchers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheque_events" ADD CONSTRAINT "cheque_events_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheque_events" ADD CONSTRAINT "cheque_events_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheque_events" ADD CONSTRAINT "cheque_events_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_txns" ADD CONSTRAINT "treasury_txns_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_txns" ADD CONSTRAINT "treasury_txns_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_txns" ADD CONSTRAINT "treasury_txns_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "vouchers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_txns" ADD CONSTRAINT "treasury_txns_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_items" ADD CONSTRAINT "treasury_items_txnId_fkey" FOREIGN KEY ("txnId") REFERENCES "treasury_txns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_items" ADD CONSTRAINT "treasury_items_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_items" ADD CONSTRAINT "treasury_items_toBankAccountId_fkey" FOREIGN KEY ("toBankAccountId") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_items" ADD CONSTRAINT "treasury_items_chequeId_fkey" FOREIGN KEY ("chequeId") REFERENCES "cheques"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_allocations" ADD CONSTRAINT "treasury_allocations_txnId_fkey" FOREIGN KEY ("txnId") REFERENCES "treasury_txns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_allocations" ADD CONSTRAINT "treasury_allocations_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_allocations" ADD CONSTRAINT "treasury_allocations_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

