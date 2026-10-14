import prisma from '@/lib/prisma';
import { loadChart } from '@/modules/accounts/chart';
import { SearchSelect } from './search-select';
import { PrintButton } from './print-button';

type SPv = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] ?? '' : v ?? '');

/**
 * فرم فیلتر مشترک گزارش‌ها (GET). مقادیر در URL می‌مانند تا گزارش قابل اشتراک و چاپ باشد.
 */
export async function ReportFilters({
  sp,
  chartId,
  entityId,
  range,
  asOf,
  account,
  accountRequired,
  dims = true,
  closing,
  children,
}: {
  sp: SPv;
  chartId: string;
  entityId: string;
  range?: { fromStr: string; toStr: string };
  asOf?: string;
  account?: boolean;
  accountRequired?: boolean;
  dims?: boolean;
  closing?: boolean;
  children?: React.ReactNode;
}) {
  const [chart, values, types] = await Promise.all([
    account ? loadChart(prisma, chartId) : null,
    dims ? prisma.dimensionValue.findMany({ where: { OR: [{ entityId: null }, { entityId }] }, orderBy: [{ typeId: 'asc' }, { code: 'asc' }] }) : [],
    dims ? prisma.dimensionType.findMany() : [],
  ]);
  const typeName = new Map(types.map((t) => [t.id, t.name]));
  const dimOptions = values.map((v) => ({ value: v.id, label: `${typeName.get(v.typeId)}: ${v.name}`, hint: v.code }));
  const accountOptions = chart
    ? chart.walk().map(({ account: a }) => ({ value: a.id, label: `${a.code} — ${a.name}`, hint: a.level === 'SUBSIDIARY' ? 'معین' : a.level === 'GL' ? 'کل' : 'گروه' }))
    : [];
  const dimVals = Array.isArray(sp.dim) ? sp.dim : sp.dim ? [sp.dim] : [];

  return (
    <form className="no-print mb-4 rounded-xl border border-line bg-white p-4 shadow-sm">
      <div className="grid items-end gap-3 md:grid-cols-4 lg:grid-cols-6">
        {range && (
          <>
            <div>
              <label className="label">از تاریخ</label>
              <input name="from" defaultValue={range.fromStr} dir="ltr" className="input" />
            </div>
            <div>
              <label className="label">تا تاریخ</label>
              <input name="to" defaultValue={range.toStr} dir="ltr" className="input" />
            </div>
          </>
        )}
        {asOf !== undefined && (
          <div>
            <label className="label">تا تاریخ</label>
            <input name="asOf" defaultValue={asOf} dir="ltr" className="input" />
          </div>
        )}
        {account && (
          <div className="md:col-span-2">
            <label className="label">حساب{accountRequired ? ' *' : ' (اختیاری)'}</label>
            <SearchSelect name="account" options={accountOptions} value={one(sp.account)} placeholder="کد یا نام حساب…" />
          </div>
        )}
        {dims &&
          [0, 1].map((i) => (
            <div key={i}>
              <label className="label">فیلتر تفصیلی/مرکز {i + 1}</label>
              <SearchSelect name="dim" options={dimOptions} value={dimVals[i] ?? ''} />
            </div>
          ))}
        {children}
        {closing && (
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input type="checkbox" name="closing" value="1" defaultChecked={one(sp.closing) === '1'} />
            شامل اسناد اختتامیه
          </label>
        )}
        <div className="flex gap-2">
          <button className="rounded-lg bg-slate-800 px-4 py-2 text-sm text-white">نمایش</button>
          <PrintButton />
        </div>
      </div>
    </form>
  );
}

/** گروه‌بندی مقادیر فیلتر تفصیلی بر اساس نوع (AND بین انواع، OR داخل یک نوع) */
export async function dimGroups(sp: SPv): Promise<string[][]> {
  const ids = (Array.isArray(sp.dim) ? sp.dim : sp.dim ? [sp.dim] : []).filter(Boolean);
  if (!ids.length) return [];
  const values = await prisma.dimensionValue.findMany({ where: { id: { in: ids } } });
  const byType = new Map<string, string[]>();
  for (const v of values) byType.set(v.typeId, [...(byType.get(v.typeId) ?? []), v.id]);
  return [...byType.values()];
}

export async function dimFilterLabel(sp: SPv): Promise<string> {
  const ids = (Array.isArray(sp.dim) ? sp.dim : sp.dim ? [sp.dim] : []).filter(Boolean);
  if (!ids.length) return '';
  const values = await prisma.dimensionValue.findMany({ where: { id: { in: ids } }, include: { type: true } });
  return values.map((v) => `${v.type.name}: ${v.name}`).join('، ');
}
