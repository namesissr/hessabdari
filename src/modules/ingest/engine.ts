import { createHash, randomBytes } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { AppError } from '@/lib/errors';
import { writeAudit } from '@/lib/audit';
import { errorMessage } from '@/lib/errors';
import { toBig } from '@/lib/money';
import { createAndPostTx, type LineInput } from '@/modules/ledger/posting';
import { dimTypeIds, systemAccountId, type SystemAccountKey } from '@/modules/treasury/accounts';

type Tx = Prisma.TransactionClient;

/** کاربر سیستمی که اسناد خودکار به نام او ثبت می‌شوند */
async function systemUserId(tx: Tx): Promise<string> {
  const u = (await tx.user.findFirst({ where: { email: SYSTEM_USER_EMAIL } })) ?? (await tx.user.findFirst({ where: { role: "ADMIN" }, orderBy: { createdAt: "asc" } }));
  if (!u) throw new AppError("کاربر سیستمی برای ثبت سند خودکار پیدا نشد.");
  return u.id;
}

export const SYSTEM_USER_EMAIL = "system@hesabdari.local";

/**
 * دریافت خودکار رویدادهای مالی از سایت‌ها (ارزینو، بلوپال، چارتینو، فیلیمینو و هر سایت بعدی).
 * هر رویداد با کلید یکتای خودش فقط یک بار سند می‌شود؛ ارسال دوباره بی‌خطر است.
 */

export const EVENT_TYPES = {
  'order.paid': 'فروش / پرداخت سفارش',
  'refund.issued': 'برگشت و استرداد',
  'wallet.topup': 'شارژ کیف پول',
  'wallet.consumed': 'مصرف کیف پول (شناسایی درآمد)',
  'gateway.settled': 'تسویهٔ درگاه پرداخت',
  'vendor.bill': 'صورتحساب تأمین‌کننده',
} as const;

export type EventType = keyof typeof EVENT_TYPES;

export type EventPayload = {
  type: EventType;
  externalId: string;
  occurredAt?: string;
  /** مبلغ کل به ریال (شامل مالیات) */
  amount: number | string;
  /** مالیات بر ارزش افزوده داخل مبلغ */
  tax?: number | string | null;
  /** کارمزد درگاه یا بانک */
  fee?: number | string | null;
  description?: string | null;
  /** برای gateway.settled: مبلغی که به حساب نشست (در نبود آن amount - fee) */
  netAmount?: number | string | null;
  /** کد حساب بانکی مقصد (از تنظیمات منبع هم قابل تعیین است) */
  bankAccountCode?: string | null;
  /** برای vendor.bill */
  vendor?: { code?: string | null; name?: string | null; nationalCode?: string | null } | null;
  accountCode?: string | null;
  customer?: { code?: string | null; name?: string | null } | null;
};

export type SourceConfig = {
  /** کد حساب بانکی پیش‌فرض برای تسویهٔ درگاه */
  bankAccountCode?: string | null;
  /** کد حساب درآمد (پیش‌فرض ۶۱۰۱) */
  revenueAccountCode?: string | null;
  /** کد حساب هزینهٔ پیش‌فرض برای صورتحساب تأمین‌کننده (پیش‌فرض ۷۱۰۱) */
  expenseAccountCode?: string | null;
  /** نرخ مالیات پیش‌فرض برای وقتی سایت مالیات را جدا نفرستد */
  defaultTaxRate?: number | null;
};

export function hashSecret(secret: string) {
  return createHash('sha256').update(secret).digest('hex');
}

export function generateSecret() {
  return randomBytes(24).toString('base64url');
}

async function accountByCode(tx: Tx, chartId: string, code: string | null | undefined, fallback: SystemAccountKey) {
  if (code) {
    const acc = await tx.account.findFirst({ where: { chartId, code } });
    if (!acc) throw new AppError(`حساب با کد ${code} در چارت پیدا نشد.`);
    if (!acc.isPostable) throw new AppError(`حساب ${code} قابل ثبت نیست.`);
    return acc.id;
  }
  return systemAccountId(tx, chartId, fallback);
}

