import Link from 'next/link';
import prisma from '@/lib/prisma';
import { formatJ, toFaDigits } from '@/lib/jalali';
import { one, pageContext, reportRange, type SP } from '@/lib/page';
import { ledger } from '@/modules/reports/financial';
import { Card, Empty, Money, PageHeader, TYPE_LABEL } from '@/components/ui';
import { ReportFilters, dimGroups, dimFilterLabel } from '@/components/report-filters';
import { formatMoney } from '@/lib/money';

export const metadata = { title: 'دفتر کل و معین' };

function Bal({ v }: { v: bigint }) {
  return (
    <span className="num whitespace-nowrap">
      {formatMoney(v < 0n ? -v : v, { zero: '۰' })} <span className="text-xs text-muted">{v > 0n ? 'بد' : v < 0n ? 'بس' : ''}</span>
    </span>
  );
}

export default async function LedgerPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { entity, fiscalYear } = await pageContext();
  if (!entity || !fiscalYear) return <Empty>ابتدا شرکت و سال مالی را تعریف کنید.</Empty>;
  const range = reportRange(sp, fiscalYear);
  const accountId = one(sp.account) || null;
  const groups = await dimGroups(sp);
  const filterLabel = await dimFilterLabel(sp);
  const account = accountId ? await prisma.account.findUnique({ where: { id: accountId } }) : null;
  const hasFilter = !!account || groups.length > 0;
  const data = hasFilter
    ? await ledger(prisma, { entityIds: [entity.id], fiscalYearIds: [fiscalYear.id], accountId, from: range.from, to: range.to, dimValueGroups: groups, includeClosing: one(sp.closing) === '1' })
    : null;
  const levelName = account ? (account.level === 'GROUP' ? 'گروه' : account.level === 'GL' ? 'کل' : 'معین') : 'تفصیلی';

  return (
    <>
      <PageHeader
        title={`دفتر ${levelName}${account ? ` — ${account.code} ${account.name}` : ''}`}
        subtitle={`${entity.name} — از ${formatJ(range.from)} تا ${formatJ(range.to)}${filterLabel ? ` — ${filterLabel}` : ''}`}
      />
      <ReportFilters sp={sp} chartId={entity.chartId} entityId={entity.id} range={range} account closing />
      {!data ? (
        <Empty>یک حساب (هر سطح) یا یک تفصیلی را انتخاب کنید. مثال: «طرف حساب: Hetzner» برای دفتر تفصیلی یک شخص.</Empty>
      ) : (
        <Card bodyClass="p-0">
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>تاریخ</th>
                  <th>سند</th>
                  <th>حساب</th>
                  <th>شرح</th>
                  <th>تفصیلی‌ها</th>
                  <th>بدهکار</th>
                  <th>بستانکار</th>
                  <th>مانده</th>
                </tr>
              </thead>
              <tbody>
                <tr className="bg-slate-50">
                  <td colSpan={5} className="font-semibold">ماندهٔ ابتدای دوره</td>
                  <td /><td />
                  <td><Bal v={data.opening} /></td>
                </tr>
                {data.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap">{formatJ(r.date)}</td>
                    <td className="whitespace-nowrap">
                      <Link className="text-brand-700 hover:underline" href={`/vouchers/${r.voucherId}`}>{r.number ? toFaDigits(r.number) : `م${toFaDigits(r.draftNo)}`}</Link>
                      {r.type !== 'NORMAL' && <span className="mr-1 text-xs text-muted">{TYPE_LABEL[r.type]}</span>}
                    </td>
                    <td className="text-xs"><span className="num">{r.account.code}</span> {r.account.name}</td>
                    <td className="text-sm">{r.description || r.vdesc}</td>
                    <td className="text-xs text-muted">{r.dims.map((d) => d.valueName).join(' / ')}</td>
                    <td><Money value={r.debit} /></td>
                    <td><Money value={r.credit} /></td>
                    <td><Bal v={r.balance} /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5}>جمع گردش / ماندهٔ پایان دوره</td>
                  <td><Money value={data.totalDebit} /></td>
                  <td><Money value={data.totalCredit} /></td>
                  <td><Bal v={data.closing} /></td>
                </tr>
              </tfoot>
            </table>
          </div>
          {data.truncated && <div className="border-t border-line p-3 text-xs text-amber-700">فقط ۵۰۰۰ ردیف اول نمایش داده شد؛ بازهٔ تاریخ را کوچک‌تر کنید.</div>}
        </Card>
      )}
    </>
  );
}
