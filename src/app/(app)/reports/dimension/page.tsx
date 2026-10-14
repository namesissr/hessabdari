import Link from 'next/link';
import prisma from '@/lib/prisma';
import { formatJ } from '@/lib/jalali';
import { one, pageContext, reportRange, type SP } from '@/lib/page';
import { dimensionReport } from '@/modules/reports/financial';
import { Card, Empty, Money, PageHeader } from '@/components/ui';
import { ReportFilters } from '@/components/report-filters';

export const metadata = { title: 'گزارش تفصیلی' };

export default async function DimensionReportPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { entity, fiscalYear } = await pageContext();
  if (!entity || !fiscalYear) return <Empty>ابتدا شرکت و سال مالی را تعریف کنید.</Empty>;
  const range = reportRange(sp, fiscalYear);
  const types = await prisma.dimensionType.findMany({ orderBy: { sortOrder: 'asc' } });
  const typeId = one(sp.type) || types.find((t) => t.code === 'PARTY')?.id || types[0]?.id;
  const accountId = one(sp.account) || null;
  const account = accountId ? await prisma.account.findUnique({ where: { id: accountId } }) : null;
  const type = types.find((t) => t.id === typeId);
  const rows = typeId
    ? await dimensionReport(prisma, { entityIds: [entity.id], fiscalYearIds: [fiscalYear.id], dimensionTypeId: typeId, accountId, from: range.from, to: range.to, includeClosing: one(sp.closing) === '1' })
    : [];
  let o = 0n, d = 0n, c = 0n;
  rows.forEach((r) => { o += r.opening; d += r.debit; c += r.credit; });

  return (
    <>
      <PageHeader
        title={`گزارش مانده به تفکیک ${type?.name ?? ''}`}
        subtitle={`${entity.name} — ${account ? `حساب ${account.code} ${account.name}` : 'همهٔ حساب‌ها'} — از ${formatJ(range.from)} تا ${formatJ(range.to)}`}
      />
      <ReportFilters sp={sp} chartId={entity.chartId} entityId={entity.id} range={range} account dims={false} closing>
        <div>
          <label className="label">نوع تفصیلی / مرکز</label>
          <select name="type" defaultValue={typeId} className="input">
            {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      </ReportFilters>
      {!account && <p className="mb-3 text-xs text-muted">راهنما: برای «بدهکاران» حساب ۱۳ و نوع «طرف حساب»؛ برای «بستانکاران» حساب ۳۱؛ برای «هزینه به تفکیک مرکز هزینه» حساب ۸ و نوع «مرکز هزینه» را انتخاب کنید.</p>}
      <Card bodyClass="p-0">
        {rows.length === 0 ? (
          <div className="p-4"><Empty>گردشی یافت نشد.</Empty></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>کد</th>
                  <th>{type?.name}</th>
                  <th>ماندهٔ ابتدا</th>
                  <th>گردش بدهکار</th>
                  <th>گردش بستانکار</th>
                  <th>ماندهٔ بدهکار</th>
                  <th>ماندهٔ بستانکار</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.valueId ?? 'none'}>
                    <td className="num">{r.code}</td>
                    <td>
                      {r.valueId ? (
                        <Link className="hover:text-brand-700 hover:underline" href={`/reports/ledger?dim=${r.valueId}${accountId ? `&account=${accountId}` : ''}&from=${range.fromStr}&to=${range.toStr}`}>{r.name}</Link>
                      ) : (
                        <span className="text-muted">{r.name}</span>
                      )}
                    </td>
                    <td><Money value={r.opening} colored /></td>
                    <td><Money value={r.debit} /></td>
                    <td><Money value={r.credit} /></td>
                    <td><Money value={r.balance > 0n ? r.balance : 0n} /></td>
                    <td><Money value={r.balance < 0n ? -r.balance : 0n} /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}>جمع</td>
                  <td><Money value={o} colored /></td>
                  <td><Money value={d} /></td>
                  <td><Money value={c} /></td>
                  <td><Money value={o + d - c > 0n ? o + d - c : 0n} /></td>
                  <td><Money value={o + d - c < 0n ? -(o + d - c) : 0n} /></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
