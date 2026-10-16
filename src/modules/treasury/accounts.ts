import type { Prisma, PrismaClient } from '@prisma/client';
import { AppError } from '@/lib/errors';

type Db = Prisma.TransactionClient | PrismaClient;

/**
 * حساب‌های سیستمی خزانه و چک.
 * ابتدا بر اساس systemRole و در نبود آن بر اساس کد استاندارد چارت پیدا می‌شوند،
 * تا نصب‌های قدیمی هم بدون مهاجرت دستی کار کنند.
 */
export const SYSTEM_ACCOUNTS = {
  AR_TRADE: { code: '1301', label: 'حساب‌های دریافتنی تجاری' },
  CHEQUES_RECEIVABLE: { code: '1302', label: 'اسناد دریافتنی (چک‌های دریافتی)' },
  CHEQUES_IN_COLLECTION: { code: '1303', label: 'چک‌های در جریان وصول' },
  AP_TRADE: { code: '3101', label: 'حساب‌های پرداختنی تجاری' },
  CHEQUES_PAYABLE: { code: '3102', label: 'اسناد پرداختنی (چک‌های پرداختی)' },
  BANK_FEE: { code: '8602', label: 'کارمزد خدمات بانکی' },
  VAT_PAYABLE: { code: '3201', label: 'مالیات بر ارزش افزودهٔ فروش' },
  VAT_RECEIVABLE: { code: '1503', label: 'مالیات بر ارزش افزودهٔ خرید' },
  GATEWAY_CLEARING: { code: '1104', label: 'وجوه در راه (تسویهٔ درگاه)' },
  WALLET_LIABILITY: { code: '3302', label: 'موجودی کیف پول کاربران' },
  DEFERRED_REVENUE: { code: '3303', label: 'درآمد مربوط به دوره‌های آتی' },
  OPERATING_REVENUE: { code: '6101', label: 'درآمد فروش اشتراک' },
  SALES_RETURN: { code: '6201', label: 'برگشت از فروش' },
  GATEWAY_FEE: { code: '7103', label: 'کارمزد درگاه‌های پرداخت' },
  OTHER_DIRECT_COST: { code: '7106', label: 'سایر هزینه‌های مستقیم خدمات' },
  GUARANTEE_GIVEN: { code: '9101', label: 'اسناد تضمینی ما نزد دیگران' },
  GUARANTEE_GIVEN_CONTRA: { code: '9201', label: 'طرف اسناد تضمینی ما نزد دیگران' },
  GUARANTEE_HELD: { code: '9102', label: 'اسناد تضمینی دیگران نزد ما' },
  GUARANTEE_HELD_CONTRA: { code: '9202', label: 'طرف اسناد تضمینی دیگران نزد ما' },
} as const;

export type SystemAccountKey = keyof typeof SYSTEM_ACCOUNTS;

export async function systemAccountId(db: Db, chartId: string, key: SystemAccountKey): Promise<string> {
  const spec = SYSTEM_ACCOUNTS[key];
  const acc =
    (await db.account.findFirst({ where: { chartId, systemRole: key } })) ??
    (await db.account.findFirst({ where: { chartId, code: spec.code } }));
  if (!acc) throw new AppError(`حساب «${spec.label}» (کد ${spec.code}) در چارت تعریف نشده است.`);
  if (!acc.isPostable) throw new AppError(`حساب «${acc.code} ${acc.name}» قابل ثبت نیست.`);
  return acc.id;
}

/** چند حساب سیستمی را یک‌جا می‌گیرد */
export async function systemAccounts<K extends SystemAccountKey>(db: Db, chartId: string, keys: K[]): Promise<Record<K, string>> {
  const out = {} as Record<K, string>;
  for (const k of keys) out[k] = await systemAccountId(db, chartId, k);
  return out;
}

/** شناسهٔ انواع ابعاد پرکاربرد */
export async function dimTypeIds(db: Db) {
  const types = await db.dimensionType.findMany({ where: { code: { in: ['PARTY', 'BANK_ACCOUNT', 'BUSINESS', 'COST_CENTER', 'PROJECT'] } } });
  const map = Object.fromEntries(types.map((t) => [t.code, t.id])) as Record<'PARTY' | 'BANK_ACCOUNT' | 'BUSINESS' | 'COST_CENTER' | 'PROJECT', string>;
  for (const code of ['PARTY', 'BANK_ACCOUNT', 'BUSINESS'] as const) {
    if (!map[code]) throw new AppError(`نوع تفصیلی «${code}» در سیستم تعریف نشده است.`);
  }
  return map;
}
