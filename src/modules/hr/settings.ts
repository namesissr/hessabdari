import type { Prisma, PrismaClient } from '@prisma/client';
import { AppError } from '@/lib/errors';

type Db = Prisma.TransactionClient | PrismaClient;

/**
 * نرخ‌های حقوق و دستمزد سالانه است و هر سال با بخشنامهٔ وزارت کار و قانون بودجه عوض می‌شود،
 * پس همه‌چیز در جدول تنظیمات و قابل ویرایش در پنل است. مقادیر زیر فقط «نقطهٔ شروع» هستند.
 */

export type TaxBracket = { to: number | null; rate: number };

export type PayrollAccounts = {
  salaryExpense: string; // هزینهٔ حقوق و دستمزد
  overtimeExpense: string; // اضافه‌کار و مزایا
  employerInsuranceExpense: string; // بیمهٔ سهم کارفرما
  severanceExpense: string; // هزینهٔ مزایای پایان خدمت
  salaryPayable: string; // حقوق پرداختنی
  insurancePayable: string; // حق بیمهٔ پرداختنی
  taxPayable: string; // مالیات تکلیفی پرداختنی
  severanceProvision: string; // ذخیرهٔ مزایای پایان خدمت
  employeeLoan: string; // وام و مساعدهٔ کارکنان
};

export const DEFAULT_ACCOUNTS: PayrollAccounts = {
  salaryExpense: '8101',
  overtimeExpense: '8102',
  employerInsuranceExpense: '8103',
  severanceExpense: '8104',
  salaryPayable: '3204',
  insurancePayable: '3203',
  taxPayable: '3202',
  severanceProvision: '4201',
  employeeLoan: '1401',
};

/** پلکان مالیات حقوق — ساختار استاندارد؛ ارقام را هر سال به‌روز کنید */
export const DEFAULT_TAX_BRACKETS: TaxBracket[] = [
  { to: 240_000_000, rate: 10 },
  { to: 360_000_000, rate: 15 },
  { to: 480_000_000, rate: 20 },
  { to: null, rate: 30 },
];

export const DEFAULT_SETTINGS = {
  dailyMinWage: 2_800_000n,
  monthlyWorkHours: 192,
  insuranceEmployeeRate: 7,
  insuranceEmployerRate: 23,
  insuranceCeiling: 0n,
  taxExemptMonthly: 120_000_000n,
  childAllowanceRate: 8_400_000n,
  housingDefault: 9_000_000n,
  foodDefault: 20_000_000n,
  overtimeFactor: 1.4,
  holidayFactor: 1.4,
  nightFactor: 0.35,
  severanceDaysPerYear: 30,
};

export type ResolvedSettings = {
  id: string | null;
  jy: number;
  dailyMinWage: bigint;
  monthlyWorkHours: number;
  insuranceEmployeeRate: number;
  insuranceEmployerRate: number;
  insuranceCeiling: bigint;
  taxExemptMonthly: bigint;
  taxBrackets: TaxBracket[];
  childAllowanceRate: bigint;
  housingDefault: bigint;
  foodDefault: bigint;
  overtimeFactor: number;
  holidayFactor: number;
  nightFactor: number;
  severanceDaysPerYear: number;
  accounts: PayrollAccounts;
};

/** تنظیمات سال؛ اگر برای آن سال ثبت نشده باشد، نزدیک‌ترین سال قبل یا پیش‌فرض‌ها */
export async function payrollSettings(db: Db, entityId: string, jy: number): Promise<ResolvedSettings> {
  const row =
    (await db.payrollSettings.findUnique({ where: { entityId_jy: { entityId, jy } } })) ??
    (await db.payrollSettings.findFirst({ where: { entityId, jy: { lt: jy } }, orderBy: { jy: 'desc' } }));
  if (!row) {
    return { id: null, jy, ...DEFAULT_SETTINGS, taxBrackets: DEFAULT_TAX_BRACKETS, accounts: DEFAULT_ACCOUNTS };
  }
  return {
    id: row.id,
    jy: row.jy,
    dailyMinWage: row.dailyMinWage,
    monthlyWorkHours: Number(row.monthlyWorkHours),
    insuranceEmployeeRate: Number(row.insuranceEmployeeRate),
    insuranceEmployerRate: Number(row.insuranceEmployerRate),
    insuranceCeiling: row.insuranceCeiling,
    taxExemptMonthly: row.taxExemptMonthly,
    taxBrackets: (row.taxBrackets as unknown as TaxBracket[]) ?? DEFAULT_TAX_BRACKETS,
    childAllowanceRate: row.childAllowanceRate,
    housingDefault: row.housingDefault,
    foodDefault: row.foodDefault,
    overtimeFactor: Number(row.overtimeFactor),
    holidayFactor: Number(row.holidayFactor),
    nightFactor: Number(row.nightFactor),
    severanceDaysPerYear: row.severanceDaysPerYear,
    accounts: { ...DEFAULT_ACCOUNTS, ...((row.accounts as unknown as Partial<PayrollAccounts>) ?? {}) },
  };
}

