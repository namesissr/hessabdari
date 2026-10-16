import prisma from '@/lib/prisma';
import { formatJ } from '@/lib/jalali';
import { one, pageContext, reportRange, type SP } from '@/lib/page';
import { ledgerBook } from '@/modules/reports/books';
import { Empty, PageHeader } from '@/components/ui';
import { LedgerBook } from '@/components/ledger-book';
import { ReportFilters, dimGroups, dimFilterLabel } from '@/components/report-filters';

export const metadata = { title: 'دفتر معین' };

export default async function SubsidiaryLedgerPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { entity, fiscalYear } = await pageContext();
  if (!entity || !fiscalYear) return <Empty>ابتدا شرکت و سال مالی را تعریف کنید.</Empty>;
  const range = reportRange(sp, fiscalYear);
  const mode = one(sp.mode) === 'period' ? 'period' : 'voucher';
  const accountId = one(sp.account) || null;
  const groups = await dimGroups(sp);
  const filterLabel = await dimFilterLabel(sp);
  const accounts = await ledgerBook(prisma, {
    entityIds: [entity.id],
    fiscalYearIds: [fiscalYear.id],
    from: range.from,
    to: range.to,
    level: 'SUBSIDIARY',
    accountId,
    mode,
    dimValueGroups: groups,
    includeClosing: one(sp.closing) === '1',
  });

  return (
    <>
      <PageHeader
        title="دفتر معین"
        subtitle={`${entity.name} — سال مالی ${fiscalYear.title} — از ${formatJ(range.from)} تا ${formatJ(range.to)}${filterLabel ? ` — ${filterLabel}` : ''}`}
      />
      <ReportFilters sp={sp} chartId={entity.chartId} entityId={entity.id} range={range} account closing>
        <div>
          <label className="label">نمایش ردیف‌ها</label>
          <select name="mode" defaultValue={mode} className="input">
            <option value="voucher">سند به سند</option>
            <option value="period">خلاصهٔ ماهانه</option>
          </select>
        </div>
      </ReportFilters>
      <p className="mb-3 text-xs text-muted">برای دیدن دفتر معین یک حساب کل خاص، آن حساب کل را در فیلتر «حساب» انتخاب کنید؛ همهٔ معین‌های زیرش نمایش داده می‌شوند.</p>
      <LedgerBook accounts={accounts} mode={mode} title="دفتر معین" />
    </>
  );
}
