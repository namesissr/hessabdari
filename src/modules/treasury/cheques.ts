import type { ChequeDirection, ChequeEventType, ChequeStatus, Prisma, PrismaClient } from '@prisma/client';
import { AppError } from '@/lib/errors';
import { writeAudit } from '@/lib/audit';
import { formatJ } from '@/lib/jalali';
import { formatMoney } from '@/lib/money';
import { createAndPostTx, type LineInput } from '@/modules/ledger/posting';
import { dimTypeIds, systemAccounts } from './accounts';

type Tx = Prisma.TransactionClient;

export const CHEQUE_STATUS_LABEL: Record<ChequeStatus, string> = {
  IN_HAND: 'نزد ما',
  DEPOSITED: 'واگذار به بانک',
  CLEARED: 'وصول شد',
  ENDORSED: 'خرج شد',
  ISSUED: 'تحویل ذی‌نفع',
  PAID: 'پاس شد',
  BOUNCED: 'برگشت خورد',
  RETURNED: 'عودت شد',
  CANCELLED: 'ابطال شد',
};

export const CHEQUE_EVENT_LABEL: Record<ChequeEventType, string> = {
  REGISTER: 'ثبت اولیه',
  DEPOSIT: 'واگذاری به بانک',
  CLEAR: 'وصول',
  BOUNCE: 'برگشت',
  ENDORSE: 'خرج چک (واگذاری به غیر)',
  RETURN: 'عودت',
  CANCEL: 'ابطال',
  PAY: 'پاس شدن',
  NOTE: 'یادداشت',
};

/** گذارهای مجاز وضعیت برای هر جهت چک */
const TRANSITIONS: Record<ChequeDirection, Partial<Record<ChequeEventType, { from: ChequeStatus[]; to: ChequeStatus }>>> = {
  RECEIVED: {
    DEPOSIT: { from: ['IN_HAND', 'BOUNCED'], to: 'DEPOSITED' },
    CLEAR: { from: ['IN_HAND', 'DEPOSITED'], to: 'CLEARED' },
    BOUNCE: { from: ['IN_HAND', 'DEPOSITED'], to: 'BOUNCED' },
    ENDORSE: { from: ['IN_HAND'], to: 'ENDORSED' },
    RETURN: { from: ['IN_HAND', 'BOUNCED'], to: 'RETURNED' },
    CANCEL: { from: ['IN_HAND', 'BOUNCED'], to: 'CANCELLED' },
    NOTE: { from: ['IN_HAND', 'DEPOSITED', 'CLEARED', 'ENDORSED', 'BOUNCED', 'RETURNED', 'CANCELLED'], to: 'IN_HAND' },
  },
  ISSUED: {
    PAY: { from: ['ISSUED', 'BOUNCED'], to: 'PAID' },
    BOUNCE: { from: ['ISSUED'], to: 'BOUNCED' },
    RETURN: { from: ['ISSUED', 'BOUNCED'], to: 'RETURNED' },
    CANCEL: { from: ['ISSUED', 'BOUNCED'], to: 'CANCELLED' },
    NOTE: { from: ['ISSUED', 'PAID', 'BOUNCED', 'RETURNED', 'CANCELLED'], to: 'ISSUED' },
  },
};

export function allowedEvents(direction: ChequeDirection, status: ChequeStatus): ChequeEventType[] {
  return (Object.entries(TRANSITIONS[direction]) as [ChequeEventType, { from: ChequeStatus[] }][])
    .filter(([type, t]) => type !== 'NOTE' && t.from.includes(status))
    .map(([type]) => type);
}

export type ChequeInput = {
  entityId: string;
  direction: ChequeDirection;
  serialNo: string;
  sayadId?: string | null;
  bankName?: string | null;
  branch?: string | null;
  accountNo?: string | null;
  drawerName?: string | null;
  amount: bigint;
  issueDate?: Date | null;
  dueDate: Date;
  partyId?: string | null;
  counterpartyName?: string | null;
  description?: string | null;
  businessDimId?: string | null;
  projectDimId?: string | null;
  isGuarantee?: boolean;
  bankAccountId?: string | null;
  chequeBookId?: string | null;
  location?: string | null;
};

