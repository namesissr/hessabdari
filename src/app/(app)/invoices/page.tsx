import Link from 'next/link';
import type { InvoiceType, Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { can } from '@/lib/auth';
import { formatJ, parseJ, toFaDigits, todayUtc } from '@/lib/jalali';
import { one, pageContext, type SP } from '@/lib/page';
import { INVOICE_TYPE_LABEL } from '@/modules/sales/invoices';
import { Badge, Card, Empty, LinkButton, Money, PageHeader, Stat } from '@/components/ui';
import { cn } from '@/lib/utils';

export const metadata = { title: 'فاکتورها' };

export default async function InvoicesPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { user, entity } = await pageContext();
  if (!entity) return <Empty>ابتدا شرکت را تعریف کنید.</Empty>;

  const type = (one(sp.type) || 'SALES') as InvoiceType;
  const status = one(sp.status);
  const q = one(sp.q).trim();
  const from = parseJ(one(sp.from));
  const to = parseJ(one(sp.to));
  const today = todayUtc();

  const where: Prisma.InvoiceWhereInput = {
    entityId: entity.id,
    type,
    ...(status ? { status: status as never } : {}),
    ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    ...(q
      ? {
          OR: [
            ...(/^\d+$/.test(q) ? [{ number: Number(q) }] : []),
            { reference: { contains: q, mode: 'insensitive' as const } },
            { description: { contains: q, mode: 'insensitive' as const } },
            { party: { dimensionValue: { name: { contains: q, mode: 'insensitive' as const } } } },
          ],
        }
      : {}),
  };

  const [rows, openAgg, overdueAgg] = await Promise.all([
    prisma.invoice.findMany({ where, orderBy: [{ date: 'desc' }, { number: 'desc' }], take: 100, include: { party: { include: { dimensionValue: true } } } }),
    prisma.invoice.aggregate({ where: { entityId: entity.id, type, status: 'POSTED' }, _sum: { total: true, settledAmount: true }, _count: true }),
    prisma.invoice.count({ where: { entityId: entity.id, type, status: 'POSTED', dueDate: { lt: today } } }),
  ]);
  const openAmount = (openAgg._sum.total ?? 0n) - (openAgg._sum.settledAmount ?? 0n);
  const isSales = type === 'SALES' || type === 'SALES_RETURN';

  const tabs: { key: InvoiceType; label: string }[] = [
    { key: 'SALES', label: 'فروش' },
    { key: 'PURCHASE', label: 'خرید' },
    { key: 'SALES_RETURN', label: 'برگشت از فروش' },
    { key: 'PURCHASE_RETURN', label: 'برگشت از خرید' },
  ];

  return (
    <>
      <PageHeader
        title="فاکتورها"
        subtitle={`${entity.name} — ${INVOICE_TYPE_LABEL[type]}`}
        actions={
          can(user, 'voucher.edit') ? (
            <>
              <LinkButton href={`/invoices/new?type=${type}`} variant="primary">فاکتور جدید</LinkButton>
              <LinkButton href={`/reports/aging?side=${isSales ? 'RECEIVABLE' : 'PAYABLE'}`}>گزارش سنی</LinkButton>
            </>
          ) : null
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat label={isSales ? 'مطالبات تسویه‌نشده' : 'بدهی تسویه‌نشده'} value={openAmount} hint={`${toFaDigits(openAgg._count)} فاکتور قطعی`} />
        <Stat label="جمع فاکتورهای قطعی" value={openAgg._sum.total ?? 0n} />
        <Stat label="فاکتورهای سررسید گذشته" value={BigInt(overdueAgg)} hint="تعداد" tone={overdueAgg ? 'red' : undefined} />
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {tabs.map((t) => (
          <Link key={t.key} href={`?type=${t.key}`} className={cn('rounded-lg border px-3 py-1.5 text-sm', type === t.key ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-white hover:bg-slate-50')}>
            {t.label}
          </Link>
        ))}
      </div>

      <Card className="mb-4">
        <form className="grid gap-3 md:grid-cols-5">
          <input type="hidden" name="type" value={type} />
          <div className="md:col-span-2">
            <label className="label">جستجو (شماره، ارجاع، طرف حساب)</label>
            <input name="q" defaultValue={q} className="input" />
          </div>
          <div>
            <label className="label">وضعیت</label>
            <select name="status" defaultValue={status} className="input">
              <option value="">همه</option>
              <option value="DRAFT">پیش‌نویس</option>
              <option value="POSTED">قطعی</option>
              <option value="CANCELLED">ابطال‌شده</option>
            </select>
          </div>
          <div>
            <label className="label">از تاریخ</label>
            <input name="from" defaultValue={one(sp.from)} dir="ltr" className="input" placeholder="1405/01/01" />
          </div>
          <div>
            <label className="label">تا تاریخ</label>
            <div className="flex gap-2">
              <input name="to" defaultValue={one(sp.to)} dir="ltr" className="input" />
              <button className="rounded-lg bg-slate-800 px-3 text-sm text-white">فیلتر</button>
            </div>
          </div>
        </form>
      </Card>

      <Card bodyClass="p-0">
        {rows.length === 0 ? (
          <div className="p-4"><Empty>فاکتوری ثبت نشده است.</Empty></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>شماره</th>
                  <th>تاریخ</th>
                  <th>سررسید</th>
                  <th>طرف حساب</th>
                  <th>مبلغ کل</th>
                  <th>مالیات</th>
                  <th>تسویه‌شده</th>
                  <th>مانده</th>
                  <th>وضعیت</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((inv) => {
                  const remaining = inv.total - inv.settledAmount;
                  const overdue = inv.status === 'POSTED' && remaining > 0n && inv.dueDate && inv.dueDate < today;
                  return (
                    <tr key={inv.id} className={cn(overdue && 'bg-red-50', inv.status === 'CANCELLED' && 'text-slate-400 line-through')}>
                      <td><Link className="font-semibold text-brand-700 hover:underline" href={`/invoices/${inv.id}`}>{toFaDigits(inv.number)}</Link></td>
                      <td className="whitespace-nowrap">{formatJ(inv.date)}</td>
                      <td className="whitespace-nowrap">{inv.dueDate ? formatJ(inv.dueDate) : '—'}{overdue && <div className="text-[11px] text-red-600">سررسید گذشته</div>}</td>
                      <td>{inv.party.dimensionValue.name}</td>
                      <td><Money value={inv.total} /></td>
                      <td className="text-xs"><Money value={inv.taxAmount} /></td>
                      <td><Money value={inv.settledAmount} /></td>
                      <td className="font-semibold"><Money value={remaining} /></td>
                      <td><Badge tone={inv.status === 'POSTED' ? (remaining === 0n ? 'green' : 'blue') : inv.status === 'DRAFT' ? 'amber' : 'gray'}>
                        {inv.status === 'POSTED' ? (remaining === 0n ? 'تسویه‌شده' : 'قطعی') : inv.status === 'DRAFT' ? 'پیش‌نویس' : 'ابطال'}
                      </Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
