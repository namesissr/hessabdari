-- CreateEnum
CREATE TYPE "InvoiceType" AS ENUM ('SALES', 'PURCHASE', 'SALES_RETURN', 'PURCHASE_RETURN');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "IngestStatus" AS ENUM ('PENDING', 'POSTED', 'FAILED', 'IGNORED');

-- CreateEnum
CREATE TYPE "AllocationMethod" AS ENUM ('FIXED', 'EQUAL', 'REVENUE_SHARE');

-- CreateEnum
CREATE TYPE "RecurrenceKind" AS ENUM ('NONE', 'MONTHLY');

-- AlterTable
ALTER TABLE "treasury_allocations" ADD COLUMN     "invoiceId" TEXT;

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "type" "InvoiceType" NOT NULL,
    "number" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "dueDate" DATE,
    "partyId" TEXT NOT NULL,
    "businessDimId" TEXT,
    "projectDimId" TEXT,
    "reference" TEXT,
    "description" TEXT,
    "subtotal" BIGINT NOT NULL DEFAULT 0,
    "discount" BIGINT NOT NULL DEFAULT 0,
    "taxAmount" BIGINT NOT NULL DEFAULT 0,
    "total" BIGINT NOT NULL DEFAULT 0,
    "settledAmount" BIGINT NOT NULL DEFAULT 0,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "voucherId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_lines" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL DEFAULT 1,
    "unitPrice" BIGINT NOT NULL,
    "discount" BIGINT NOT NULL DEFAULT 0,
    "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "taxAmount" BIGINT NOT NULL DEFAULT 0,
    "amount" BIGINT NOT NULL DEFAULT 0,
    "businessDimId" TEXT,
    "costCenterDimId" TEXT,
    "projectDimId" TEXT,
    "description" TEXT,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlements" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "treasuryTxnId" TEXT,
    "amount" BIGINT NOT NULL,
    "date" DATE NOT NULL,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingest_sources" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "businessDimId" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "config" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastEventAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ingest_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingest_events" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "amount" BIGINT,
    "status" "IngestStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "voucherId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "ingest_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allocation_rules" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "method" "AllocationMethod" NOT NULL DEFAULT 'REVENUE_SHARE',
    "sourceBusinessDimId" TEXT,
    "accountCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "weights" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "allocation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allocation_runs" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "voucherId" TEXT,
    "totalAmount" BIGINT NOT NULL DEFAULT 0,
    "detail" JSONB,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "allocation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voucher_templates" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "voucherType" "VoucherType" NOT NULL DEFAULT 'NORMAL',
    "lines" JSONB NOT NULL,
    "recurrence" "RecurrenceKind" NOT NULL DEFAULT 'NONE',
    "dayOfMonth" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastUsedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "voucher_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoices_voucherId_key" ON "invoices"("voucherId");

-- CreateIndex
CREATE INDEX "invoices_entityId_date_idx" ON "invoices"("entityId", "date");

-- CreateIndex
CREATE INDEX "invoices_partyId_idx" ON "invoices"("partyId");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_entityId_type_number_key" ON "invoices"("entityId", "type", "number");

-- CreateIndex
CREATE INDEX "invoice_lines_invoiceId_idx" ON "invoice_lines"("invoiceId");

-- CreateIndex
CREATE INDEX "settlements_invoiceId_idx" ON "settlements"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "ingest_sources_code_key" ON "ingest_sources"("code");

-- CreateIndex
CREATE INDEX "ingest_events_status_idx" ON "ingest_events"("status");

-- CreateIndex
CREATE INDEX "ingest_events_sourceId_receivedAt_idx" ON "ingest_events"("sourceId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ingest_events_sourceId_externalId_key" ON "ingest_events"("sourceId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "allocation_runs_voucherId_key" ON "allocation_runs"("voucherId");

-- CreateIndex
CREATE UNIQUE INDEX "allocation_runs_ruleId_periodId_key" ON "allocation_runs"("ruleId", "periodId");

-- AddForeignKey
ALTER TABLE "treasury_allocations" ADD CONSTRAINT "treasury_allocations_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "vouchers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_treasuryTxnId_fkey" FOREIGN KEY ("treasuryTxnId") REFERENCES "treasury_txns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingest_sources" ADD CONSTRAINT "ingest_sources_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingest_events" ADD CONSTRAINT "ingest_events_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ingest_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingest_events" ADD CONSTRAINT "ingest_events_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "vouchers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_rules" ADD CONSTRAINT "allocation_rules_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_runs" ADD CONSTRAINT "allocation_runs_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "allocation_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_runs" ADD CONSTRAINT "allocation_runs_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "fiscal_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_runs" ADD CONSTRAINT "allocation_runs_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "vouchers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_runs" ADD CONSTRAINT "allocation_runs_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voucher_templates" ADD CONSTRAINT "voucher_templates_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voucher_templates" ADD CONSTRAINT "voucher_templates_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

