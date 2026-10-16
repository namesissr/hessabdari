import { Prisma, type InvoiceType, type PrismaClient } from '@prisma/client';
import { AppError } from '@/lib/errors';
import { writeAudit } from '@/lib/audit';
import { formatJ } from '@/lib/jalali';
import { toBig } from '@/lib/money';
import { createAndPostTx, nextSequence, reverseVoucher, type LineInput } from '@/modules/ledger/posting';
import { dimTypeIds, systemAccountId } from '@/modules/treasury/accounts';

type Tx = Prisma.TransactionClient;

export const INVOICE_TYPE_LABEL: Record<InvoiceType, string> = {
  SALES: 'فاکتور فروش',
  PURCHASE: 'فاکتور خرید',
  SALES_RETURN: 'برگشت از فروش',
  PURCHASE_RETURN: 'برگشت از خرید',
};

/** فروش و برگشت از خرید → طرف حساب بدهکار ما نیست؛ جهت ثبت را تعیین می‌کند */
export function isReceivableSide(type: InvoiceType) {
  return type === 'SALES' || type === 'SALES_RETURN';
}
function isReturn(type: InvoiceType) {
  return type === 'SALES_RETURN' || type === 'PURCHASE_RETURN';
}

export type InvoiceLineInput = {
  title: string;
  accountId: string;
  quantity: string | number;
  unitPrice: string | bigint;
  discount?: string | bigint | null;
  taxRate?: string | number | null;
  businessDimId?: string | null;
  costCenterDimId?: string | null;
  projectDimId?: string | null;
  description?: string | null;
};

export type InvoiceInput = {
  entityId: string;
  type: InvoiceType;
  date: Date;
  dueDate?: Date | null;
  partyId: string;
  businessDimId?: string | null;
  projectDimId?: string | null;
  reference?: string | null;
  description?: string | null;
  lines: InvoiceLineInput[];
};

export type ComputedLine = {
  lineNo: number;
  title: string;
  accountId: string;
  quantity: Prisma.Decimal;
  unitPrice: bigint;
  discount: bigint;
  taxRate: Prisma.Decimal;
  taxAmount: bigint;
  amount: bigint;
  businessDimId: string | null;
  costCenterDimId: string | null;
  projectDimId: string | null;
  description: string | null;
};

/** محاسبهٔ مبلغ، تخفیف و مالیات بر ارزش افزودهٔ هر ردیف */
export function computeLines(lines: InvoiceLineInput[], fallbackBusiness?: string | null) {
  if (!lines.length) throw new AppError('فاکتور باید حداقل یک ردیف داشته باشد.');
  const out: ComputedLine[] = [];
  let subtotal = 0n;
  let discountTotal = 0n;
  let taxTotal = 0n;

  for (const [i, l] of lines.entries()) {
    const row = i + 1;
    if (!l.accountId) throw new AppError(`ردیف ${row}: حساب را انتخاب کنید.`);
    if (!l.title?.trim()) throw new AppError(`ردیف ${row}: شرح کالا یا خدمت الزامی است.`);
    const qty = new Prisma.Decimal(String(l.quantity || 0));
    if (qty.lte(0)) throw new AppError(`ردیف ${row}: تعداد باید بزرگ‌تر از صفر باشد.`);
    const unit = toBig(l.unitPrice as never);
    if (unit < 0n) throw new AppError(`ردیف ${row}: مبلغ واحد نمی‌تواند منفی باشد.`);
    const gross = BigInt(qty.mul(unit.toString()).toFixed(0));
    const discount = toBig(l.discount ?? 0);
    if (discount > gross) throw new AppError(`ردیف ${row}: تخفیف از مبلغ ردیف بیشتر است.`);
    const net = gross - discount;
    const rate = new Prisma.Decimal(String(l.taxRate ?? 0));
    if (rate.lt(0) || rate.gt(100)) throw new AppError(`ردیف ${row}: نرخ مالیات معتبر نیست.`);
    const tax = BigInt(rate.mul(net.toString()).div(100).toFixed(0));

    out.push({
      lineNo: row,
      title: l.title.trim(),
      accountId: l.accountId,
      quantity: qty,
      unitPrice: unit,
      discount,
      taxRate: rate,
      taxAmount: tax,
      amount: net,
      businessDimId: l.businessDimId ?? fallbackBusiness ?? null,
      costCenterDimId: l.costCenterDimId ?? null,
      projectDimId: l.projectDimId ?? null,
      description: l.description ?? null,
    });
    subtotal += gross;
    discountTotal += discount;
    taxTotal += tax;
  }
  const total = subtotal - discountTotal + taxTotal;
  return { lines: out, subtotal, discount: discountTotal, taxAmount: taxTotal, total };
}

