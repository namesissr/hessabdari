import type { PayMethod, Prisma, PrismaClient, TreasuryType } from '@prisma/client';
import { AppError } from '@/lib/errors';
import { writeAudit } from '@/lib/audit';
import { formatJ } from '@/lib/jalali';
import { toBig } from '@/lib/money';
import { createAndPostTx, nextSequence, reverseVoucher, type LineInput } from '@/modules/ledger/posting';
import { dimTypeIds, systemAccounts } from './accounts';
import { createChequeTx, type ChequeInput } from './cheques';
import { settleInvoiceTx } from '@/modules/sales/invoices';

type Tx = Prisma.TransactionClient;

export const TREASURY_TYPE_LABEL: Record<TreasuryType, string> = {
  RECEIPT: 'دریافت',
  PAYMENT: 'پرداخت',
  TRANSFER: 'انتقال بین حساب‌ها',
};

export const METHOD_LABEL: Record<PayMethod, string> = {
  CASH: 'نقد / صندوق',
  BANK: 'واریز یا برداشت بانکی',
  CARD: 'کارت به کارت / کارت‌خوان',
  GATEWAY: 'درگاه پرداخت',
  CHEQUE_NEW: 'چک',
  CHEQUE_ENDORSE: 'واگذاری چک دریافتی',
};

export type TreasuryItemInput = {
  method: PayMethod;
  bankAccountId?: string | null;
  toBankAccountId?: string | null;
  chequeId?: string | null;
  /** برای method = CHEQUE_NEW هنگام قطعی شدن، چک ساخته می‌شود */
  newCheque?: Omit<ChequeInput, 'entityId' | 'direction' | 'amount'> | null;
  amount: bigint | string;
  feeAmount?: bigint | string | null;
  reference?: string | null;
  description?: string | null;
};

export type TreasuryAllocationInput = {
  accountId: string;
  invoiceId?: string | null;
  partyId?: string | null;
  businessDimId?: string | null;
  costCenterDimId?: string | null;
  projectDimId?: string | null;
  amount: bigint | string;
  description?: string | null;
};

export type TreasuryInput = {
  entityId: string;
  type: TreasuryType;
  date: Date;
  partyId?: string | null;
  description?: string | null;
  businessDimId?: string | null;
  projectDimId?: string | null;
  items: TreasuryItemInput[];
  allocations: TreasuryAllocationInput[];
};

const TX_OPTS = { maxWait: 10000, timeout: 60000 };

function sum<T>(list: T[], pick: (t: T) => bigint) {
  return list.reduce((s, x) => s + pick(x), 0n);
}

function validate(input: TreasuryInput) {
  const items = input.items.filter((i) => toBig(i.amount) > 0n);
  if (!items.length) throw new AppError('حداقل یک ردیف دریافت/پرداخت وارد کنید.');
  for (const i of items) {
    if (toBig(i.feeAmount ?? 0) < 0n) throw new AppError('کارمزد نمی‌تواند منفی باشد.');
    if (input.type === 'TRANSFER') {
      if (!i.bankAccountId || !i.toBankAccountId) throw new AppError('برای انتقال، حساب مبدأ و مقصد را انتخاب کنید.');
      if (i.bankAccountId === i.toBankAccountId) throw new AppError('حساب مبدأ و مقصد نباید یکی باشد.');
    } else if (['CASH', 'BANK', 'CARD', 'GATEWAY'].includes(i.method) && !i.bankAccountId) {
      throw new AppError('برای ردیف نقدی/بانکی، حساب بانکی یا صندوق را انتخاب کنید.');
    } else if (i.method === 'CHEQUE_NEW' && !i.chequeId && !i.newCheque) {
      throw new AppError('اطلاعات چک (شماره و سررسید) را کامل کنید.');
    } else if (i.method === 'CHEQUE_ENDORSE' && !i.chequeId) {
      throw new AppError('چک دریافتی مورد نظر برای واگذاری را انتخاب کنید.');
    }
  }
  const allocations = input.allocations.filter((a) => toBig(a.amount) > 0n);
  if (input.type !== 'TRANSFER') {
    if (!allocations.length) throw new AppError('بخش «بابت» را کامل کنید (حساب و مبلغ).');
    const i = sum(items, (x) => toBig(x.amount));
    const a = sum(allocations, (x) => toBig(x.amount));
    if (i !== a) throw new AppError(`جمع مبالغ دریافت/پرداخت (${i}) با جمع «بابت» (${a}) برابر نیست.`);
  }
  return { items, allocations };
}