async function bankByCode(tx: Tx, entityId: string, code: string | null | undefined) {
  if (!code) return null;
  const bank = await tx.bankAccount.findFirst({ where: { entityId, dimensionValue: { code } }, include: { dimensionValue: true } });
  if (!bank) throw new AppError(`حساب بانکی با کد ${code} تعریف نشده است.`);
  return bank;
}

/** طرف حساب را پیدا می‌کند و در نبود آن می‌سازد (برای تأمین‌کننده‌های سایت) */
async function ensureParty(tx: Tx, entityId: string, info: { code?: string | null; name?: string | null; nationalCode?: string | null }) {
  const type = await tx.dimensionType.findUniqueOrThrow({ where: { code: 'PARTY' } });
  if (info.code) {
    const existing = await tx.party.findFirst({ where: { dimensionValue: { typeId: type.id, code: info.code } } });
    if (existing) return existing;
  }
  if (info.name) {
    const byName = await tx.party.findFirst({ where: { dimensionValue: { typeId: type.id, name: info.name } } });
    if (byName) return byName;
  }
  const name = info.name?.trim();
  if (!name) throw new AppError('برای صورتحساب تأمین‌کننده، نام طرف حساب لازم است.');
  const code = info.code?.trim() || `AUTO-${Date.now().toString(36).toUpperCase()}`;
  const value = await tx.dimensionValue.create({ data: { typeId: type.id, code, name } });
  return tx.party.create({ data: { dimensionValueId: value.id, entityId: null, kind: 'COMPANY', nationalCode: info.nationalCode ?? null, roles: ['SUPPLIER'] } });
}

/** ساخت ردیف‌های سند برای یک رویداد */
async function buildLines(tx: Tx, source: { entityId: string; businessDimId: string; config: SourceConfig }, chartId: string, e: EventPayload) {
  const dims = await dimTypeIds(tx);
  const B = { [dims.BUSINESS]: source.businessDimId };
  const amount = toBig(e.amount as never);
  if (amount <= 0n) throw new AppError('مبلغ رویداد باید بزرگ‌تر از صفر باشد.');
  const tax = toBig(e.tax ?? 0);
  const fee = toBig(e.fee ?? 0);
  if (tax > amount) throw new AppError('مالیات از مبلغ کل بیشتر است.');
  const net = amount - tax;
  const lines: LineInput[] = [];

  const clearing = await systemAccountId(tx, chartId, 'GATEWAY_CLEARING');
  const vatPayable = await systemAccountId(tx, chartId, 'VAT_PAYABLE');
  const revenue = await accountByCode(tx, chartId, source.config.revenueAccountCode, 'OPERATING_REVENUE');

  switch (e.type) {
    case 'order.paid': {
      lines.push({ accountId: clearing, debit: amount, dims: B, description: e.description });
      lines.push({ accountId: revenue, credit: net, dims: B });
      if (tax > 0n) lines.push({ accountId: vatPayable, credit: tax, dims: B, description: 'مالیات بر ارزش افزوده' });
      break;
    }
    case 'refund.issued': {
      const ret = await systemAccountId(tx, chartId, 'SALES_RETURN');
      lines.push({ accountId: ret, debit: net, dims: B, description: e.description });
      if (tax > 0n) lines.push({ accountId: vatPayable, debit: tax, dims: B, description: 'برگشت مالیات' });
      lines.push({ accountId: clearing, credit: amount, dims: B });
      break;
    }
    case 'wallet.topup': {
      const wallet = await systemAccountId(tx, chartId, 'WALLET_LIABILITY');
      lines.push({ accountId: clearing, debit: amount, dims: B, description: e.description });
      lines.push({ accountId: wallet, credit: amount, dims: B });
      break;
    }
    case 'wallet.consumed': {
      const wallet = await systemAccountId(tx, chartId, 'WALLET_LIABILITY');
      lines.push({ accountId: wallet, debit: amount, dims: B, description: e.description });
      lines.push({ accountId: revenue, credit: net, dims: B });
      if (tax > 0n) lines.push({ accountId: vatPayable, credit: tax, dims: B, description: 'مالیات بر ارزش افزوده' });
      break;
    }
    case 'gateway.settled': {
      const bank = await bankByCode(tx, source.entityId, e.bankAccountCode ?? source.config.bankAccountCode);
      if (!bank) throw new AppError('برای تسویهٔ درگاه باید حساب بانکی مقصد در تنظیمات منبع مشخص شود.');
      const feeAccount = await systemAccountId(tx, chartId, 'GATEWAY_FEE');
      const netSettled = e.netAmount != null ? toBig(e.netAmount as never) : amount - fee;
      const realFee = amount - netSettled;
      lines.push({ accountId: bank.glAccountId, debit: netSettled, dims: { [dims.BANK_ACCOUNT]: bank.dimensionValueId }, description: e.description });
      if (realFee > 0n) lines.push({ accountId: feeAccount, debit: realFee, dims: B, description: 'کارمزد درگاه' });
      lines.push({ accountId: clearing, credit: amount, dims: B });
      break;
    }
    case 'vendor.bill': {
      const expense = await accountByCode(tx, chartId, e.accountCode ?? source.config.expenseAccountCode, 'OTHER_DIRECT_COST');
      const party = await ensureParty(tx, source.entityId, e.vendor ?? {});
      const vatReceivable = await systemAccountId(tx, chartId, 'VAT_RECEIVABLE');
      const payable = await systemAccountId(tx, chartId, 'AP_TRADE');
      lines.push({ accountId: expense, debit: net, dims: B, description: e.description });
      if (tax > 0n) lines.push({ accountId: vatReceivable, debit: tax, dims: B });
      lines.push({ accountId: payable, credit: amount, dims: { [dims.PARTY]: party.dimensionValueId } });
      break;
    }
    default:
      throw new AppError(`نوع رویداد «${e.type}» پشتیبانی نمی‌شود.`);
  }
  return { lines, amount };
}

