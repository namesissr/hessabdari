import prisma from '@/lib/prisma';
import { formatJ } from '@/lib/jalali';
import { one, pageContext, reportRange, type SP } from '@/lib/page';
import { incomeStatement, type ISResult } from '@/modules/reports/financial';
import { Card, Empty, Money, PageHeader } from '@/components/ui';
import { ReportFilters, dimGroups, dimFilterLabel } from '@/components/report-filters';
import { cn } from '@/lib/utils';

export const metadata = { title: 'صورت سود و زیان' };

function SubtotalRow({ label, values, columns, strong }: { label: string; values: Record<string, bigint>; columns: ISResult['columns']; strong?: boolean }) {
  return (
    <tr className={cn('bg-slate-50', strong && 'bg-brand-50 text-base')}>
      <td className="font-bold">{label}</td>
      {columns.map((c) => (
        <td key={c.key} className="font-bold"><Money value={values[c.key]} colored zero="۰" /></td>
      ))}
    </tr>
  );
}

export default async function IncomeStatementPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { entity, fiscalYear, entities } = await pageContext();
  if (!entity || !fiscalYear) return <Empty>ابتدا شرکت و سال مالی را تعریف کنید.</Empty>;
  const range = reportRange(sp, fiscalYear);
  const types = await prisma.dimensionType.findMany({ where: { code: { in: ['BUSINESS', 'COST_CENTER', 'PROJECT'] } }, orderBy: { sortOrder: 'asc' } });
  const byParam = one(sp.by);
  const by = byParam === 'none' ? null : types.find((t) => t.id === byParam) ?? types.find((t) => t.code === 'BUSINESS') ?? null;
  const consolidated = one(sp.scope) === 'all' && entities.length > 1;
  const groups = await dimGroups(sp);
  const filterLabel = await dimFilterLabel(sp);

  const is = await incomeStatement(prisma, {
    entityIds: consolidated ? entities.map((e) => e.id) : [entity.id],
    fiscalYearIds: consolidated ? undefined : [fiscalYear.id],
    from: range.from,
    to: range.to,
    byDimensionTypeId: by?.id,
    dimValueGroups: groups,
  });
  const sec = (k: string) => is.sections.find((s) => s.key === k)!;

  const Section = ({ k }: { k: string }) => {
    const s = sec(k);
    if (!s.rows.length) return null;
    return (
      <>
        <tr><td colSpan={is.columns.length + 1} className="pt-4 font-semibold text-slate-600">{s.label}</td></tr>
        {s.rows.map((r) => (
          <tr key={r.id + k}>
            <td className="pr-6"><span className="num ml-2 text-xs text-muted">{r.code}</span>{r.name}</td>
            {is.columns.map((c) => <td key={c.key}><Money value={r.values[c.key] ?? 0n} colored /></td>)}
          </tr>
        ))}
        {s.rows.length > 1 && (
          <tr>
            <td className="pr-6 text-sm text-muted">جمع {s.label}</td>
            {is.columns.map((c) => <td key={c.key} className="font-semibold"><Money value={s.total[c.key]} colored /></td>)}
          </tr>
        )}
      </>
    );
  };

  return (
    <>
      <PageHeader
        title="صورت سود و زیان"
        subtitle={`${consolidated ? 'کل مجموعه (جمع شرکت‌ها، بدون حذف معاملات بین‌شرکتی)' : entity.name} — از ${formatJ(range.from)} تا ${formatJ(range.to)}${filterLabel ? ` — ${filterLabel}` : ''}`}
      />
      <ReportFilters sp={sp} chartId={entity.chartId} entityId={entity.id} range={range}>
        <div>
          <label className="label">ستون‌ها به تفکیک</label>
          <select name="by" defaultValue={by?.id ?? 'none'} className="input">
            {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            <option value="none">بدون تفکیک</option>
          </select>
        </div>
        {entities.length > 1 && (
          <div>
            <label className="label">دامنه</label>
            <select name="scope" defaultValue={consolidated ? 'all' : ''} className="input">
              <option value="">شرکت فعال</option>
              <option value="all">کل مجموعه</option>
            </select>
          </div>
        )}
      </ReportFilters>
      <Card bodyClass="p-0">
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th className="min-w-64">شرح</th>
                {is.columns.map((c) => <th key={c.key} className={cn(c.key === '__total' && 'bg-slate-200')}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              <Section k="OPERATING_REVENUE" />
              <Section k="CONTRA_REVENUE" />
              <SubtotalRow label="درآمد خالص عملیاتی" values={is.totals.netRevenue} columns={is.columns} />
              <Section k="COGS" />
              <SubtotalRow label="سود ناخالص" values={is.totals.grossProfit} columns={is.columns} />
              <Section k="OPEX" />
              <SubtotalRow label="سود (زیان) عملیاتی" values={is.totals.operatingProfit} columns={is.columns} />
              <Section k="OTHER_INCOME" />
              <Section k="FINANCE" />
              <Section k="OTHER_EXPENSE" />
              <SubtotalRow label="سود (زیان) قبل از مالیات" values={is.totals.profitBeforeTax} columns={is.columns} />
              <Section k="TAX" />
              <SubtotalRow label="سود (زیان) خالص" values={is.totals.netProfit} columns={is.columns} strong />
            </tbody>
          </table>
        </div>
      </Card>
      <p className="mt-3 text-xs text-muted">
        هزینه‌های ستون «ستاد و هزینه‌های مشترک» هنوز بین کسب‌وکارها تسهیم نشده‌اند (ماژول تسهیم در فاز ۳). مبالغ به ریال؛ اعداد داخل پرانتز منفی‌اند.
      </p>
    </>
  );
}