/** ایجاد یا ویرایش سند خزانه در وضعیت پیش‌نویس */
export async function saveTreasury(db: PrismaClient, userId: string, input: TreasuryInput, id?: string | null) {
  const { items, allocations } = validate(input);
  return db.$transaction(async (tx) => {
    if (id) {
      const old = await tx.treasuryTxn.findUniqueOrThrow({ where: { id } });
      if (old.status === 'POSTED') throw new AppError('سند خزانهٔ قطعی‌شده قابل ویرایش نیست؛ ابتدا آن را برگشت بزنید.');
      await tx.treasuryItem.deleteMany({ where: { txnId: id } });
      await tx.treasuryAllocation.deleteMany({ where: { txnId: id } });
    }
    const number = id ? undefined : await nextSequence(tx, `treasury:${input.entityId}:${input.type}`);
    const data = {
      entityId: input.entityId,
      type: input.type,
      date: input.date,
      partyId: input.partyId ?? null,
      description: input.description ?? null,
      businessDimId: input.businessDimId ?? null,
      projectDimId: input.projectDimId ?? null,
      totalAmount: sum(items, (x) => toBig(x.amount)),
      items: {
        create: items.map((i) => ({
          method: i.method,
          bankAccountId: i.bankAccountId ?? null,
          toBankAccountId: i.toBankAccountId ?? null,
          chequeId: i.chequeId ?? null,
          amount: toBig(i.amount),
          feeAmount: toBig(i.feeAmount ?? 0),
          reference: i.reference ?? null,
          description: i.description ?? null,
          meta: i.newCheque ? ({ cheque: i.newCheque } as object) : undefined,
        })),
      },
      allocations: {
        create: allocations.map((a) => ({
          accountId: a.accountId,
          partyId: a.partyId ?? null,
          businessDimId: a.businessDimId ?? null,
          costCenterDimId: a.costCenterDimId ?? null,
          projectDimId: a.projectDimId ?? null,
          invoiceId: a.invoiceId ?? null,
          amount: toBig(a.amount),
          description: a.description ?? null,
        })),
      },
    };
    const txn = id
      ? await tx.treasuryTxn.update({ where: { id }, data: { ...data, items: data.items, allocations: data.allocations } })
      : await tx.treasuryTxn.create({ data: { ...data, number: number!, createdById: userId } });
    await writeAudit(tx, {
      userId,
      action: id ? 'treasury.update' : 'treasury.create',
      objectType: 'TreasuryTxn',
      objectId: txn.id,
      entityId: input.entityId,
      data: { type: input.type, number: txn.number, date: formatJ(input.date, false), total: txn.totalAmount },
    });
    return txn;
  }, TX_OPTS);
}