/** ثبت رویداد و (در صورت امکان) صدور سند — خروجی برای پاسخ API */
export async function ingestEvent(db: PrismaClient, sourceId: string, payload: EventPayload) {
  const source = await db.ingestSource.findUniqueOrThrow({ where: { id: sourceId }, include: { entity: true } });
  if (!source.active) throw new AppError('این منبع غیرفعال است.');
  if (!payload.externalId) throw new AppError('externalId الزامی است.');
  if (!payload.type) throw new AppError('type الزامی است.');

  const existing = await db.ingestEvent.findUnique({ where: { sourceId_externalId: { sourceId, externalId: payload.externalId } } });
  if (existing && existing.status === 'POSTED') {
    return { duplicate: true, eventId: existing.id, voucherId: existing.voucherId, status: existing.status };
  }

  const occurredAt = payload.occurredAt ? new Date(payload.occurredAt) : new Date();
  const date = new Date(Date.UTC(occurredAt.getUTCFullYear(), occurredAt.getUTCMonth(), occurredAt.getUTCDate()));

  try {
    const result = await db.$transaction(async (tx) => {
      const event = existing
        ? await tx.ingestEvent.update({ where: { id: existing.id }, data: { payload: payload as object, status: 'PENDING', error: null, type: payload.type } })
        : await tx.ingestEvent.create({
            data: { sourceId, type: payload.type, externalId: payload.externalId, payload: payload as object, status: 'PENDING' },
          });

      const { lines, amount } = await buildLines(
        tx,
        { entityId: source.entityId, businessDimId: source.businessDimId, config: (source.config as SourceConfig) ?? {} },
        source.entity.chartId,
        payload,
      );

      const voucher = await createAndPostTx(tx, await systemUserId(tx), {
        entityId: source.entityId,
        date,
        type: 'SYSTEM',
        sourceModule: `ingest:${source.code}`,
        sourceRef: event.id,
        idempotencyKey: `ingest:${source.id}:${payload.externalId}`,
        description: payload.description || `${EVENT_TYPES[payload.type]} — ${source.name} (${payload.externalId})`,
        lines,
      });

      const updated = await tx.ingestEvent.update({
        where: { id: event.id },
        data: { status: 'POSTED', voucherId: voucher.id, amount, processedAt: new Date(), error: null },
      });
      await tx.ingestSource.update({ where: { id: sourceId }, data: { lastEventAt: new Date() } });
      return { eventId: updated.id, voucherId: voucher.id, status: updated.status };
    }, { maxWait: 10000, timeout: 60000 });
    return { duplicate: false, ...result };
  } catch (err) {
    const message = errorMessage(err);
    await db.ingestEvent.upsert({
      where: { sourceId_externalId: { sourceId, externalId: payload.externalId } },
      update: { status: 'FAILED', error: message, payload: payload as object, type: payload.type },
      create: { sourceId, type: payload.type, externalId: payload.externalId, payload: payload as object, status: 'FAILED', error: message },
    });
    throw new AppError(message, 422);
  }
}