async function ctx(tx: Tx, entityId: string) {
  const entity = await tx.entity.findUniqueOrThrow({ where: { id: entityId } });
  const acc = await systemAccounts(tx, entity.chartId, [
    'AR_TRADE',
    'AP_TRADE',
    'CHEQUES_RECEIVABLE',
    'CHEQUES_IN_COLLECTION',
    'CHEQUES_PAYABLE',
    'BANK_FEE',
    'GUARANTEE_GIVEN',
    'GUARANTEE_GIVEN_CONTRA',
    'GUARANTEE_HELD',
    'GUARANTEE_HELD_CONTRA',
  ]);
  const dims = await dimTypeIds(tx);
  return { entity, acc, dims };
}

async function partyDimValue(tx: Tx, partyId: string | null | undefined, what: string): Promise<string> {
  if (!partyId) throw new AppError(`برای ثبت سند ${what} باید طرف حساب مشخص باشد.`);
  const p = await tx.party.findUniqueOrThrow({ where: { id: partyId } });
  return p.dimensionValueId;
}

async function bankDimValue(tx: Tx, bankAccountId: string | null | undefined, what: string) {
  if (!bankAccountId) throw new AppError(`برای ${what} باید حساب بانکی انتخاب شود.`);
  const b = await tx.bankAccount.findUniqueOrThrow({ where: { id: bankAccountId } });
  return b;
}

/** ثبت چک + (در صورت نیاز) سند اولیهٔ آن */
export async function createChequeTx(
  tx: Tx,
  userId: string,
  input: ChequeInput,
  opts: { postRegister?: boolean; counterAccountId?: string | null; voucherId?: string | null; date?: Date } = {},
) {
  if (input.amount <= 0n) throw new AppError('مبلغ چک باید بزرگ‌تر از صفر باشد.');
  if (!input.serialNo.trim()) throw new AppError('شمارهٔ (سری/سریال) چک الزامی است.');
  if (input.sayadId && !/^\d{16}$/.test(input.sayadId)) throw new AppError('شناسهٔ صیاد باید ۱۶ رقم باشد.');
  const status: ChequeStatus = input.direction === 'RECEIVED' ? 'IN_HAND' : 'ISSUED';

  const cheque = await tx.cheque.create({
    data: {
      entityId: input.entityId,
      direction: input.direction,
      status,
      bankAccountId: input.bankAccountId ?? null,
      chequeBookId: input.chequeBookId ?? null,
      serialNo: input.serialNo.trim(),
      sayadId: input.sayadId?.trim() || null,
      bankName: input.bankName ?? null,
      branch: input.branch ?? null,
      accountNo: input.accountNo ?? null,
      drawerName: input.drawerName ?? null,
      amount: input.amount,
      issueDate: input.issueDate ?? null,
      dueDate: input.dueDate,
      partyId: input.partyId ?? null,
      counterpartyName: input.counterpartyName ?? null,
      description: input.description ?? null,
      businessDimId: input.businessDimId ?? null,
      projectDimId: input.projectDimId ?? null,
      isGuarantee: !!input.isGuarantee,
      location: input.location ?? (input.direction === 'RECEIVED' ? 'صندوق' : 'نزد ذی‌نفع'),
      createdById: userId,
    },
  });

  let voucherId = opts.voucherId ?? null;
  const date = opts.date ?? input.issueDate ?? input.dueDate;

  if (!voucherId && opts.postRegister) {
    const { acc, dims } = await ctx(tx, input.entityId);
    const partyDim = await partyDimValue(tx, input.partyId, 'ثبت چک');
    const lines: LineInput[] = input.isGuarantee
      ? input.direction === 'RECEIVED'
        ? [
            { accountId: acc.GUARANTEE_HELD, debit: input.amount, dims: { [dims.PARTY]: partyDim } },
            { accountId: acc.GUARANTEE_HELD_CONTRA, credit: input.amount, dims: { [dims.PARTY]: partyDim } },
          ]
        : [
            { accountId: acc.GUARANTEE_GIVEN, debit: input.amount, dims: { [dims.PARTY]: partyDim } },
            { accountId: acc.GUARANTEE_GIVEN_CONTRA, credit: input.amount, dims: { [dims.PARTY]: partyDim } },
          ]
      : input.direction === 'RECEIVED'
        ? [
            { accountId: acc.CHEQUES_RECEIVABLE, debit: input.amount, dims: { [dims.PARTY]: partyDim } },
            { accountId: opts.counterAccountId ?? acc.AR_TRADE, credit: input.amount, dims: { [dims.PARTY]: partyDim } },
          ]
        : [
            { accountId: opts.counterAccountId ?? acc.AP_TRADE, debit: input.amount, dims: { [dims.PARTY]: partyDim } },
            { accountId: acc.CHEQUES_PAYABLE, credit: input.amount, dims: { [dims.PARTY]: partyDim } },
          ];

    const v = await createAndPostTx(tx, userId, {
      entityId: input.entityId,
      date,
      type: 'SYSTEM',
      sourceModule: 'cheque',
      sourceRef: cheque.id,
      idempotencyKey: `cheque:register:${cheque.id}`,
      description: `${input.direction === 'RECEIVED' ? 'دریافت' : 'صدور'} چک ${input.serialNo}${input.isGuarantee ? ' (تضمینی)' : ''} — سررسید ${formatJ(input.dueDate)}`,
      lines,
    });
    voucherId = v.id;
  }

  await tx.chequeEvent.create({
    data: {
      chequeId: cheque.id,
      type: 'REGISTER',
      date,
      description: input.description ?? null,
      voucherId,
      partyId: input.partyId ?? null,
      bankAccountId: input.bankAccountId ?? null,
      createdById: userId,
    },
  });
  await writeAudit(tx, {
    userId,
    action: 'cheque.create',
    objectType: 'Cheque',
    objectId: cheque.id,
    entityId: input.entityId,
    data: { direction: input.direction, serialNo: input.serialNo, amount: input.amount, dueDate: formatJ(input.dueDate, false) },
  });
  return cheque;
}