export async function saveInvoice(db: PrismaClient, userId: string, input: InvoiceInput, id?: string | null) {
  const computed = computeLines(input.lines, input.businessDimId);
  return db.$transaction(async (tx) => {
    if (id) {
      const old = await tx.invoice.findUniqueOrThrow({ where: { id } });
      if (old.status !== 'DRAFT') throw new AppError('فاکتور قطعی‌شده قابل ویرایش نیست؛ ابتدا آن را ابطال کنید.');
      await tx.invoiceLine.deleteMany({ where: { invoiceId: id } });
    }
    const number = id ? undefined : await nextSequence(tx, `invoice:${input.entityId}:${input.type}`);
    const data = {
      entityId: input.entityId,
      type: input.type,
      date: input.date,
      dueDate: input.dueDate ?? null,
      partyId: input.partyId,
      businessDimId: input.businessDimId ?? null,
      projectDimId: input.projectDimId ?? null,
      reference: input.reference ?? null,
      description: input.description ?? null,
      subtotal: computed.subtotal,
      discount: computed.discount,
      taxAmount: computed.taxAmount,
      total: computed.total,
      lines: { create: computed.lines },
    };
    const invoice = id
      ? await tx.invoice.update({ where: { id }, data })
      : await tx.invoice.create({ data: { ...data, number: number!, createdById: userId } });
    await writeAudit(tx, {
      userId,
      action: id ? 'invoice.update' : 'invoice.create',
      objectType: 'Invoice',
      objectId: invoice.id,
      entityId: input.entityId,
      data: { type: input.type, number: invoice.number, total: computed.total, date: formatJ(input.date, false) },
    });
    return invoice;
  }, { maxWait: 10000, timeout: 60000 });
}

/** قطعی کردن فاکتور و صدور سند حسابداری (با مالیات بر ارزش افزوده) */
export async function postInvoice(db: PrismaClient, userId: string, id: string) {
  return db.$transaction(async (tx) => {
    const inv = await tx.invoice.findUniqueOrThrow({ where: { id }, include: { lines: true, party: true, entity: true } });
    if (inv.status === 'POSTED') throw new AppError('این فاکتور قبلاً قطعی شده است.');
    if (inv.status === 'CANCELLED') throw new AppError('فاکتور ابطال‌شده قابل قطعی کردن نیست.');
    if (!inv.lines.length) throw new AppError('فاکتور ردیفی ندارد.');

    const dims = await dimTypeIds(tx);
    const receivable = isReceivableSide(inv.type);
    const partyAccount = await systemAccountId(tx, inv.entity.chartId, receivable ? 'AR_TRADE' : 'AP_TRADE');
    const taxAccountKey = receivable ? 'VAT_PAYABLE' : 'VAT_RECEIVABLE';
    const taxAccount = inv.taxAmount > 0n ? await systemAccountId(tx, inv.entity.chartId, taxAccountKey) : null;
    const partyDim = inv.party.dimensionValueId;
    const sign = isReturn(inv.type) ? -1n : 1n;

    const lines: LineInput[] = [];
    const add = (accountId: string, amount: bigint, dimsMap: Record<string, string>, description?: string | null) => {
      if (amount === 0n) return;
      lines.push(amount > 0n ? { accountId, debit: amount, dims: dimsMap, description } : { accountId, credit: -amount, dims: dimsMap, description });
    };

    // طرف حساب: فروش → بدهکار دریافتنی ؛ خرید → بستانکار پرداختنی
    add(partyAccount, (receivable ? inv.total : -inv.total) * sign, { [dims.PARTY]: partyDim }, inv.description);

    for (const l of inv.lines) {
      const d: Record<string, string> = {};
      if (l.businessDimId) d[dims.BUSINESS] = l.businessDimId;
      if (l.costCenterDimId && dims.COST_CENTER) d[dims.COST_CENTER] = l.costCenterDimId;
      if (l.projectDimId && dims.PROJECT) d[dims.PROJECT] = l.projectDimId;
      // فروش → بستانکار درآمد ؛ خرید → بدهکار هزینه/دارایی
      add(l.accountId, (receivable ? -l.amount : l.amount) * sign, d, l.title);
    }

    if (taxAccount && inv.taxAmount > 0n) {
      const d: Record<string, string> = {};
      if (inv.businessDimId) d[dims.BUSINESS] = inv.businessDimId;
      add(taxAccount, (receivable ? -inv.taxAmount : inv.taxAmount) * sign, d, 'مالیات بر ارزش افزوده');
    }

    const voucher = await createAndPostTx(tx, userId, {
      entityId: inv.entityId,
      date: inv.date,
      type: 'SYSTEM',
      sourceModule: 'invoice',
      sourceRef: inv.id,
      idempotencyKey: `invoice:${inv.id}`,
      description: `${INVOICE_TYPE_LABEL[inv.type]} شمارهٔ ${inv.number}${inv.reference ? ` (ارجاع ${inv.reference})` : ''}`,
      lines,
    });

    const updated = await tx.invoice.update({ where: { id }, data: { status: 'POSTED', voucherId: voucher.id } });
    await writeAudit(tx, { userId, action: 'invoice.post', objectType: 'Invoice', objectId: id, entityId: inv.entityId, data: { number: inv.number, total: inv.total, voucherId: voucher.id } });
    return updated;
  }, { maxWait: 10000, timeout: 60000 });
}

