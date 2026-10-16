import prisma from '@/lib/prisma';
import { formatJ } from '@/lib/jalali';
import { one, pageContext, reportRange, type SP } from '@/lib/page';
import { ledgerBook } from '@/modules/reports/books';
import { Empty, PageHeader } from '@/components/ui';
import { LedgerBook } from '@/components/ledger-book';
import { ReportFilters, dimGroups, dimFilterLabel } from '@/components/report-filters';

export const metadata = { title: 'دفتر کل' };

export default async function GeneralLedgerPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { entity, fiscalYear } = await pageContext();
  if (!entity || !fiscalYear) return <Empty>ابتدا شرکت و سال مالی را تعریف کنید.</Empty>;
  const range = reportRange(sp, fiscalYear);
  const mode = one(sp.mode) === 'voucher' ? 'voucher' : 'period';
  const accountId = one(sp.account) || null;
  const groups = await dimGroups(sp);
  const filterLabel = await dimFilterLabel(sp);
  const accounts = await ledgerBook(prisma, {
    entityIds: [entity.id],
    fiscalYearIds: [fiscalYear.id],
    from: range.from,
    to: range.to,
    level: 'GL',
    accountId,
    mode,
    dimValueGroups: groups,
    includeClosing: one(sp.closing) === '1',
  });

  return (
    <>
      <PageHeader
        title="دفتر کل"
        subtitle={`${entity.name} — سال مالی ${fiscalYear.title} — از ${formatJ(range.from)} تا ${formatJ(range.to)}${filterLabel ? ` — ${filterLabel}` : ''}`}
      />
      <ReportFilters sp={sp} chartId={entity.chartId} entityId={entity.id} range={range} account closing>
        <div>
          <label className="label">نمایش ردیف‌ها</label>
          <select name="mode" defaultValue={mode} className="input">
            <option value="period">خلاصهٔ ماهانه (دفتر قانونی)</option>
            <option value="voucher">سند به سند</option>
          </select>
        </div>
      </ReportFilters>
      <LedgerBook accounts={accounts} mode={mode} title="دفتر کل" />
    </>
  );
}
