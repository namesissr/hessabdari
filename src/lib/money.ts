import { toFaDigits, toLatinDigits } from './jalali';

/** مبالغ ریالی BigInt هستند؛ در مرز API به صورت رشته منتقل می‌شوند. */

export function toBig(v: bigint | number | string | null | undefined): bigint {
  if (v === null || v === undefined || v === '') return 0n;
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') return BigInt(Math.round(v));
  const s = toLatinDigits(v).replace(/[,،٬\s]/g, '');
  if (!/^-?\d+$/.test(s)) throw new Error('مبلغ نامعتبر است');
  return BigInt(s);
}

/** ۱۲٬۳۴۵٬۶۷۸ ؛ منفی داخل پرانتز */
export function formatMoney(v: bigint | number | string | null | undefined, opts: { fa?: boolean; parens?: boolean; zero?: string } = {}): string {
  const n = toBig(v as never);
  const { fa = true, parens = true, zero } = opts;
  if (n === 0n && zero !== undefined) return zero;
  const neg = n < 0n;
  const abs = (neg ? -n : n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  let s = fa ? toFaDigits(abs).replace(/,/g, '٬') : abs;
  if (neg) s = parens ? `(${s})` : `-${s}`;
  return s;
}

export function sumBig<T>(items: T[], pick: (t: T) => bigint): bigint {
  let s = 0n;
  for (const i of items) s += pick(i);
  return s;
}

export function absBig(n: bigint): bigint {
  return n < 0n ? -n : n;
}