/** ابطال فاکتور قطعی‌شده با سند برگشت */
export async function cancelInvoice(db: PrismaClient, userId: string, id: string, date: Date) {
  const inv = await db.invoice.findUniqueOrThrow({ where: { id }, include: { settlements: true } });
  if (inv.status === 'CANCELLED') throw new AppError('این فاکتور قبلاً ابطال شده است.');
  if (inv.settlements.length) throw new AppError('برای این فاکتور دریافت/پرداخت ثبت شده؛ ابتدا تطبیق‌ها را حذف کنید.');
  if (inv.status === 'POSTED' && inv.voucherId) {
    await reverseVoucher(db, userId, inv.voucherId, date, `ابطال ${INVOICE_TYPE_LABEL[inv.type]} شمارهٔ ${inv.number}`);
  }
  return db.$transaction(async (tx) => {
    const updated = await tx.invoice.update({ where: { id }, data: { status: 'CANCELLED' } });
    await writeAudit(tx, { userId, action: 'invoice.cancel', objectType: 'Invoice', objectId: id, entityId: inv.entityId, data: { number: inv.number } });
    return updated;
  });
}

export async function deleteInvoice(db: PrismaClient, userId: string, id: string) {
  return db.$transaction(async (tx) => {
    const inv = await tx.invoice.findUniqueOrThrow({ where: { id } });
    if (inv.status === 'POSTED') throw new AppError('فاکتور قطعی‌شده حذف نمی‌شود.');
    await tx.invoice.delete({ where: { id } });
    await writeAudit(tx, { userId, action: 'invoice.delete', objectType: 'Invoice', objectId: id, entityId: inv.entityId, data: { number: inv.number } });
  });
}

/** ثبت تطبیق پرداخت با فاکتور (از سند خزانه یا دستی) */
export async function settleInvoiceTx(tx: Tx, userId: string, input: { invoiceId: string; amount: bigint; date: Date; treasuryTxnId?: string | null; note?: string | null }) {
  const inv = await tx.invoice.findUniqueOrThrow({ where: { id: input.invoiceId } });
  if (inv.status !== 'POSTED') throw new AppError('فقط فاکتور قطعی‌شده قابل تطبیق است.');
  if (input.amount <= 0n) throw new AppError('مبلغ تطبیق باید مثبت باشد.');
  const remaining = inv.total - inv.settledAmount;
  if (input.amount > remaining) {
    throw new AppError(`مبلغ تطبیق از ماندهٔ فاکتور بیشتر است (مانده: ${remaining.toString()}).`);
  }
  const settlement = await tx.settlement.create({
    data: { invoiceId: input.invoiceId, amount: input.amount, date: input.date, treasuryTxnId: input.treasuryTxnId ?? null, note: input.note ?? null, createdById: userId },
  });
  await tx.invoice.update({ where: { id: input.invoiceId }, data: { settledAmount: { increment: input.amount } } });
  return settlement;
}

