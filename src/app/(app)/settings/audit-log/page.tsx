import Link from 'next/link';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { can } from '@/lib/auth';
import { formatJ, parseJ, toFaDigits } from '@/lib/jalali';
import { one, pageContext, type SP } from '@/lib/page';
import { Badge, Card, Empty, PageHeader } from '@/components/ui';

export const metadata = { title: 'لاگ ممیزی' };

const PAGE = 60;

const ACTION_LABEL: Record<string, string> = {
  'voucher.create': 'ثبت سند',
  'voucher.update': 'ویرایش سند',
  'voucher.post': 'قطعی کردن سند',
  'voucher.delete': 'حذف یادداشت',
  'voucher.review': 'بررسی سند',
  'voucher.unreview': 'برگشت به یادداشت',
  'voucher.renumber': 'مرتب‌سازی شماره‌ها',
  'fiscal_year.create': 'ایجاد سال مالی',
  'fiscal_year.update': 'ویرایش سال مالی',
  'fiscal_year.delete': 'حذف سال مالی',
  'fiscal_year.close': 'بستن سال مالی',
  'period.open': 'باز کردن دوره',
  'period.locked': 'قفل دوره',
  'account.create': 'ایجاد حساب',
  'account.update': 'ویرایش حساب',
  'account.delete': 'حذف حساب',
  'dimension_type.create': 'ایجاد نوع تفصیلی',
  'dimension_value.create': 'ایجاد تفصیلی',
  'dimension_value.update': 'ویرایش تفصیلی',
  'dimension_value.delete': 'حذف تفصیلی',
  'entity.create': 'ایجاد شرکت',
  'entity.update': 'ویرایش شرکت',
  'user.create': 'ایجاد کاربر',
  'user.update': 'ویرایش کاربر',
};

export default async function AuditLogPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { user } = await pageContext();
  if (!can(user, 'users.manage')) return <Empty>این گزارش فقط برای مدیر سیستم است.</Empty>;

  const action = one(sp.action);
  const from = parseJ(one(sp.from));
  const to = parseJ(one(sp.to));
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const where: Prisma.AuditLogWhereInput = {
    ...(action ? { action } : {}),
    ...(from || to ? { at: { ...(from ? { gte: from } : {}), ...(to ? { lt: new Date(to.getTime() + 86400000) } : {}) } } : {}),
  };
  const [rows, count, users] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * PAGE, take: PAGE }),
    prisma.auditLog.count({ where }),
    prisma.user.findMany({ select: { id: true, name: true } }),
  ]);
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const pages = Math.max(1, Math.ceil(count / PAGE));
  const qs = (p: number) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === 'string' && v && k !== 'page') u.set(k, v);
    u.set('page', String(p));
    return `?${u}`;
  };

  return (
    <>
      <PageHeader
        title="لاگ ممیزی"
        subtitle={`${toFaDigits(count)} رویداد — این جدول فقط افزودنی است و در سطح دیتابیس قابل ویرایش یا حذف نیست (هر ردیف هش ردیف قبلی را دارد).`}
      />
      <Card className="mb-4">
        <form className="grid gap-3 md:grid-cols-5">
          <div className="md:col-span-2">
            <label className="label">نوع عملیات</label>
            <select name="action" defaultValue={action} className="input">
              <option value="">همه</option>
              {Object.entries(ACTION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="label">از تاریخ</label>
            <input name="from" defaultValue={one(sp.from)} dir="ltr" placeholder="1405/07/01" className="input" />
          </div>
          <div>
            <label className="label">تا تاریخ</label>
            <input name="to" defaultValue={one(sp.to)} dir="ltr" placeholder="1405/07/30" className="input" />
          </div>
          <div className="flex items-end">
            <button className="rounded-lg bg-slate-800 px-4 py-2 text-sm text-white">فیلتر</button>
          </div>
        </form>
      </Card>
      <Card bodyClass="p-0">
        {rows.length === 0 ? (
          <div className="p-4"><Empty>رویدادی یافت نشد.</Empty></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr><th>زمان</th><th>کاربر</th><th>عملیات</th><th>موضوع</th><th>جزئیات</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id.toString()}>
                    <td className="whitespace-nowrap">{formatJ(r.at)} <span className="text-xs text-muted">{r.at.toISOString().slice(11, 16)}</span></td>
                    <td>{r.userId ? userName.get(r.userId) ?? '—' : 'سیستم'}</td>
                    <td><Badge tone={r.action.includes('delete') ? 'red' : r.action.includes('post') || r.action.includes('close') ? 'green' : 'gray'}>{ACTION_LABEL[r.action] ?? r.action}</Badge></td>
                    <td className="text-xs">
                      {r.objectType === 'Voucher' && r.objectId ? (
                        <Link className="text-brand-700 hover:underline" href={`/vouchers/${r.objectId}`}>سند</Link>
                      ) : (
                        r.objectType
                      )}
                    </td>
                    <td className="max-w-lg truncate text-xs text-muted" dir="ltr">{r.data ? JSON.stringify(r.data) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm">
            <span className="text-muted">صفحهٔ {toFaDigits(page)} از {toFaDigits(pages)}</span>
            <div className="flex gap-2">
              {page > 1 && <Link className="text-brand-700" href={qs(page - 1)}>قبلی</Link>}
              {page < pages && <Link className="text-brand-700" href={qs(page + 1)}>بعدی</Link>}
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
