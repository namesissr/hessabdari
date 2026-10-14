import Link from 'next/link';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { can } from '@/lib/auth';
import { formatJ, parseJ, toFaDigits, toLatinDigits } from '@/lib/jalali';
import { one, pageContext, type SP } from '@/lib/page';
import { Badge, Card, Empty, LinkButton, Money, PageHeader, STATUS_LABEL, TYPE_LABEL } from '@/components/ui';

export const metadata = { title: 'اسناد حسابداری' };

const PAGE = 50;

export default async function VouchersPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { user, entity, fiscalYear } = await pageContext();
  if (!entity || !fiscalYear) return <Empty>ابتدا شرکت و سال مالی را تعریف کنید.</Empty>;

  const status = one(sp.status);
  const type = one(sp.type);
  const q = toLatinDigits(one(sp.q));
  const from = parseJ(one(sp.from));
  const to = parseJ(one(sp.to));
  const page = Math.max(1, Number(one(sp.page)) || 1);

  const where: Prisma.VoucherWhereInput = {
    entityId: entity.id,
    fiscalYearId: fiscalYear.id,
    ...(status ? { status: status as never } : {}),
    ...(type ? { type: type as never } : {}),
    ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    ...(q
      ? /^\d+$/.test(q)
        ? { OR: [{ number: Number(q) }, { draftNo: Number(q) }] }
        : { OR: [{ description: { contains: q, mode: 'insensitive' } }, { lines: { some: { description: { contains: q, mode: 'insensitive' } } } }] }
      : {}),
  };
  const [rows, count, pendingCount] = await Promise.all([
    prisma.voucher.findMany({
      where,
      orderBy: [{ date: 'desc' }, { number: 'desc' }, { draftNo: 'desc' }],
      skip: (page - 1) * PAGE,
      take: PAGE,
      include: { createdBy: { select: { name: true } } },
    }),
    prisma.voucher.count({ where }),
    prisma.voucher.count({ where: { entityId: entity.id, fiscalYearId: fiscalYear.id, status: { not: 'POSTED' } } }),
  ]);
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
        title="اسناد حسابداری"
        subtitle={`${entity.name} — سال مالی ${fiscalYear.title}${pendingCount ? ` — ${toFaDigits(pendingCount)} سند قطعی‌نشده` : ''}`}
        actions={can(user, 'voucher.edit') && fiscalYear.status === 'OPEN' ? <LinkButton href="/vouchers/new" variant="primary">سند جدید</LinkButton> : null}
      />
      <Card className="mb-4">
        <form className="grid gap-3 md:grid-cols-6">
          <div className="md:col-span-2">
            <label className="label">جستجو (شماره یا شرح)</label>
            <input name="q" defaultValue={one(sp.q)} className="input" />
          </div>
          <div>
            <label className="label">وضعیت</label>
            <select name="status" defaultValue={status} className="input">
              <option value="">همه</option>
              {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">نوع</label>
            <select name="type" defaultValue={type} className="input">
              <option value="">همه</option>
              {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="label">از تاریخ</label>
            <input name="from" defaultValue={one(sp.from)} dir="ltr" placeholder="1405/01/01" className="input" />
          </div>
          <div>
            <label className="label">تا تاریخ</label>
            <div className="flex gap-2">
              <input name="to" defaultValue={one(sp.to)} dir="ltr" placeholder="1405/12/29" className="input" />
              <button className="rounded-lg bg-slate-800 px-3 text-sm text-white">فیلتر</button>
            </div>
          </div>
        </form>
      </Card>
      <Card bodyClass="p-0">
        {rows.length === 0 ? (
          <div className="p-4"><Empty>سندی یافت نشد.</Empty></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>شمارهٔ قطعی</th>
                  <th>شمارهٔ موقت</th>
                  <th>تاریخ</th>
                  <th>نوع</th>
                  <th>شرح</th>
                  <th>مبلغ (ریال)</th>
                  <th>وضعیت</th>
                  <th>ثبت‌کننده</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((v) => (
                  <tr key={v.id}>
                    <td>
                      <Link className="font-semibold text-brand-700 hover:underline" href={`/vouchers/${v.id}`}>
                        {v.number ? toFaDigits(v.number) : '—'}
                      </Link>
                    </td>
                    <td className="text-muted">
                      <Link href={`/vouchers/${v.id}`}>{toFaDigits(v.draftNo)}</Link>
                    </td>
                    <td className="whitespace-nowrap">{formatJ(v.date)}</td>
                    <td><Badge tone={v.type === 'NORMAL' ? 'gray' : 'violet'}>{TYPE_LABEL[v.type]}</Badge></td>
                    <td className="max-w-md truncate">{v.description}{v.sourceModule && <span className="mr-2 text-xs text-muted">({v.sourceModule})</span>}</td>
                    <td><Money value={v.totalAmount} /></td>
                    <td><Badge tone={STATUS_LABEL[v.status].tone}>{STATUS_LABEL[v.status].label}</Badge></td>
                    <td className="text-xs text-muted">{v.createdBy.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm">
            <span className="text-muted">{toFaDigits(count)} سند — صفحهٔ {toFaDigits(page)} از {toFaDigits(pages)}</span>
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