export async function settleInvoice(db: PrismaClient, userId: string, input: { invoiceId: string; amount: bigint; date: Date; note?: string | null }) {
  return db.$transaction((tx) => settleInvoiceTx(tx, userId, input));
}

export async function unsettle(db: PrismaClient, userId: string, settlementId: string) {
  return db.$transaction(async (tx) => {
    const s = await tx.settlement.findUniqueOrThrow({ where: { id: settlementId } });
    await tx.settlement.delete({ where: { id: settlementId } });
    await tx.invoice.update({ where: { id: s.invoiceId }, data: { settledAmount: { decrement: s.amount } } });
    await writeAudit(tx, { userId, action: 'invoice.unsettle', objectType: 'Invoice', objectId: s.invoiceId, data: { amount: s.amount } });
  });
}

// ───────────────────────── گزارش سنی

export type AgingBucket = 'current' | 'd30' | 'd60' | 'd90' | 'older';

export const AGING_LABELS: Record<AgingBucket, string> = {
  current: 'سررسید نشده',
  d30: '۱ تا ۳۰ روز',
  d60: '۳۱ تا ۶۰ روز',
  d90: '۶۱ تا ۹۰ روز',
  older: 'بیش از ۹۰ روز',
};

export function agingBucket(dueDate: Date | null, asOf: Date): AgingBucket {
  if (!dueDate || dueDate >= asOf) return 'current';
  const days = Math.floor((asOf.getTime() - dueDate.getTime()) / 86400000);
  if (days <= 30) return 'd30';
  if (days <= 60) return 'd60';
  if (days <= 90) return 'd90';
  return 'older';
}

export type AgingRow = {
  partyId: string;
  partyName: string;
  total: bigint;
  buckets: Record<AgingBucket, bigint>;
  invoices: { id: string; number: number; date: Date; dueDate: Date | null; remaining: bigint; bucket: AgingBucket }[];
};

/** گزارش سنی بدهکاران (فروش) یا بستانکاران (خرید) بر اساس فاکتورهای تسویه‌نشده */
export async function agingReport(db: PrismaClient, p: { entityIds: string[]; side: 'RECEIVABLE' | 'PAYABLE'; asOf: Date; businessDimId?: string | null }) {
  const types: InvoiceType[] = p.side === 'RECEIVABLE' ? ['SALES', 'SALES_RETURN'] : ['PURCHASE', 'PURCHASE_RETURN'];
  const invoices = await db.invoice.findMany({
    where: {
      entityId: { in: p.entityIds },
      type: { in: types },
      status: 'POSTED',
      date: { lte: p.asOf },
      ...(p.businessDimId ? { businessDimId: p.businessDimId } : {}),
    },
    include: { party: { include: { dimensionValue: true } } },
    orderBy: { date: 'asc' },
  });

  const rows = new Map<string, AgingRow>();
  for (const inv of invoices) {
    const signed = isReturn(inv.type) ? -(inv.total - inv.settledAmount) : inv.total - inv.settledAmount;
    if (signed === 0n) continue;
    const bucket = agingBucket(inv.dueDate ?? inv.date, p.asOf);
    const row =
      rows.get(inv.partyId) ??
      ({ partyId: inv.partyId, partyName: inv.party.dimensionValue.name, total: 0n, buckets: { current: 0n, d30: 0n, d60: 0n, d90: 0n, older: 0n }, invoices: [] } as AgingRow);
    row.total += signed;
    row.buckets[bucket] += signed;
    row.invoices.push({ id: inv.id, number: inv.number, date: inv.date, dueDate: inv.dueDate, remaining: signed, bucket });
    rows.set(inv.partyId, row);
  }
  return [...rows.values()].filter((r) => r.total !== 0n).sort((a, b) => Number(b.total - a.total));
}

/** فاکتورهای باز یک طرف حساب (برای تطبیق هنگام دریافت/پرداخت) */
export async function openInvoices(db: PrismaClient, entityId: string, partyId: string, side: 'RECEIVABLE' | 'PAYABLE') {
  const types: InvoiceType[] = side === 'RECEIVABLE' ? ['SALES'] : ['PURCHASE'];
  const list = await db.invoice.findMany({
    where: { entityId, partyId, type: { in: types }, status: 'POSTED' },
    orderBy: { date: 'asc' },
  });
  return list.filter((i) => i.total > i.settledAmount);
}
