import Link from 'next/link';
import prisma from '@/lib/prisma';
import { formatJ, parseJ, toFaDigits, todayUtc } from '@/lib/jalali';
import { one, pageContext, type SP } from '@/lib/page';
import { AGING_LABELS, agingReport, type AgingBucket } from '@/modules/sales/invoices';
import { Card, Empty, Money, PageHeader, Stat } from '@/components/ui';
import { ReportFilters } from '@/components/report-filters';
import { cn } from '@/lib/utils';

export const metadata = { title: 'گزارش سنی' };

const BUCKETS: AgingBucket[] = ['current', 'd30', 'd60', 'd90', 'older'];

export default async function AgingPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { entity } = await pageContext();
  if (!entity) return <Empty>ابتدا شرکت را تعریف کنید.</Empty>;
  const side = one(sp.side) === 'PAYABLE' ? 'PAYABLE' : 'RECEIVABLE';
  const asOf = parseJ(one(sp.asOf)) ?? todayUtc();
  const businessDimId = one(sp.business) || null;
  const businesses = await prisma.dimensionValue.findMany({ where: { type: { code: 'BUSINESS' }, active: true }, orderBy: { code: 'asc' } });
  const rows = await agingReport(prisma, { entityIds: [entity.id], side, asOf, businessDimId });

  const totals = BUCKETS.reduce((acc, b) => ({ ...acc, [b]: rows.reduce((s, r) => s + r.buckets[b], 0n) }), {} as Record<AgingBucket, bigint>);
  const grand = rows.reduce((s, r) => s + r.total, 0n);
  const overdue = BUCKETS.filter((b) => b !== 'current').reduce((s, b) => s + totals[b], 0n);

  return (
    <>
      <PageHeader
        title={side === 'RECEIVABLE' ? 'گزارش سنی بدهکاران (مطالبات)' : 'گزارش سنی بستانکاران (بدهی‌ها)'}
        subtitle={`${entity.name} — در تاریخ ${formatJ(asOf)} — بر اساس فاکتورهای قطعی تسویه‌نشده`}
      />
      <ReportFilters sp={sp} chartId={entity.chartId} entityId={entity.id} asOf={formatJ(asOf, false)} dims={false}>
        <div>
          <label className="label">نوع گزارش</label>
          <select name="side" defaultValue={side} className="input">
            <option value="RECEIVABLE">مطالبات از مشتریان</option>
            <option value="PAYABLE">بدهی به تأمین‌کنندگان</option>
          </select>
        </div>
        <div>
          <label className="label">کسب‌وکار</label>
          <select name="business" defaultValue={businessDimId ?? ''} className="input">
            <option value="">همه</option>
            {businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
      </ReportFilters>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat label="جمع کل" value={grand} />
        <Stat label="سررسید گذشته" value={overdue} tone={overdue > 0n ? 'red' : undefined} />
        <Stat label="سررسید نشده" value={totals.current} tone="green" />
      </div>

      <Card bodyClass="p-0">
        {rows.length === 0 ? (
          <div className="p-4"><Empty>فاکتور تسویه‌نشده‌ای وجود ندارد.</Empty></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>طرف حساب</th>
                  {BUCKETS.map((b) => <th key={b}>{AGING_LABELS[b]}</th>)}
                  <th>جمع</th>
                  <th>تعداد فاکتور</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.partyId}>
                    <td>
                      <Link className="hover:text-brand-700 hover:underline" href={`/invoices?type=${side === 'RECEIVABLE' ? 'SALES' : 'PURCHASE'}&q=${encodeURIComponent(r.partyName)}`}>
                        {r.partyName}
                      </Link>
                    </td>
                    {BUCKETS.map((b) => (
                      <td key={b} className={cn(b !== 'current' && r.buckets[b] > 0n && 'text-red-700')}>
                        <Money value={r.buckets[b]} />
                      </td>
                    ))}
                    <td className="font-semibold"><Money value={r.total} /></td>
                    <td className="text-xs text-muted">{toFaDigits(r.invoices.length)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>جمع کل</td>
                  {BUCKETS.map((b) => <td key={b}><Money value={totals[b]} /></td>)}
                  <td><Money value={grand} /></td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
      <p className="mt-3 text-xs text-muted">ستون‌ها بر اساس روزهای گذشته از سررسید فاکتور محاسبه می‌شوند. فاکتورهای بدون سررسید در ستون «سررسید نشده» قرار می‌گیرند.</p>
    </>
  );
}