/** تلاش دوبارهٔ رویدادهای ناموفق (مثلاً بعد از اصلاح تنظیمات) */
export async function retryEvent(db: PrismaClient, userId: string, eventId: string) {
  const event = await db.ingestEvent.findUniqueOrThrow({ where: { id: eventId } });
  if (event.status === 'POSTED') throw new AppError('این رویداد قبلاً سند خورده است.');
  const r = await ingestEvent(db, event.sourceId, event.payload as unknown as EventPayload);
  await db.$transaction((tx) => writeAudit(tx, { userId, action: 'ingest.retry', objectType: 'IngestEvent', objectId: eventId, data: { voucherId: r.voucherId } }));
  return r;
}

export async function ignoreEvent(db: PrismaClient, userId: string, eventId: string, note: string) {
  return db.$transaction(async (tx) => {
    const event = await tx.ingestEvent.findUniqueOrThrow({ where: { id: eventId } });
    if (event.status === 'POSTED') throw new AppError('رویداد سندخورده را نمی‌توان نادیده گرفت؛ سند آن را برگشت بزنید.');
    await tx.ingestEvent.update({ where: { id: eventId }, data: { status: 'IGNORED', error: note || null, processedAt: new Date() } });
    await writeAudit(tx, { userId, action: 'ingest.ignore', objectType: 'IngestEvent', objectId: eventId, data: { note } });
  });
}

export async function saveSource(
  db: PrismaClient,
  userId: string,
  input: { id?: string | null; code: string; name: string; entityId: string; businessDimId: string; config: SourceConfig; active: boolean },
) {
  return db.$transaction(async (tx) => {
    const data = { name: input.name, entityId: input.entityId, businessDimId: input.businessDimId, config: input.config as object, active: input.active };
    if (input.id) {
      const updated = await tx.ingestSource.update({ where: { id: input.id }, data });
      await writeAudit(tx, { userId, action: 'ingest_source.update', objectType: 'IngestSource', objectId: updated.id, entityId: input.entityId, data: { code: updated.code } });
      return { source: updated, secret: null as string | null };
    }
    if (!/^[A-Z0-9_-]{2,30}$/.test(input.code)) throw new AppError('کد منبع را لاتین بزرگ وارد کنید (مثلاً ARZINOO).');
    const secret = generateSecret();
    const created = await tx.ingestSource.create({ data: { ...data, code: input.code, secretHash: hashSecret(secret) } });
    await writeAudit(tx, { userId, action: 'ingest_source.create', objectType: 'IngestSource', objectId: created.id, entityId: input.entityId, data: { code: created.code } });
    return { source: created, secret };
  });
}

export async function rotateSecret(db: PrismaClient, userId: string, id: string) {
  const secret = generateSecret();
  await db.ingestSource.update({ where: { id }, data: { secretHash: hashSecret(secret) } });
  await db.$transaction((tx) => writeAudit(tx, { userId, action: 'ingest_source.rotate', objectType: 'IngestSource', objectId: id }));
  return secret;
}

export async function findSourceByKey(db: PrismaClient, key: string) {
  if (!key) return null;
  return db.ingestSource.findFirst({ where: { secretHash: hashSecret(key), active: true } });
}
