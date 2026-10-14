import Link from 'next/link';
import prisma from '@/lib/prisma';
import { formatJ } from '@/lib/jalali';
import { one, pageContext, reportRange, type SP } from '@/lib/page';
import { trialBalance } from '@/modules/reports/financial';
import { Card, Empty, Money, PageHeader } from '@/components/ui';
import { ReportFilters, dimGroups, dimFilterLabel } from '@/components/report-filters';
import { cn } from '@/lib/utils';

export const metadata = { title: 'تراز آزمایشی' };

const LEVELS = { GROUP: 'گروه', GL: 'کل', SUBSIDIARY: 'معین', ALL: 'همهٔ سطوح' } as const;

export default async function TrialBalancePage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { entity, fiscalYear } = await pageContext();
  if (!entity || !fiscalYear) return <Empty>ابتدا شرکت و سال مالی را تعریف کنید.</Empty>;
  const range = reportRange(sp, fiscalYear);
  const level = (one(sp.level) || 'GL') as keyof typeof LEVELS;
  const includeClosing = one(sp.closing) === '1';
  const includeDrafts = one(sp.drafts) === '1';
  const groups = await dimGroups(sp);
  const rows = await trialBalance(prisma, { entityIds: [entity.id], fiscalYearIds: [fiscalYear.id], from: range.from, to: range.to, dimValueGroups: groups, includeClosing, includeDrafts });
  const shown = level === 'ALL' ? rows : rows.filter((r) => r.level === level);
  const roots = rows.filter((r) => r.depth === 0);
  const sum = (k: 'openingDebit' | 'openingCredit' | 'debit' | 'credit' | 'closingDebit' | 'closingCredit') => roots.reduce((s, r) => s + r[k], 0n);
  const filterLabel = await dimFilterLabel(sp);
  const ledgerLink = (id: string) => `/reports/ledger?account=${id}&from=${range.fromStr}&to=${range.toStr}${(Array.isArray(sp.dim) ? sp.dim : sp.dim ? [sp.dim] : []).map((d) => `&dim=${d}`).join('')}`;

  return (
    <>
      <PageHeader
        title={`تراز آزمایشی ${level === 'ALL' ? '' : LEVELS[level]}`}
        subtitle={`${entity.name} — از ${formatJ(range.from)} تا ${formatJ(range.to)}${filterLabel ? ` — ${filterLabel}` : ''}${includeDrafts ? ' — شامل یادداشت‌ها' : ''}`}
      />
      <ReportFilters sp={sp} chartId={entity.chartId} entityId={entity.id} range={range} closing>
        <div>
          <label className="label">سطح</label>
          <select name="level" defaultValue={level} className="input">
            {Object.entries(LEVELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" name="drafts" value="1" defaultChecked={includeDrafts} />
          شامل اسناد قطعی‌نشده
        </label>
      </ReportFilters>
      <Card bodyClass="p-0">
        {shown.length === 0 ? (
          <div className="p-4"><Empty>در این بازه گردشی ثبت نشده است.</Empty></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th rowSpan={2}>کد</th>
                  <th rowSpan={2}>نام حساب</th>
                  <th colSpan={2} className="text-center">ماندهٔ ابتدای دوره</th>
                  <th colSpan={2} className="text-center">گردش دوره</th>
                  <th colSpan={2} className="text-center">ماندهٔ پایان دوره</th>
                </tr>
                <tr>
                  <th>بدهکار</th><th>بستانکار</th><th>بدهکار</th><th>بستانکار</th><th>بدهکار</th><th>بستانکار</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} className={cn(level === 'ALL' && r.depth === 0 && 'bg-slate-50 font-bold', level === 'ALL' && r.depth === 1 && 'font-semibold')}>
                    <td className="num">{r.code}</td>
                    <td style={level === 'ALL' ? { paddingRight: `${0.6 + r.depth * 1.2}rem` } : undefined}>
                      <Link href={ledgerLink(r.id)} className="hover:text-brand-700 hover:underline">{r.name}</Link>
                    </td>
                    <td><Money value={r.openingDebit} /></td>
                    <td><Money value={r.openingCredit} /></td>
                    <td><Money value={r.debit} /></td>
                    <td><Money value={r.credit} /></td>
                    <td><Money value={r.closingDebit} /></td>
                    <td><Money value={r.closingCredit} /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}>جمع کل</td>
                  <td><Money value={sum('openingDebit')} /></td>
                  <td><Money value={sum('openingCredit')} /></td>
                  <td><Money value={sum('debit')} /></td>
                  <td><Money value={sum('credit')} /></td>
                  <td><Money value={sum('closingDebit')} /></td>
                  <td><Money value={sum('closingCredit')} /></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
