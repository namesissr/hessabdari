import Link from 'next/link';
import prisma from '@/lib/prisma';
import { addDays, formatJ, parseJ, todayUtc, toFaDigits } from '@/lib/jalali';
import { one, pageContext, type SP } from '@/lib/page';
import { dashboard } from '@/modules/reports/financial';
import { Badge, Card, Empty, LinkButton, Money, PageHeader, Stat, STATUS_LABEL } from '@/components/ui';
import { TrendChart } from '@/components/trend-chart';

export const metadata = { title: 'داشبورد مدیریتی' };

export default async function DashboardPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { entity, fiscalYear, entities } = await pageContext();
  if (!entity || !fiscalYear) return <Empty>ابتدا شرکت و سال مالی را در تنظیمات تعریف کنید.</Empty>;

  const scope = one(sp.scope) || (entities.length > 1 ? 'all' : 'entity');
  const entityIds = scope === 'all' ? entities.map((e) => e.id) : [entity.id];
  const today = todayUtc();
  const asOf = parseJ(one(sp.asOf)) ?? (today >= fiscalYear.startDate && today <= fiscalYear.endDate ? today : fiscalYear.endDate);
  const data = await dashboard(prisma, { entityIds, asOf });
  const recent = await prisma.voucher.findMany({
    where: { entityId: { in: entityIds } },
    orderBy: { createdAt: 'desc' },
    take: 8,
  });
  const pending = await prisma.voucher.count({ where: { entityId: { in: entityIds }, status: { not: 'POSTED' } } });
  const upcomingCheques = await prisma.cheque.findMany({
    where: {
      entityId: { in: entityIds },
      isGuarantee: false,
      OR: [
        { direction: 'ISSUED', status: { in: ['ISSUED', 'BOUNCED'] } },
        { direction: 'RECEIVED', status: { in: ['IN_HAND', 'DEPOSITED', 'BOUNCED'] } },
      ],
      dueDate: { lte: addDays(asOf, 14) },
    },
    orderBy: { dueDate: 'asc' },
    take: 8,
    include: { party: { include: { dimensionValue: true } } },
  });

  if (!data) return <Empty>برای تاریخ {formatJ(asOf)} سال مالی تعریف نشده است.</Empty>;
  const is = data.incomeStatement;
  const T = '__total';
  const bizCols = is.columns.filter((c) => c.key !== T);
  const net = is.totals.netProfit[T];

  return (
    <>
      <PageHeader
        title="داشبورد مدیریتی"
        subtitle={`${scope === 'all' ? 'کل مجموعه' : entity.name} — وضعیت در ${formatJ(asOf)} — عملکرد از ${formatJ(data.from)}`}
        actions={
          <>
            {entities.length > 1 && (
              <form className="flex gap-2">
                <select name="scope" defaultValue={scope} className="input w-auto">
                  <option value="all">کل مجموعه</option>
                  <option value="entity">{entity.name}</option>
                </select>
                <button className="rounded-lg bg-slate-800 px-3 text-sm text-white">نمایش</button>
              </form>
            )}
            <LinkButton href="/vouchers/new" variant="primary">سند جدید</LinkButton>
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="جمع دارایی‌ها" value={data.assets} />
        <Stat label="جمع بدهی‌ها" value={data.liabilities} />
        <Stat label="حقوق مالکانه" value={data.equity} />
        <Stat label="سود (زیان) خالص سال جاری" value={net} tone={net >= 0n ? 'green' : 'red'} hint={<>درآمد <Money value={is.totals.revenue[T]} zero="۰" /> — هزینه <Money value={is.totals.expense[T]} zero="۰" /></>} />
      </div>
      <div className="mb-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="موجودی بانک و صندوق" value={data.kpi.CASH} />
        <Stat label="دریافتنی‌ها (بدهکاران)" value={data.kpi.RECEIVABLE} />
        <Stat label="پرداختنی‌ها (بستانکاران)" value={data.kpi.PAYABLE} />
        <Stat label="تسهیلات و وام‌ها" value={data.kpi.LOAN} />
        <Stat label="سرمایه‌گذاری‌ها" value={data.kpi.INVESTMENT} />
        <Stat label="پیش‌دریافت و کیف پول کاربران" value={data.kpi.DEFERRED_REVENUE} />
      </div>

      <div className="mb-6 grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Card title="روند ماهانهٔ درآمد و هزینه">
          <TrendChart data={data.trend.map((t) => ({ title: t.title, revenue: t.revenue.toString(), expense: t.expense.toString() }))} />
        </Card>
        <Card title="موجودی نقد به تفکیک حساب" bodyClass="p-0">
          {data.cashList.length === 0 ? (
            <div className="p-4 text-sm text-muted">موجودی نقدی ثبت نشده است.</div>
          ) : (
            <table className="table">
              <tbody>
                {data.cashList.map((c) => (
                  <tr key={c.id}>
                    <td><Link className="hover:underline" href={`/reports/ledger?account=${c.id}`}>{c.code} — {c.name}</Link></td>
                    <td><Money value={c.amount} colored /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <Card title="عملکرد به تفکیک کسب‌وکار (سال جاری)" className="mb-6" bodyClass="p-0">
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>کسب‌وکار</th>
                <th>درآمد خالص عملیاتی</th>
                <th>بهای تمام‌شده</th>
                <th>سود ناخالص</th>
                <th>هزینه‌های عملیاتی</th>
                <th>سود خالص</th>
                <th>حاشیهٔ سود</th>
              </tr>
            </thead>
            <tbody>
              {bizCols.map((c) => {
                const rev = is.totals.netRevenue[c.key];
                const np = is.totals.netProfit[c.key];
                const margin = rev > 0n ? Number((np * 1000n) / rev) / 10 : null;
                return (
                  <tr key={c.key}>
                    <td className="font-medium">{c.label}</td>
                    <td><Money value={rev} colored /></td>
                    <td><Money value={is.sections.find((s) => s.key === 'COGS')!.total[c.key]} /></td>
                    <td><Money value={is.totals.grossProfit[c.key]} colored /></td>
                    <td><Money value={is.sections.find((s) => s.key === 'OPEX')!.total[c.key]} /></td>
                    <td className="font-semibold"><Money value={np} colored /></td>
                    <td>{margin === null ? '—' : <Badge tone={margin >= 0 ? 'green' : 'red'}>{toFaDigits(margin.toFixed(1))}٪</Badge>}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td>جمع</td>
                <td><Money value={is.totals.netRevenue[T]} colored /></td>
                <td><Money value={is.sections.find((s) => s.key === 'COGS')!.total[T]} /></td>
                <td><Money value={is.totals.grossProfit[T]} colored /></td>
                <td><Money value={is.sections.find((s) => s.key === 'OPEX')!.total[T]} /></td>
                <td><Money value={net} colored /></td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="border-t border-line px-4 py-2 text-xs text-muted">
          <Link className="text-brand-700" href="/reports/income-statement">صورت سود و زیان کامل ←</Link>
        </div>
      </Card>

      <Card title="چک‌های سررسید نزدیک و معوق" className="mb-6" bodyClass="p-0">
        {upcomingCheques.length === 0 ? (
          <div className="p-4 text-sm text-muted">چکی در دو هفتهٔ آینده سررسید ندارد.</div>
        ) : (
          <table className="table">
            <tbody>
              {upcomingCheques.map((c) => (
                <tr key={c.id} className={c.dueDate < asOf ? 'bg-red-50' : undefined}>
                  <td className="whitespace-nowrap">{formatJ(c.dueDate)}{c.dueDate < asOf && <span className="mr-2 text-xs text-red-600">معوق</span>}</td>
                  <td><Badge tone={c.direction === 'ISSUED' ? 'amber' : 'green'}>{c.direction === 'ISSUED' ? 'پرداختی' : 'دریافتی'}</Badge></td>
                  <td><Link className="text-brand-700 hover:underline" href={`/cheques/${c.id}`}>چک {c.serialNo}</Link></td>
                  <td className="text-xs">{c.party?.dimensionValue.name ?? c.counterpartyName ?? '—'}</td>
                  <td><Money value={c.amount} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="border-t border-line px-4 py-2 text-xs">
          <Link className="text-brand-700" href="/cheques">مدیریت چک‌ها ←</Link>
        </div>
      </Card>

      <Card title={`آخرین اسناد${pending ? ` — ${toFaDigits(pending)} سند منتظر قطعی شدن` : ''}`} bodyClass="p-0">
        {recent.length === 0 ? (
          <div className="p-4 text-sm text-muted">هنوز سندی ثبت نشده است.</div>
        ) : (
          <table className="table">
            <tbody>
              {recent.map((v) => (
                <tr key={v.id}>
                  <td className="whitespace-nowrap">{formatJ(v.date)}</td>
                  <td><Link className="text-brand-700" href={`/vouchers/${v.id}`}>{v.number ? `سند ${toFaDigits(v.number)}` : `یادداشت ${toFaDigits(v.draftNo)}`}</Link></td>
                  <td className="max-w-md truncate">{v.description}</td>
                  <td><Money value={v.totalAmount} /></td>
                  <td><Badge tone={STATUS_LABEL[v.status].tone}>{STATUS_LABEL[v.status].label}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