/** قطعی کردن سند خزانه: ساخت چک‌های جدید + صدور سند حسابداری */
export async function postTreasury(db: PrismaClient, userId: string, id: string) {
  return db.$transaction(async (tx) => {
    const txn = await tx.treasuryTxn.findUniqueOrThrow({
      where: { id },
      include: { items: { include: { bankAccount: true, toBankAccount: true, cheque: true } }, allocations: true, party: true },
    });
    if (txn.status === 'POSTED') throw new AppError('این سند قبلاً قطعی شده است.');
    const entity = await tx.entity.findUniqueOrThrow({ where: { id: txn.entityId } });
    const acc = await systemAccounts(tx, entity.chartId, ['CHEQUES_RECEIVABLE', 'CHEQUES_PAYABLE', 'BANK_FEE']);
    const dims = await dimTypeIds(tx);

    const lines: LineInput[] = [];
    const isReceipt = txn.type === 'RECEIPT';
    const partyDim = txn.party?.dimensionValueId ?? null;
    const feeBusiness = txn.businessDimId;

    const addFee = (fee: bigint, bankDimValueId: string | null, bankGlId: string | null) => {
      if (fee === 0n) return;
      if (!feeBusiness) throw new AppError('برای ثبت کارمزد، کسب‌وکار سند را مشخص کنید.');
      lines.push({ accountId: acc.BANK_FEE, debit: fee, dims: { [dims.BUSINESS]: feeBusiness }, description: 'کارمزد بانکی' });
      if (txn.type === 'TRANSFER' && bankGlId && bankDimValueId) {
        lines.push({ accountId: bankGlId, credit: fee, dims: { [dims.BANK_ACCOUNT]: bankDimValueId } });
      }
    };

    for (const item of txn.items) {
      const amount = item.amount;
      const fee = item.feeAmount;
      if (txn.type === 'TRANSFER') {
        const from = item.bankAccount!;
        const to = item.toBankAccount!;
        lines.push({ accountId: to.glAccountId, debit: amount, dims: { [dims.BANK_ACCOUNT]: to.dimensionValueId }, description: item.reference ?? null });
        lines.push({ accountId: from.glAccountId, credit: amount, dims: { [dims.BANK_ACCOUNT]: from.dimensionValueId } });
        addFee(fee, from.dimensionValueId, from.glAccountId);
        continue;
      }

      if (['CASH', 'BANK', 'CARD', 'GATEWAY'].includes(item.method)) {
        const bank = item.bankAccount!;
        const bankDims = { [dims.BANK_ACCOUNT]: bank.dimensionValueId };
        if (isReceipt) {
          lines.push({ accountId: bank.glAccountId, debit: amount - fee, dims: bankDims, description: item.reference ?? null });
          if (fee > 0n) {
            if (!feeBusiness) throw new AppError('برای ثبت کارمزد، کسب‌وکار سند را مشخص کنید.');
            lines.push({ accountId: acc.BANK_FEE, debit: fee, dims: { [dims.BUSINESS]: feeBusiness }, description: 'کارمزد بانکی' });
          }
        } else {
          lines.push({ accountId: bank.glAccountId, credit: amount + fee, dims: bankDims, description: item.reference ?? null });
          if (fee > 0n) {
            if (!feeBusiness) throw new AppError('برای ثبت کارمزد، کسب‌وکار سند را مشخص کنید.');
            lines.push({ accountId: acc.BANK_FEE, debit: fee, dims: { [dims.BUSINESS]: feeBusiness }, description: 'کارمزد بانکی' });
          }
        }
        continue;
      }

      if (item.method === 'CHEQUE_NEW') {
        if (!partyDim) throw new AppError('برای ردیف چک، طرف حساب سند را مشخص کنید.');
        lines.push(
          isReceipt
            ? { accountId: acc.CHEQUES_RECEIVABLE, debit: amount, dims: { [dims.PARTY]: partyDim } }
            : { accountId: acc.CHEQUES_PAYABLE, credit: amount, dims: { [dims.PARTY]: partyDim } },
        );
        continue;
      }

      if (item.method === 'CHEQUE_ENDORSE') {
        const cheque = item.cheque;
        if (!cheque) throw new AppError('چک انتخاب‌شده پیدا نشد.');
        if (cheque.direction !== 'RECEIVED' || cheque.status !== 'IN_HAND') throw new AppError(`چک ${cheque.serialNo} در وضعیت قابل واگذاری نیست.`);
        const origin = cheque.partyId ? (await tx.party.findUniqueOrThrow({ where: { id: cheque.partyId } })).dimensionValueId : null;
        if (!origin) throw new AppError(`برای چک ${cheque.serialNo} طرف حساب ثبت نشده است.`);
        lines.push({ accountId: acc.CHEQUES_RECEIVABLE, credit: amount, dims: { [dims.PARTY]: origin } });
      }
    }

    for (const a of txn.allocations) {
      const d: Record<string, string> = {};
      if (a.partyId) d[dims.PARTY] = (await tx.party.findUniqueOrThrow({ where: { id: a.partyId } })).dimensionValueId;
      if (a.businessDimId) d[dims.BUSINESS] = a.businessDimId;
      if (a.costCenterDimId && dims.COST_CENTER) d[dims.COST_CENTER] = a.costCenterDimId;
      if (a.projectDimId && dims.PROJECT) d[dims.PROJECT] = a.projectDimId;
      lines.push(isReceipt ? { accountId: a.accountId, credit: a.amount, dims: d, description: a.description } : { accountId: a.accountId, debit: a.amount, dims: d, description: a.description });
    }

    const voucher = await createAndPostTx(tx, userId, {
      entityId: txn.entityId,
      date: txn.date,
      type: 'SYSTEM',
      sourceModule: 'treasury',
      sourceRef: txn.id,
      idempotencyKey: `treasury:${txn.id}`,
      description: txn.description || `${TREASURY_TYPE_LABEL[txn.type]} شمارهٔ ${txn.number}`,
      lines,
    });

    // ساخت چک‌های جدید و رویداد واگذاری چک‌های موجود
    for (const item of txn.items) {
      if (item.method === 'CHEQUE_NEW' && !item.chequeId) {
        const payload = (item.meta as { cheque?: Record<string, unknown> } | null)?.cheque ?? null;
        if (!payload) throw new AppError('اطلاعات چک ناقص است.');
        const cheque = await createChequeTx(
          tx,
          userId,
          {
            entityId: txn.entityId,
            direction: isReceipt ? 'RECEIVED' : 'ISSUED',
            amount: item.amount,
            serialNo: String(payload.serialNo ?? ''),
            sayadId: (payload.sayadId as string) ?? null,
            bankName: (payload.bankName as string) ?? null,
            branch: (payload.branch as string) ?? null,
            accountNo: (payload.accountNo as string) ?? null,
            drawerName: (payload.drawerName as string) ?? null,
            issueDate: payload.issueDate ? new Date(payload.issueDate as string) : txn.date,
            dueDate: new Date(payload.dueDate as string),
            partyId: txn.partyId,
            description: txn.description,
            businessDimId: txn.businessDimId,
            projectDimId: txn.projectDimId,
            isGuarantee: !!payload.isGuarantee,
            bankAccountId: (payload.bankAccountId as string) ?? null,
            chequeBookId: (payload.chequeBookId as string) ?? null,
          },
          { voucherId: voucher.id, date: txn.date },
        );
        await tx.treasuryItem.update({ where: { id: item.id }, data: { chequeId: cheque.id } });
      }
      if (item.method === 'CHEQUE_ENDORSE' && item.chequeId) {
        await tx.cheque.update({ where: { id: item.chequeId }, data: { status: 'ENDORSED', location: 'واگذار شده به غیر' } });
        await tx.chequeEvent.create({
          data: {
            chequeId: item.chequeId,
            type: 'ENDORSE',
            date: txn.date,
            description: `واگذاری طی ${TREASURY_TYPE_LABEL[txn.type]} شمارهٔ ${txn.number}`,
            voucherId: voucher.id,
            partyId: txn.partyId,
            createdById: userId,
          },
        });
      }
    }

    // تطبیق خودکار با فاکتورهایی که در ردیف‌های «بابت» انتخاب شده‌اند
    for (const a of txn.allocations) {
      if (!a.invoiceId) continue;
      await settleInvoiceTx(tx, userId, {
        invoiceId: a.invoiceId,
        amount: a.amount,
        date: txn.date,
        treasuryTxnId: txn.id,
        note: `${TREASURY_TYPE_LABEL[txn.type]} شمارهٔ ${txn.number}`,
      });
    }

    const updated = await tx.treasuryTxn.update({ where: { id }, data: { status: 'POSTED', voucherId: voucher.id } });
    await writeAudit(tx, { userId, action: 'treasury.post', objectType: 'TreasuryTxn', objectId: id, entityId: txn.entityId, data: { number: txn.number, voucherId: voucher.id } });
    return updated;
  }, TX_OPTS);
}

