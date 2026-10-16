import Link from 'next/link';
import type { Prisma, TreasuryType } from '@prisma/client';
import prisma from '@/lib/prisma';
import { can } from '@/lib/auth';
import { formatJ, parseJ, toFaDigits } from '@/lib/jalali';
import { one, pageContext, type SP } from '@/lib/page';
import { METHOD_LABEL, TREASURY_TYPE_LABEL } from '@/modules/treasury/treasury';
import { bankBalances } from '@/modules/treasury/masters';
import { Badge, Card, Empty, LinkButton, Money, PageHeader, Stat } from '@/components/ui';
import { cn } from '@/lib/utils';

export const metadata = { title: 'دریافت و پرداخت' };

export default async function TreasuryPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { user, entity, fiscalYear } = await pageContext();
  if (!entity || !fiscalYear) return <Empty>ابتدا شرکت و سال مالی را تعریف کنید.</Empty>;

  const type = one(sp.type);
  const status = one(sp.status);
  const q = one(sp.q).trim();
  const from = parseJ(one(sp.from));
  const to = parseJ(one(sp.to));

  const where: Prisma.TreasuryTxnWhereInput = {
    entityId: entity.id,
    ...(type ? { type: type as TreasuryType } : {}),
    ...(status ? { status: status as 'DRAFT' | 'POSTED' } : {}),
    ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    ...(q
      ? {
          OR: [
            { description: { contains: q, mode: 'insensitive' } },
            ...(/^\d+$/.test(q) ? [{ number: Number(q) }] : []),
            { party: { dimensionValue: { name: { contains: q, mode: 'insensitive' } } } },
          ],
        }
      : {}),
  };

  const [rows, banks, draftCount] = await Promise.all([
    prisma.treasuryTxn.findMany({
      where,
      orderBy: [{ date: 'desc' }, { number: 'desc' }],
      take: 100,
      include: { party: { include: { dimensionValue: true } }, items: true, voucher: { include: { reversedBy: true } } },
    }),
    prisma.bankAccount.findMany({ where: { entityId: entity.id, active: true }, include: { dimensionValue: true }, orderBy: { dimensionValue: { code: 'asc' } } }),
    prisma.treasuryTxn.count({ where: { entityId: entity.id, status: 'DRAFT' } }),
  ]);
  const balances = await bankBalances(prisma, [entity.id]);
  const totalCash = banks.reduce((s, b) => s + (balances.get(b.dimensionValueId) ?? 0n), 0n);

  return (
    <>
      <PageHeader
        title="دریافت و پرداخت (خزانه)"
        subtitle={`${entity.name}${draftCount ? ` — ${toFaDigits(draftCount)} پیش‌نویس قطعی‌نشده` : ''}`}
        actions={
          can(user, 'voucher.edit') ? (
            <>
              <LinkButton href="/treasury/new?type=RECEIPT" variant="success">ثبت دریافت</LinkButton>
              <LinkButton href="/treasury/new?type=PAYMENT" variant="primary">ثبت پرداخت</LinkButton>
              <LinkButton href="/treasury/new?type=TRANSFER">انتقال بین حساب‌ها</LinkButton>
            </>
          ) : null
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="جمع موجودی بانک، صندوق و تنخواه" value={totalCash} />
        {banks.slice(0, 3).map((b) => (
          <Stat key={b.id} label={b.dimensionValue.name} value={balances.get(b.dimensionValueId) ?? 0n} hint={b.accountNo ?? b.bankName ?? undefined} />
        ))}
      </div>

      <Card className="mb-4">
        <form className="grid gap-3 md:grid-cols-6">
          <div className="md:col-span-2">
            <label className="label">جستجو (شماره، شرح، طرف حساب)</label>
            <input name="q" defaultValue={q} className="input" />
          </div>
          <div>
            <label className="label">نوع</label>
            <select name="type" defaultValue={type} className="input">
              <option value="">همه</option>
              {Object.entries(TREASURY_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="label">وضعیت</label>
            <select name="status" defaultValue={status} className="input">
              <option value="">همه</option>
              <option value="DRAFT">پیش‌نویس</option>
              <option value="POSTED">قطعی</option>
            </select>
          </div>
          <div>
            <label className="label">از تاریخ</label>
            <input name="from" defaultValue={one(sp.from)} dir="ltr" className="input" placeholder="1405/07/01" />
          </div>
          <div>
            <label className="label">تا تاریخ</label>
            <div className="flex gap-2">
              <input name="to" defaultValue={one(sp.to)} dir="ltr" className="input" placeholder="1405/07/30" />
              <button className="rounded-lg bg-slate-800 px-3 text-sm text-white">فیلتر</button>
            </div>
          </div>
        </form>
      </Card>

      <Card bodyClass="p-0">
        {rows.length === 0 ? (
          <div className="p-4"><Empty>سندی ثبت نشده است.</Empty></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>شماره</th>
                  <th>تاریخ</th>
                  <th>نوع</th>
                  <th>طرف حساب</th>
                  <th>روش</th>
                  <th>مبلغ (ریال)</th>
                  <th>شرح</th>
                  <th>وضعیت</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => {
                  const reversed = !!t.voucher?.reversedBy;
                  return (
                    <tr key={t.id} className={cn(reversed && 'text-slate-400')}>
                      <td><Link className="font-semibold text-brand-700 hover:underline" href={`/treasury/${t.id}`}>{toFaDigits(t.number)}</Link></td>
                      <td className="whitespace-nowrap">{formatJ(t.date)}</td>
                      <td><Badge tone={t.type === 'RECEIPT' ? 'green' : t.type === 'PAYMENT' ? 'amber' : 'blue'}>{TREASURY_TYPE_LABEL[t.type]}</Badge></td>
                      <td>{t.party?.dimensionValue.name ?? '—'}</td>
                      <td className="text-xs">{[...new Set(t.items.map((i) => METHOD_LABEL[i.method]))].join('، ')}</td>
                      <td><Money value={t.totalAmount} /></td>
                      <td className="max-w-xs truncate text-xs">{t.description}</td>
                      <td>
                        {reversed ? <Badge tone="red">برگشت‌خورده</Badge> : <Badge tone={t.status === 'POSTED' ? 'green' : 'amber'}>{t.status === 'POSTED' ? 'قطعی' : 'پیش‌نویس'}</Badge>}
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
