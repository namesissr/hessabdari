import 'server-only';
import { pageUser } from './auth';
import { activeContext } from './context';
import { formatJ, parseJ, todayUtc } from './jalali';

/** کاربر + شرکت و سال مالی فعال برای صفحات */
export async function pageContext() {
  const user = await pageUser();
  const ctx = await activeContext(user);
  return { user, ...ctx };
}

export type SP = Promise<Record<string, string | string[] | undefined>>;

export function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? '' : v ?? '';
}

export function many(v: string | string[] | undefined): string[] {
  return (Array.isArray(v) ? v : v ? [v] : []).filter(Boolean);
}

/** بازهٔ تاریخ گزارش: پیش‌فرض از ابتدای سال مالی تا امروز (یا پایان سال) */
export function reportRange(sp: Record<string, string | string[] | undefined>, fy: { startDate: Date; endDate: Date }) {
  const today = todayUtc();
  const defTo = today < fy.endDate && today >= fy.startDate ? today : fy.endDate;
  let from = parseJ(one(sp.from)) ?? fy.startDate;
  let to = parseJ(one(sp.to)) ?? defTo;
  if (from < fy.startDate) from = fy.startDate;
  if (to > fy.endDate) to = fy.endDate;
  return { from, to, fromStr: formatJ(from, false), toStr: formatJ(to, false) };
}