/** برگشت سند خزانهٔ قطعی‌شده (سند حسابداری برگشت می‌خورد) */
export async function reverseTreasury(db: PrismaClient, userId: string, id: string, date: Date) {
  const txn = await db.treasuryTxn.findUniqueOrThrow({ where: { id }, include: { items: true } });
  if (txn.status !== 'POSTED' || !txn.voucherId) throw new AppError('این سند قطعی نشده است.');
  if (txn.items.some((i) => i.chequeId)) {
    throw new AppError('این سند چک دارد؛ ابتدا وضعیت چک را از صفحهٔ چک‌ها اصلاح یا ابطال کنید.');
  }
  const rev = await reverseVoucher(db, userId, txn.voucherId, date, `برگشت ${TREASURY_TYPE_LABEL[txn.type]} شمارهٔ ${txn.number}`);
  await db.$transaction((tx) => writeAudit(tx, { userId, action: 'treasury.reverse', objectType: 'TreasuryTxn', objectId: id, entityId: txn.entityId, data: { reversalVoucherId: rev.id } }));
  return rev;
}

export async function deleteTreasury(db: PrismaClient, userId: string, id: string) {
  return db.$transaction(async (tx) => {
    const txn = await tx.treasuryTxn.findUniqueOrThrow({ where: { id } });
    if (txn.status === 'POSTED') throw new AppError('سند قطعی‌شده حذف نمی‌شود.');
    await tx.treasuryTxn.delete({ where: { id } });
    await writeAudit(tx, { userId, action: 'treasury.delete', objectType: 'TreasuryTxn', objectId: id, entityId: txn.entityId, data: { number: txn.number } });
  });
}