export type ChequeEventInput = {
  chequeId: string;
  type: ChequeEventType;
  date: Date;
  bankAccountId?: string | null;
  /** برای «خرج چک»: شخصی که چک به او واگذار می‌شود */
  partyId?: string | null;
  feeAmount?: bigint;
  description?: string | null;
  businessDimId?: string | null;
};

/** ثبت رویداد چک همراه با سند حسابداری آن */
export async function chequeEvent(db: PrismaClient, userId: string, input: ChequeEventInput) {
  return db.$transaction(async (tx) => {
    const cheque = await tx.cheque.findUniqueOrThrow({ where: { id: input.chequeId } });
    const rule = TRANSITIONS[cheque.direction][input.type];
    if (!rule) throw new AppError('این عملیات برای این نوع چک تعریف نشده است.');
    if (!rule.from.includes(cheque.status)) {
      throw new AppError(`چک در وضعیت «${CHEQUE_STATUS_LABEL[cheque.status]}» است و امکان «${CHEQUE_EVENT_LABEL[input.type]}» ندارد.`);
    }
    const fee = input.feeAmount ?? 0n;
    if (fee < 0n) throw new AppError('کارمزد نمی‌تواند منفی باشد.');

    const { acc, dims } = await ctx(tx, cheque.entityId);
    const businessDim = input.businessDimId ?? cheque.businessDimId;
    const partyDimOf = async (id: string | null | undefined) => partyDimValue(tx, id, CHEQUE_EVENT_LABEL[input.type]);
    const lines: LineInput[] = [];
    let newStatus: ChequeStatus = rule.to;
    let location = cheque.location;

    const holderAccount = cheque.status === 'DEPOSITED' ? acc.CHEQUES_IN_COLLECTION : acc.CHEQUES_RECEIVABLE;
    const holderDims = async () => {
      const d: Record<string, string> = { [dims.PARTY]: await partyDimOf(cheque.partyId) };
      if (cheque.status === 'DEPOSITED') {
        const ev = await tx.chequeEvent.findFirst({ where: { chequeId: cheque.id, type: 'DEPOSIT' }, orderBy: { createdAt: 'desc' } });
        if (ev?.bankAccountId) {
          const b = await tx.bankAccount.findUnique({ where: { id: ev.bankAccountId } });
          if (b) d[dims.BANK_ACCOUNT] = b.dimensionValueId;
        }
      }
      return d;
    };
    const feeLines = async (bankDimValueId: string | null) => {
      if (fee === 0n) return;
      if (!businessDim) throw new AppError('برای ثبت کارمزد، کسب‌وکار مربوط را مشخص کنید.');
      lines.push({ accountId: acc.BANK_FEE, debit: fee, dims: { [dims.BUSINESS]: businessDim }, description: 'کارمزد بانکی' });
      if (bankDimValueId) lines.push({ accountId: (await tx.bankAccount.findFirstOrThrow({ where: { dimensionValueId: bankDimValueId } })).glAccountId, credit: fee, dims: { [dims.BANK_ACCOUNT]: bankDimValueId } });
    };

    if (input.type === 'NOTE') {
      newStatus = cheque.status;
    } else if (cheque.isGuarantee) {
      // چک تضمینی فقط در حساب‌های انتظامی ثبت و در زمان عودت/ابطال برگشت می‌خورد
      const partyDim = await partyDimOf(cheque.partyId);
      if (input.type === 'RETURN' || input.type === 'CANCEL') {
        if (cheque.direction === 'RECEIVED') {
          lines.push({ accountId: acc.GUARANTEE_HELD_CONTRA, debit: cheque.amount, dims: { [dims.PARTY]: partyDim } });
          lines.push({ accountId: acc.GUARANTEE_HELD, credit: cheque.amount, dims: { [dims.PARTY]: partyDim } });
        } else {
          lines.push({ accountId: acc.GUARANTEE_GIVEN_CONTRA, debit: cheque.amount, dims: { [dims.PARTY]: partyDim } });
          lines.push({ accountId: acc.GUARANTEE_GIVEN, credit: cheque.amount, dims: { [dims.PARTY]: partyDim } });
        }
      }
    } else if (cheque.direction === 'RECEIVED') {
      const partyDim = await partyDimOf(cheque.partyId);
      switch (input.type) {
        case 'DEPOSIT': {
          const bank = await bankDimValue(tx, input.bankAccountId, 'واگذاری چک به بانک');
          lines.push({ accountId: acc.CHEQUES_IN_COLLECTION, debit: cheque.amount, dims: { [dims.PARTY]: partyDim, [dims.BANK_ACCOUNT]: bank.dimensionValueId } });
          lines.push({ accountId: acc.CHEQUES_RECEIVABLE, credit: cheque.amount, dims: { [dims.PARTY]: partyDim } });
          location = `در جریان وصول — ${bank.bankName ?? ''}`.trim();
          break;
        }
        case 'CLEAR': {
          const bank = await bankDimValue(tx, input.bankAccountId, 'وصول چک');
          const hd = await holderDims();
          lines.push({ accountId: bank.glAccountId, debit: cheque.amount - fee, dims: { [dims.BANK_ACCOUNT]: bank.dimensionValueId } });
          if (fee > 0n) {
            if (!businessDim) throw new AppError('برای ثبت کارمزد، کسب‌وکار مربوط را مشخص کنید.');
            lines.push({ accountId: acc.BANK_FEE, debit: fee, dims: { [dims.BUSINESS]: businessDim }, description: 'کارمزد وصول چک' });
          }
          lines.push({ accountId: holderAccount, credit: cheque.amount, dims: hd });
          location = 'وصول شد';
          break;
        }
        case 'BOUNCE': {
          const hd = await holderDims();
          lines.push({ accountId: acc.AR_TRADE, debit: cheque.amount, dims: { [dims.PARTY]: partyDim } });
          lines.push({ accountId: holderAccount, credit: cheque.amount, dims: hd });
          await feeLines(input.bankAccountId ? (await bankDimValue(tx, input.bankAccountId, 'کارمزد برگشت چک')).dimensionValueId : null);
          location = 'برگشتی — نزد ما';
          break;
        }
        case 'ENDORSE': {
          const toParty = await partyDimOf(input.partyId);
          lines.push({ accountId: acc.AP_TRADE, debit: cheque.amount, dims: { [dims.PARTY]: toParty } });
          lines.push({ accountId: acc.CHEQUES_RECEIVABLE, credit: cheque.amount, dims: { [dims.PARTY]: partyDim } });
          location = 'واگذار شده به غیر';
          break;
        }
        case 'RETURN':
        case 'CANCEL': {
          const hd = await holderDims();
          lines.push({ accountId: acc.AR_TRADE, debit: cheque.amount, dims: { [dims.PARTY]: partyDim } });
          lines.push({ accountId: holderAccount, credit: cheque.amount, dims: hd });
          location = input.type === 'RETURN' ? 'عودت به صادرکننده' : 'ابطال شده';
          break;
        }
      }
    } else {
      const partyDim = await partyDimOf(cheque.partyId);
      switch (input.type) {
        case 'PAY': {
          const bank = await bankDimValue(tx, input.bankAccountId ?? cheque.bankAccountId, 'پاس شدن چک');
          lines.push({ accountId: acc.CHEQUES_PAYABLE, debit: cheque.amount, dims: { [dims.PARTY]: partyDim } });
          if (fee > 0n) {
            if (!businessDim) throw new AppError('برای ثبت کارمزد، کسب‌وکار مربوط را مشخص کنید.');
            lines.push({ accountId: acc.BANK_FEE, debit: fee, dims: { [dims.BUSINESS]: businessDim }, description: 'کارمزد بانکی' });
          }
          lines.push({ accountId: bank.glAccountId, credit: cheque.amount + fee, dims: { [dims.BANK_ACCOUNT]: bank.dimensionValueId } });
          location = 'پاس شد';
          break;
        }
        case 'BOUNCE': {
          await feeLines(input.bankAccountId ? (await bankDimValue(tx, input.bankAccountId, 'کارمزد برگشت چک')).dimensionValueId : null);
          location = 'برگشتی — نزد ذی‌نفع';
          break;
        }
        case 'RETURN':
        case 'CANCEL': {
          lines.push({ accountId: acc.CHEQUES_PAYABLE, debit: cheque.amount, dims: { [dims.PARTY]: partyDim } });
          lines.push({ accountId: acc.AP_TRADE, credit: cheque.amount, dims: { [dims.PARTY]: partyDim } });
          location = input.type === 'RETURN' ? 'عودت گرفته شد' : 'ابطال شده';
          break;
        }
      }
    }

    let voucherId: string | null = null;
    if (lines.length) {
      const v = await createAndPostTx(tx, userId, {
        entityId: cheque.entityId,
        date: input.date,
        type: 'SYSTEM',
        sourceModule: 'cheque',
        sourceRef: cheque.id,
        idempotencyKey: `cheque:${input.type}:${cheque.id}:${input.date.toISOString().slice(0, 10)}`,
        description: `${CHEQUE_EVENT_LABEL[input.type]} چک ${cheque.serialNo} — ${formatMoney(cheque.amount)} ریال${input.description ? ` — ${input.description}` : ''}`,
        lines,
      });
      voucherId = v.id;
    }

    const event = await tx.chequeEvent.create({
      data: {
        chequeId: cheque.id,
        type: input.type,
        date: input.date,
        description: input.description ?? null,
        voucherId,
        bankAccountId: input.bankAccountId ?? null,
        partyId: input.partyId ?? null,
        feeAmount: fee,
        createdById: userId,
      },
    });
    if (input.type !== 'NOTE') {
      await tx.cheque.update({ where: { id: cheque.id }, data: { status: newStatus, location } });
    }
    await writeAudit(tx, {
      userId,
      action: `cheque.${input.type.toLowerCase()}`,
      objectType: 'Cheque',
      objectId: cheque.id,
      entityId: cheque.entityId,
      data: { serialNo: cheque.serialNo, status: newStatus, voucherId, fee },
    });
    return event;
  }, { maxWait: 10000, timeout: 60000 });
}

export async function createCheque(db: PrismaClient, userId: string, input: ChequeInput, opts?: { postRegister?: boolean; counterAccountId?: string | null }) {
  return db.$transaction((tx) => createChequeTx(tx, userId, input, opts), { maxWait: 10000, timeout: 60000 });
}
