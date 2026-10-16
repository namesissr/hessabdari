import { Prisma, type BankAccountKind, type PartyKind, type PrismaClient } from '@prisma/client';
import { AppError } from '@/lib/errors';
import { writeAudit } from '@/lib/audit';
import { nextSequence } from '@/modules/ledger/posting';

type Tx = Prisma.TransactionClient;

export const PARTY_ROLES: Record<string, string> = {
  CUSTOMER: 'مشتری',
  SUPPLIER: 'تأمین‌کننده',
  EMPLOYEE: 'کارمند',
  SHAREHOLDER: 'سهامدار',
  BANK: 'بانک',
  GOVERNMENT: 'سازمان دولتی',
  OTHER: 'سایر',
};

export const BANK_KIND_LABEL: Record<BankAccountKind, string> = {
  BANK: 'حساب بانکی',
  CASH: 'صندوق',
  PETTY_CASH: 'تنخواه‌گردان',
};

/** کد خودکار برای تفصیلی‌های جدید */
async function autoCode(tx: Tx, prefix: string, key: string) {
  const n = await nextSequence(tx, key);
  return `${prefix}-${String(n).padStart(4, '0')}`;
}

export type PartyInput = {
  entityId?: string | null;
  code?: string | null;
  name: string;
  kind: PartyKind;
  nationalCode?: string | null;
  economicCode?: string | null;
  registrationNo?: string | null;
  phone?: string | null;
  mobile?: string | null;
  email?: string | null;
  address?: string | null;
  bankName?: string | null;
  accountNo?: string | null;
  iban?: string | null;
  roles?: string[];
  notes?: string | null;
  active?: boolean;
};

export async function saveParty(db: PrismaClient, userId: string, input: PartyInput, id?: string | null) {
  if (!input.name.trim()) throw new AppError('نام طرف حساب الزامی است.');
  if (input.nationalCode && !/^\d{10,11}$/.test(input.nationalCode)) throw new AppError('کد/شناسهٔ ملی باید ۱۰ یا ۱۱ رقم باشد.');
  if (input.iban && !/^(IR)?\d{24}$/.test(input.iban.replace(/\s/g, ''))) throw new AppError('شمارهٔ شبا باید ۲۴ رقم (با یا بدون IR) باشد.');

  return db.$transaction(async (tx) => {
    const type = await tx.dimensionType.findUniqueOrThrow({ where: { code: 'PARTY' } });
    const data = {
      kind: input.kind,
      entityId: input.entityId ?? null,
      nationalCode: input.nationalCode ?? null,
      economicCode: input.economicCode ?? null,
      registrationNo: input.registrationNo ?? null,
      phone: input.phone ?? null,
      mobile: input.mobile ?? null,
      email: input.email ?? null,
      address: input.address ?? null,
      bankName: input.bankName ?? null,
      accountNo: input.accountNo ?? null,
      iban: input.iban ? input.iban.replace(/\s/g, '') : null,
      roles: input.roles ?? [],
      notes: input.notes ?? null,
      active: input.active ?? true,
    };
    if (id) {
      const party = await tx.party.findUniqueOrThrow({ where: { id } });
      await tx.dimensionValue.update({
        where: { id: party.dimensionValueId },
        data: { name: input.name.trim(), entityId: data.entityId, active: data.active, ...(input.code ? { code: input.code.trim() } : {}) },
      });
      const updated = await tx.party.update({ where: { id }, data });
      await writeAudit(tx, { userId, action: 'party.update', objectType: 'Party', objectId: id, entityId: data.entityId, data: { name: input.name } });
      return updated;
    }
    const code = input.code?.trim() || (await autoCode(tx, 'P', 'party-code'));
    const value = await tx.dimensionValue.create({
      data: { typeId: type.id, code, name: input.name.trim(), entityId: data.entityId, active: data.active },
    });
    const party = await tx.party.create({ data: { ...data, dimensionValueId: value.id } });
    await writeAudit(tx, { userId, action: 'party.create', objectType: 'Party', objectId: party.id, entityId: data.entityId, data: { code, name: input.name } });
    return party;
  });
}

