import { toJalaali, toGregorian, isValidJalaaliDate, jalaaliMonthLength } from 'jalaali-js';

/**
 * همهٔ تاریخ‌ها به صورت «نیمه‌شب UTC» ذخیره می‌شوند (ستون‌های @db.Date)
 * تا تبدیل شمسی/میلادی به منطقهٔ زمانی سرور وابسته نباشد.
 */

export const JALALI_MONTHS = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
];

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

export function toLatinDigits(s: string): string {
  return s.replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d))).replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)));
}

export function toFaDigits(s: string | number): string {
  return String(s).replace(/\d/g, (d) => FA_DIGITS[Number(d)]);
}

export function utcDate(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d));
}

export type JDate = { jy: number; jm: number; jd: number };

export function dateToJ(date: Date): JDate {
  return toJalaali(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export function jToDate(jy: number, jm: number, jd: number): Date {
  const g = toGregorian(jy, jm, jd);
  return utcDate(g.gy, g.gm, g.gd);
}

/** «۱۴۰۵/۰۶/۳۱» — با fa=false ارقام لاتین */
export function formatJ(date: Date | string | null | undefined, fa = true): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  const { jy, jm, jd } = dateToJ(d);
  const s = `${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`;
  return fa ? toFaDigits(s) : s;
}

/** ورودی «1405/6/31» یا «۱۴۰۵-۰۶-۳۱» → Date ؛ نامعتبر → null */
export function parseJ(input: string | null | undefined): Date | null {
  if (!input) return null;
  const m = toLatinDigits(input.trim()).match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/);
  if (!m) return null;
  const [jy, jm, jd] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (!isValidJalaaliDate(jy, jm, jd)) return null;
  return jToDate(jy, jm, jd);
}

export function todayUtc(): Date {
  const n = new Date();
  // تاریخ امروز بر اساس وقت تهران
  const teh = new Date(n.getTime() + 3.5 * 3600 * 1000);
  return utcDate(teh.getUTCFullYear(), teh.getUTCMonth() + 1, teh.getUTCDate());
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86400000);
}

export function monthLength(jy: number, jm: number): number {
  return jalaaliMonthLength(jy, jm);
}

/** اضافه کردن n ماه شمسی به (jy,jm) */
export function addJMonths(jy: number, jm: number, n: number): { jy: number; jm: number } {
  const idx = jy * 12 + (jm - 1) + n;
  return { jy: Math.floor(idx / 12), jm: (idx % 12) + 1 };
}

export function jMonthTitle(jy: number, jm: number): string {
  return `${JALALI_MONTHS[jm - 1]} ${toFaDigits(jy)}`;
}
