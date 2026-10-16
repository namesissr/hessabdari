import Link from 'next/link';
import prisma from '@/lib/prisma';
import { can } from '@/lib/auth';
import { formatJ, toFaDigits } from '@/lib/jalali';
import { one, pageContext, type SP } from '@/lib/page';
import { METHOD_LABEL } from '@/modules/allocation/allocation';
import { Badge, Card, Empty, Money, PageHeader } from '@/components/ui';
import { ActionForm } from '@/components/action-form';
import { cn } from '@/lib/utils';
import { deleteRuleAction, runAllocationAction, saveRuleAction } from './actions';

export const metadata = { title: 'تسهیم هزینه‌های مشترک' };

export default async function AllocationPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { user, entity, fiscalYear } = await pageContext();
  if (!entity || !fiscalYear) return <Empty>ابتدا شرکت و سال مالی را تعریف کنید.</Empty>;
  if (!can(user, 'settings.accounting')) return <Empty>دسترسی ندارید.</Empty>;

  const [rules, businesses, periods] = await Promise.all([
    prisma.allocationRule.findMany({ where: { entityId: entity.id }, orderBy: { createdAt: 'asc' }, include: { runs: { include: { period: true }, orderBy: { createdAt: 'desc' } } } }),
    prisma.dimensionValue.findMany({ where: { type: { code: 'BUSINESS' }, active: true }, orderBy: { code: 'asc' } }),
    prisma.fiscalPeriod.findMany({ where: { fiscalYearId: fiscalYear.id }, orderBy: { no: 'asc' } }),
  ]);
  const selected = rules.find((r) => r.id === one(sp.id)) ?? null;
  const weights = (selected?.weights ?? {}) as Record<string, number>;

  return (
    <>
      <PageHeader
        title="تسهیم هزینه‌های مشترک"
        subtitle="هزینه‌های ستاد (اجاره، حقوق اداری، نرم‌افزار و…) را بین کسب‌وکارها پخش کنید تا سود واقعی هر سایت معلوم شود. هر دوره یک بار اجرا می‌شود و سند «تسهیم» می‌خورد."
      />
      <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
        <div className="space-y-4">
          {rules.length === 0 && <Empty>هنوز قانون تسهیمی تعریف نشده است.</Empty>}
          {rules.map((rule) => (
            <Card
              key={rule.id}
              title={
                <span className="flex flex-wrap items-center gap-2">
                  <Link href={`?id=${rule.id}`} className={cn('hover:text-brand-700', rule.id === selected?.id && 'text-brand-700')}>{rule.name}</Link>
                  <Badge tone={rule.active ? 'green' : 'gray'}>{rule.active ? 'فعال' : 'غیرفعال'}</Badge>
                  <span className="text-xs font-normal text-muted">{METHOD_LABEL[rule.method]} — حساب‌های {rule.accountCodes.map((c) => toFaDigits(c)).join('، ')}</span>
                </span>
              }
            >
              {can(user, 'voucher.post') && (
                <ActionForm action={runAllocationAction.bind(null, rule.id)} submitLabel="اجرای تسهیم" variant="primary" size="sm" confirm="سند تسهیم برای دورهٔ انتخابی صادر و قطعی می‌شود. ادامه؟">
                  <div className="flex flex-wrap items-end gap-2">
                    <div>
                      <label className="label">دورهٔ مالی</label>
                      <select name="periodId" className="input w-48">
                        {periods.map((p) => (
                          <option key={p.id} value={p.id} disabled={rule.runs.some((r) => r.periodId === p.id)}>
                            {p.title}{rule.runs.some((r) => r.periodId === p.id) ? ' (انجام شده)' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                    <label className="flex items-center gap-1.5 pb-2 text-sm">
                      <input type="checkbox" name="preview" value="1" /> فقط پیش‌نمایش (بدون صدور سند)
                    </label>
                  </div>
                </ActionForm>
              )}

              {rule.runs.length > 0 && (
                <div className="mt-4 overflow-x-auto">
                  <table className="table">
                    <thead><tr><th>دوره</th><th>مبلغ تسهیم‌شده</th><th>سهم کسب‌وکارها</th><th>سند</th><th>تاریخ اجرا</th></tr></thead>
                    <tbody>
                      {rule.runs.map((run) => (
                        <tr key={run.id}>
                          <td>{run.period.title}</td>
                          <td><Money value={run.totalAmount} /></td>
                          <td className="text-xs">
                            {((run.detail ?? []) as { name: string; amount: string; weight: number }[]).map((d) => (
                              <span key={d.name} className="ml-2 inline-block rounded bg-slate-100 px-1.5 py-0.5">
                                {d.name}: <Money value={BigInt(d.amount)} /> ({toFaDigits(d.weight.toFixed(1))}٪)
                              </span>
                            ))}
                          </td>
                          <td className="text-xs">{run.voucherId ? <Link className="text-brand-700 hover:underline" href={`/vouchers/${run.voucherId}`}>سند</Link> : '—'}</td>
                          <td className="text-xs text-muted">{formatJ(run.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          ))}
        </div>

        <Card title={selected ? `ویرایش «${selected.name}»` : 'قانون تسهیم جدید'} actions={selected ? <Link href="/settings/allocation" className="text-xs text-brand-700">+ جدید</Link> : null}>
          <ActionForm action={saveRuleAction} submitLabel={selected ? 'ذخیره' : 'ایجاد قانون'} key={selected?.id ?? 'new'}>
            <input type="hidden" name="entityId" value={entity.id} />
            {selected && <input type="hidden" name="id" value={selected.id} />}
            <div>
              <label className="label">نام قانون *</label>
              <input name="name" className="input" defaultValue={selected?.name} placeholder="تسهیم هزینه‌های اداری ستاد" required />
            </div>
            <div>
              <label className="label">کدهای حساب برای تسهیم *</label>
              <input name="accountCodes" dir="ltr" className="input" defaultValue={selected?.accountCodes.join(', ') ?? '82, 84'} placeholder="82, 84, 8101" />
              <p className="mt-1 text-xs text-muted">کد کل یا معین؛ هر حسابی که با این کدها شروع شود تسهیم می‌شود (مثلاً ۸۲ یعنی همهٔ هزینه‌های اداری).</p>
            </div>
            <div>
              <label className="label">کسب‌وکار مبدأ (معمولاً ستاد)</label>
              <select name="sourceBusinessDimId" className="input" defaultValue={selected?.sourceBusinessDimId ?? ''}>
                <option value="">همهٔ هزینه‌ها (بدون فیلتر مبدأ)</option>
                {businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">روش تسهیم</label>
              <select name="method" className="input" defaultValue={selected?.method ?? 'REVENUE_SHARE'}>
                {Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <p className="mt-1 text-xs text-muted">«به نسبت درآمد» هر دوره خودکار از روی درآمد همان دوره محاسبه می‌شود؛ «درصد ثابت» از جدول زیر.</p>
            </div>
            <div>
              <label className="label">درصد ثابت هر کسب‌وکار (جمع = ۱۰۰)</label>
              <div className="grid gap-1.5">
                {businesses.map((b) => (
                  <div key={b.id} className="flex items-center justify-between gap-2 rounded-md border border-line px-2 py-1">
                    <span className="text-sm">{b.name}</span>
                    <input name={`weight:${b.id}`} dir="ltr" type="number" step="0.1" min="0" max="100" className="input w-24 py-0.5 text-xs" defaultValue={weights[b.id] ?? ''} />
                  </div>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="active" defaultChecked={selected ? selected.active : true} /> فعال</label>
          </ActionForm>
          {selected && (
            <div className="mt-3 border-t border-line pt-3">
              <ActionForm inline action={deleteRuleAction.bind(null, selected.id)} submitLabel="حذف قانون" variant="danger" size="sm" confirm="حذف شود؟" />
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