export type BankAccountInput = {
  entityId: string;
  code?: string | null;
  name: string;
  kind: BankAccountKind;
  bankName?: string | null;
  branch?: string | null;
  accountNo?: string | null;
  iban?: string | null;
  cardNo?: string | null;
  currency?: string;
  glAccountId: string;
  custodianPartyId?: string | null;
  description?: string | null;
  active?: boolean;
};

export async function saveBankAccount(db: PrismaClient, userId: string, input: BankAccountInput, id?: string | null) {
  if (!input.name.trim()) throw new AppError('نام حساب الزامی است.');
  if (input.iban && !/^(IR)?\d{24}$/.test(input.iban.replace(/\s/g, ''))) throw new AppError('شمارهٔ شبا باید ۲۴ رقم باشد.');
  return db.$transaction(async (tx) => {
    const gl = await tx.account.findUniqueOrThrow({ where: { id: input.glAccountId } });
    if (!gl.isPostable) throw new AppError('حساب معینِ متصل به این حساب بانکی باید قابل ثبت باشد.');
    const type = await tx.dimensionType.findUniqueOrThrow({ where: { code: 'BANK_ACCOUNT' } });
    const data = {
      entityId: input.entityId,
      kind: input.kind,
      bankName: input.bankName ?? null,
      branch: input.branch ?? null,
      accountNo: input.accountNo ?? null,
      iban: input.iban ? input.iban.replace(/\s/g, '') : null,
      cardNo: input.cardNo ?? null,
      currency: input.currency ?? 'IRR',
      glAccountId: input.glAccountId,
      custodianPartyId: input.custodianPartyId ?? null,
      description: input.description ?? null,
      active: input.active ?? true,
    };
    if (id) {
      const acc = await tx.bankAccount.findUniqueOrThrow({ where: { id } });
      await tx.dimensionValue.update({
        where: { id: acc.dimensionValueId },
        data: { name: input.name.trim(), entityId: input.entityId, active: data.active, ...(input.code ? { code: input.code.trim() } : {}) },
      });
      const updated = await tx.bankAccount.update({ where: { id }, data });
      await writeAudit(tx, { userId, action: 'bank_account.update', objectType: 'BankAccount', objectId: id, entityId: input.entityId, data: { name: input.name } });
      return updated;
    }
    const code = input.code?.trim() || (await autoCode(tx, input.kind === 'BANK' ? 'BK' : input.kind === 'CASH' ? 'CS' : 'PC', 'bank-code'));
    const value = await tx.dimensionValue.create({
      data: { typeId: type.id, code, name: input.name.trim(), entityId: input.entityId, active: data.active },
    });
    const bank = await tx.bankAccount.create({ data: { ...data, dimensionValueId: value.id } });
    await writeAudit(tx, { userId, action: 'bank_account.create', objectType: 'BankAccount', objectId: bank.id, entityId: input.entityId, data: { code, name: input.name } });
    return bank;
  });
}

/** ماندهٔ هر حساب بانکی/صندوق/تنخواه تا تاریخ مشخص */
export async function bankBalances(db: PrismaClient, entityIds: string[], asOf?: Date | null) {
  const dateFilter = asOf ? Prisma.sql`AND v."date" <= ${asOf}::date` : Prisma.empty;
  const rows = await db.$queryRaw<{ dimensionValueId: string; balance: bigint }[]>`
    SELECT i."valueId" AS "dimensionValueId", COALESCE(SUM(l."debit" - l."credit"), 0)::bigint AS balance
    FROM "voucher_lines" l
    JOIN "vouchers" v ON v.id = l."voucherId"
    JOIN "dimension_set_items" i ON i."setId" = l."dimensionSetId"
    JOIN "dimension_types" t ON t.id = i."typeId" AND t."code" = 'BANK_ACCOUNT'
    WHERE v."status" = 'POSTED' AND v."entityId" = ANY(${entityIds})
      AND v."type"::text <> 'CLOSING'
      ${dateFilter}
    GROUP BY i."valueId"`;
  return new Map(rows.map((r) => [r.dimensionValueId, r.balance]));
}