/**
 * تنظیماتی که داخل ستون Json ذخیره شده‌اند، مبالغ را به صورت رشته برمی‌گردانند؛
 * این تابع همیشه یک شیء با BigInt سالم می‌دهد.
 */
export function normalizeSettings(raw: unknown, fallback: ResolvedSettings): ResolvedSettings {
  if (!raw || typeof raw !== 'object') return fallback;
  const o = raw as Record<string, unknown>;
  const big = (v: unknown, d: bigint) => {
    if (typeof v === 'bigint') return v;
    if (typeof v === 'number') return BigInt(Math.round(v));
    if (typeof v === 'string' && /^-?\d+$/.test(v)) return BigInt(v);
    return d;
  };
  const num = (v: unknown, d: number) => (typeof v === 'number' ? v : typeof v === 'string' && v !== '' && !isNaN(Number(v)) ? Number(v) : d);
  return {
    id: typeof o.id === 'string' ? o.id : null,
    jy: num(o.jy, fallback.jy),
    dailyMinWage: big(o.dailyMinWage, fallback.dailyMinWage),
    monthlyWorkHours: num(o.monthlyWorkHours, fallback.monthlyWorkHours),
    insuranceEmployeeRate: num(o.insuranceEmployeeRate, fallback.insuranceEmployeeRate),
    insuranceEmployerRate: num(o.insuranceEmployerRate, fallback.insuranceEmployerRate),
    insuranceCeiling: big(o.insuranceCeiling, fallback.insuranceCeiling),
    taxExemptMonthly: big(o.taxExemptMonthly, fallback.taxExemptMonthly),
    taxBrackets: Array.isArray(o.taxBrackets) ? (o.taxBrackets as TaxBracket[]) : fallback.taxBrackets,
    childAllowanceRate: big(o.childAllowanceRate, fallback.childAllowanceRate),
    housingDefault: big(o.housingDefault, fallback.housingDefault),
    foodDefault: big(o.foodDefault, fallback.foodDefault),
    overtimeFactor: num(o.overtimeFactor, fallback.overtimeFactor),
    holidayFactor: num(o.holidayFactor, fallback.holidayFactor),
    nightFactor: num(o.nightFactor, fallback.nightFactor),
    severanceDaysPerYear: num(o.severanceDaysPerYear, fallback.severanceDaysPerYear),
    accounts: { ...fallback.accounts, ...((o.accounts as Partial<PayrollAccounts>) ?? {}) },
  };
}

export function validateBrackets(brackets: TaxBracket[]) {
  if (!brackets.length) throw new AppError('حداقل یک پلهٔ مالیاتی لازم است.');
  let prev = 0;
  for (const [i, b] of brackets.entries()) {
    if (b.rate < 0 || b.rate > 100) throw new AppError(`نرخ پلهٔ ${i + 1} معتبر نیست.`);
    if (b.to !== null) {
      if (b.to <= prev) throw new AppError('سقف پله‌ها باید صعودی باشد.');
      prev = b.to;
    } else if (i !== brackets.length - 1) {
      throw new AppError('پلهٔ بدون سقف باید آخرین پله باشد.');
    }
  }
  if (brackets[brackets.length - 1].to !== null) throw new AppError('آخرین پله باید بدون سقف باشد (مازاد).');
  return brackets;
}
