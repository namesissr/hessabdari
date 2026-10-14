import prisma from '@/lib/prisma';
import { formatJ, parseJ, todayUtc } from '@/lib/jalali';
import { one, pageContext, type SP } from '@/lib/page';
import { balanceSheet } from '@/modules/reports/financial';
import { errorMessage } from '@/lib/errors';
import { Card, Empty, Money, PageHeader } from '@/components/ui';
import { ReportFilters } from '@/components/report-filters';

export const metadata = { title: 'ترازنامه' };

export default async function BalanceSheetPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { entity, fiscalYear, entities } = await pageContext();
  if (!entity || !fiscalYear) return <Empty>ابتدا شرکت و سال مالی را تعریف کنید.</Empty>;
  const today = todayUtc();
  const def = today >= fiscalYear.startDate && today <= fiscalYear.endDate ? today : fiscalYear.endDate;
  const asOf = parseJ(one(sp.asOf)) ?? def;
  const consolidated = one(sp.scope) === 'all' && entities.length > 1;

  let bs: Awaited<ReturnType<typeof balanceSheet>> | null = null;
  let error = '';
  try {
    bs = await balanceSheet(prisma, { entityIds: consolidated ? entities.map((e) => e.id) : [entity.id], asOf });
  } catch (e) {
    error = errorMessage(e);
  }

  const side = (cats: string[]) => bs?.groups.filter((g) => cats.includes(g.category)) ?? [];

  const Column = ({ title, cats, extra, total }: { title: string; cats: string[]; extra?: React.ReactNode; total: bigint }) => (
    <Card title={title} bodyClass="p-0">
      <table className="table">
        <tbody>
          {side(cats).map((g) => (
            <GroupRows key={g.id} g={g} />
          ))}
          {extra}
        </tbody>
        <tfoot>
          <tr>
            <td>جمع {title}</td>
            <td><Money value={total} colored zero="۰" /></td>
          </tr>
        </tfoot>
      </table>
    </Card>
  );

  return (
    <>
      <PageHeader title="ترازنامه (صورت وضعیت مالی)" subtitle={`${consolidated ? 'کل مجموعه (جمع شرکت‌ها)' : entity.name} — در تاریخ ${formatJ(asOf)}`} />
      <ReportFilters sp={sp} chartId={entity.chartId} entityId={entity.id} asOf={formatJ(asOf, false)} dims={false}>
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
      {error && <Empty>{error}</Empty>}
      {bs && (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <Column title="دارایی‌ها" cats={['ASSET']} total={bs.assets} />
            <div className="space-y-4">
              <Column title="بدهی‌ها" cats={['LIABILITY']} total={bs.liabilities} />
              <Column
                title="حقوق مالکانه"
                cats={['EQUITY']}
                total={bs.equity}
                extra={
                  <tr>
                    <td className="pr-6">سود (زیان) دورهٔ جاری (بسته‌نشده)</td>
                    <td><Money value={bs.currentProfit} colored zero="۰" /></td>
                  </tr>
                }
              />
              <div className="rounded-xl border border-line bg-white p-4 text-sm shadow-sm">
                <div className="flex justify-between font-bold">
                  <span>جمع بدهی‌ها و حقوق مالکانه</span>
                  <Money value={bs.liabilities + bs.equity} zero="۰" />
                </div>
              </div>
            </div>
          </div>
          {bs.difference !== 0n && (
            <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
              اختلاف ترازنامه: <Money value={bs.difference} /> — معمولاً ناشی از مانده در حساب‌های انتظامی یا حساب‌های بدون دستهٔ صحیح است.
            </div>
          )}
        </>
      )}
    </>
  );
}

function GroupRows({ g }: { g: { id: string; code: string; name: string; rows: { id: string; code: string; name: string; amount: bigint }[]; total: bigint } }) {
  return (
    <>
      <tr className="bg-slate-50">
        <td className="font-semibold">{g.name}</td>
        <td className="font-semibold"><Money value={g.total} colored zero="۰" /></td>
      </tr>
      {g.rows.map((r) => (
        <tr key={r.id}>
          <td className="pr-6"><span className="num ml-2 text-xs text-muted">{r.code}</span>{r.name}</td>
          <td><Money value={r.amount} colored /></td>
        </tr>
      ))}
    </>
  );
}
