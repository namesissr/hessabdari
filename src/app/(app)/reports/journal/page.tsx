import Link from 'next/link';
import prisma from '@/lib/prisma';
import { formatJ, toFaDigits } from '@/lib/jalali';
import { one, pageContext, reportRange, type SP } from '@/lib/page';
import { journal } from '@/modules/reports/financial';
import { Card, Empty, Money, PageHeader, TYPE_LABEL } from '@/components/ui';
import { ReportFilters } from '@/components/report-filters';

export const metadata = { title: 'دفتر روزنامه' };

export default async function JournalPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { entity, fiscalYear } = await pageContext();
  if (!entity || !fiscalYear) return <Empty>ابتدا شرکت و سال مالی را تعریف کنید.</Empty>;
  const range = reportRange(sp, fiscalYear);
  const level = one(sp.level) === 'SUBSIDIARY' ? 'SUBSIDIARY' : 'GL';
  const vouchers = await journal(prisma, { entityIds: [entity.id], from: range.from, to: range.to, level, includeClosing: one(sp.closing) === '1' });
  let td = 0n, tc = 0n;
  vouchers.forEach((v) => v.lines.forEach((l) => { td += l.debit; tc += l.credit; }));

  return (
    <>
      <PageHeader title="دفتر روزنامه" subtitle={`${entity.name} — از ${formatJ(range.from)} تا ${formatJ(range.to)} — ${level === 'GL' ? 'در سطح حساب کل' : 'در سطح معین'}`} />
      <ReportFilters sp={sp} chartId={entity.chartId} entityId={entity.id} range={range} dims={false} closing>
        <div>
          <label className="label">سطح</label>
          <select name="level" defaultValue={level} className="input">
            <option value="GL">حساب کل (استاندارد)</option>
            <option value="SUBSIDIARY">معین و تفصیلی</option>
          </select>
        </div>
      </ReportFilters>
      <Card bodyClass="p-0">
        {vouchers.length === 0 ? (
          <div className="p-4"><Empty>سند قطعی در این بازه وجود ندارد.</Empty></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>تاریخ</th>
                  <th>سند</th>
                  <th>کد</th>
                  <th>شرح حساب</th>
                  {level === 'SUBSIDIARY' && <th>تفصیلی</th>}
                  <th>بدهکار</th>
                  <th>بستانکار</th>
                </tr>
              </thead>
              <tbody>
                {vouchers.map((v) =>
                  v.lines.map((l, i) => (
                    <tr key={`${v.id}-${i}`} className={i === 0 ? 'border-t-2 border-slate-200' : ''}>
                      {i === 0 && (
                        <>
                          <td rowSpan={v.lines.length} className="whitespace-nowrap align-top">{formatJ(v.date)}</td>
                          <td rowSpan={v.lines.length} className="align-top">
                            <Link href={`/vouchers/${v.id}`} className="font-semibold text-brand-700">{toFaDigits(v.number ?? 0)}</Link>
                            {v.type !== 'NORMAL' && <div className="text-xs text-muted">{TYPE_LABEL[v.type]}</div>}
                          </td>
                        </>
                      )}
                      <td className="num">{l.code}</td>
                      <td className={l.credit > 0n ? 'pr-8' : ''}>
                        {l.name}
                        {l.description && <div className="text-xs text-muted">{l.description}</div>}
                        {i === v.lines.length - 1 && v.description && <div className="mt-1 text-xs text-slate-500">بابت: {v.description}</div>}
                      </td>
                      {level === 'SUBSIDIARY' && <td className="text-xs text-muted">{l.dims}</td>}
                      <td><Money value={l.debit} /></td>
                      <td><Money value={l.credit} /></td>
                    </tr>
                  )),
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={level === 'SUBSIDIARY' ? 5 : 4}>جمع</td>
                  <td><Money value={td} /></td>
                  <td><Money value={tc} /></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
      {vouchers.length >= 1000 && <p className="mt-2 text-xs text-amber-700">فقط ۱۰۰۰ سند اول نمایش داده شد؛ بازه را کوچک‌تر کنید.</p>}
    </>
  );
}
