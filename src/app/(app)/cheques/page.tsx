import Link from 'next/link';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { can } from '@/lib/auth';
import { addDays, formatJ, parseJ, toFaDigits, todayUtc } from '@/lib/jalali';
import { one, pageContext, type SP } from '@/lib/page';
import { CHEQUE_STATUS_LABEL } from '@/modules/treasury/cheques';
import { Badge, Card, Empty, LinkButton, Money, PageHeader, Stat } from '@/components/ui';
import { cn } from '@/lib/utils';

export const metadata = { title: 'چک‌ها' };

const STATUS_TONE: Record<string, 'gray' | 'blue' | 'green' | 'amber' | 'red' | 'violet'> = {
  IN_HAND: 'blue',
  DEPOSITED: 'violet',
  CLEARED: 'green',
  ENDORSED: 'gray',
  ISSUED: 'blue',
  PAID: 'green',
  BOUNCED: 'red',
  RETURNED: 'gray',
  CANCELLED: 'gray',
};

const OPEN_RECEIVED = ['IN_HAND', 'DEPOSITED', 'BOUNCED'];
const OPEN_ISSUED = ['ISSUED', 'BOUNCED'];

export default async function ChequesPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { user, entity } = await pageContext();
  if (!entity) return <Empty>ابتدا شرکت را تعریف کنید.</Empty>;

  const direction = one(sp.direction) || 'ISSUED';
  const status = one(sp.status);
  const q = one(sp.q).trim();
  const from = parseJ(one(sp.from));
  const to = parseJ(one(sp.to));
  const today = todayUtc();

  const where: Prisma.ChequeWhereInput = {
    entityId: entity.id,
    direction: direction as 'ISSUED' | 'RECEIVED',
    ...(status ? { status: status as never } : {}),
    ...(from || to ? { dueDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    ...(q
      ? {
          OR: [
            { serialNo: { contains: q } },
            { sayadId: { contains: q } },
            { counterpartyName: { contains: q, mode: 'insensitive' } },
            { description: { contains: q, mode: 'insensitive' } },
            { party: { dimensionValue: { name: { contains: q, mode: 'insensitive' } } } },
          ],
        }
      : {}),
  };

  const [rows, openSoon, overdue, openTotals] = await Promise.all([
    prisma.cheque.findMany({
      where,
      orderBy: [{ dueDate: 'asc' }],
      take: 200,
      include: { party: { include: { dimensionValue: true } }, bankAccount: { include: { dimensionValue: true } } },
    }),
    prisma.cheque.count({
      where: { entityId: entity.id, direction: direction as never, status: { in: (direction === 'ISSUED' ? OPEN_ISSUED : OPEN_RECEIVED) as never }, dueDate: { gte: today, lte: addDays(today, 7) } },
    }),
    prisma.cheque.count({
      where: { entityId: entity.id, direction: direction as never, status: { in: (direction === 'ISSUED' ? OPEN_ISSUED : OPEN_RECEIVED) as never }, dueDate: { lt: today } },
    }),
    prisma.cheque.aggregate({
      where: { entityId: entity.id, direction: direction as never, status: { in: (direction === 'ISSUED' ? OPEN_ISSUED : OPEN_RECEIVED) as never }, isGuarantee: false },
      _sum: { amount: true },
      _count: true,
    }),
  ]);

  const tabs = [
    { key: 'ISSUED', label: 'چک‌های پرداختی (ما صادر کرده‌ایم)' },
    { key: 'RECEIVED', label: 'چک‌های دریافتی' },
  ];

  return (
    <>
      <PageHeader
        title="چک‌ها"
        subtitle={`${entity.name} — ${toFaDigits(openTotals._count)} چک باز`}
        actions={
          can(user, 'voucher.edit') ? (
            <>
              <LinkButton href={`/cheques/new?direction=${direction}`} variant="primary">ثبت چک جدید</LinkButton>
              <LinkButton href="/settings/cheque-layouts">قالب چاپ چک</LinkButton>
            </>
          ) : null
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat label={direction === 'ISSUED' ? 'جمع چک‌های پرداختی باز' : 'جمع چک‌های دریافتی باز'} value={openTotals._sum.amount ?? 0n} />
        <Stat label="سررسید تا ۷ روز آینده" value={BigInt(openSoon)} hint="تعداد" />
        <Stat label="سررسید گذشته و تعیین‌تکلیف‌نشده" value={BigInt(overdue)} hint="تعداد" tone={overdue ? 'red' : undefined} />
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {tabs.map((t) => (
          <Link key={t.key} href={`?direction=${t.key}`} className={cn('rounded-lg border px-3 py-1.5 text-sm', direction === t.key ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-white hover:bg-slate-50')}>
            {t.label}
          </Link>
        ))}
      </div>

      <Card className="mb-4">
        <form className="grid gap-3 md:grid-cols-5">
          <input type="hidden" name="direction" value={direction} />
          <div className="md:col-span-2">
            <label className="label">جستجو (سریال، صیاد، طرف حساب، بابت)</label>
            <input name="q" defaultValue={q} className="input" />
          </div>
          <div>
            <label className="label">وضعیت</label>
            <select name="status" defaultValue={status} className="input">
              <option value="">همه</option>
              {(direction === 'ISSUED' ? ['ISSUED', 'PAID', 'BOUNCED', 'RETURNED', 'CANCELLED'] : ['IN_HAND', 'DEPOSITED', 'CLEARED', 'ENDORSED', 'BOUNCED', 'RETURNED', 'CANCELLED']).map((s) => (
                <option key={s} value={s}>{CHEQUE_STATUS_LABEL[s as keyof typeof CHEQUE_STATUS_LABEL]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">سررسید از</label>
            <input name="from" defaultValue={one(sp.from)} dir="ltr" placeholder="1405/07/01" className="input" />
          </div>
          <div>
            <label className="label">سررسید تا</label>
            <div className="flex gap-2">
              <input name="to" defaultValue={one(sp.to)} dir="ltr" placeholder="1405/12/29" className="input" />
              <button className="rounded-lg bg-slate-800 px-3 text-sm text-white">فیلتر</button>
            </div>
          </div>
        </form>
      </Card>

      <Card bodyClass="p-0">
        {rows.length === 0 ? (
          <div className="p-4"><Empty>چکی یافت نشد.</Empty></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>سررسید</th>
                  <th>سریال</th>
                  <th>طرف حساب</th>
                  <th>بانک</th>
                  <th>مبلغ (ریال)</th>
                  <th>بابت</th>
                  <th>وضعیت</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const open = (c.direction === 'ISSUED' ? OPEN_ISSUED : OPEN_RECEIVED).includes(c.status);
                  const late = open && c.dueDate < today;
                  return (
                    <tr key={c.id} className={cn(late && 'bg-red-50')}>
                      <td className="whitespace-nowrap">
                        {formatJ(c.dueDate)}
                        {late && <div className="text-[11px] text-red-600">سررسید گذشته</div>}
                      </td>
                      <td className="num">
                        <Link className="text-brand-700 hover:underline" href={`/cheques/${c.id}`}>{c.serialNo}</Link>
                        {c.isGuarantee && <Badge tone="violet">تضمینی</Badge>}
                      </td>
                      <td>{c.party?.dimensionValue.name ?? c.counterpartyName ?? '—'}</td>
                      <td className="text-xs">{c.bankAccount?.dimensionValue.name ?? c.bankName ?? '—'}</td>
                      <td><Money value={c.amount} /></td>
                      <td className="max-w-xs truncate text-xs">{c.description}</td>
                      <td><Badge tone={STATUS_TONE[c.status]}>{CHEQUE_STATUS_LABEL[c.status]}</Badge></td>
                      <td className="whitespace-nowrap text-xs">
                        {c.direction === 'ISSUED' && <Link className="text-brand-700 hover:underline" href={`/print/cheque/${c.id}`}>چاپ</Link>}
                      </td>
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
