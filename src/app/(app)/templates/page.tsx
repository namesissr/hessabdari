import Link from 'next/link';
import prisma from '@/lib/prisma';
import { can } from '@/lib/auth';
import { dateToJ, formatJ, toFaDigits, todayUtc } from '@/lib/jalali';
import { one, pageContext, type SP } from '@/lib/page';
import { loadChart } from '@/modules/accounts/chart';
import { monthlyDate, pendingMonthly, type TemplateLine } from '@/modules/ledger/templates';
import { Badge, Card, Empty, Money, PageHeader } from '@/components/ui';
import { ActionForm } from '@/components/action-form';
import { JDateInput } from '@/components/jdate-input';
import { cn } from '@/lib/utils';
import { TemplateEditor } from './template-editor';
import { deleteTemplateAction, useTemplateAction } from './actions';

export const metadata = { title: 'قالب‌های سند' };

export default async function TemplatesPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { user, entity, fiscalYear } = await pageContext();
  if (!entity || !fiscalYear) return <Empty>ابتدا شرکت و سال مالی را تعریف کنید.</Empty>;
  const editable = can(user, 'voucher.edit');

  const templates = await prisma.voucherTemplate.findMany({ where: { entityId: entity.id }, orderBy: { name: 'asc' } });
  const mode = one(sp.mode);
  const selected = templates.find((t) => t.id === one(sp.id)) ?? null;
  const chart = await loadChart(prisma, entity.chartId);
  const [types, values] = await Promise.all([
    prisma.dimensionType.findMany({ orderBy: { sortOrder: 'asc' } }),
    prisma.dimensionValue.findMany({ where: { active: true, OR: [{ entityId: null }, { entityId: entity.id }] }, orderBy: [{ typeId: 'asc' }, { code: 'asc' }] }),
  ]);
  const accounts = chart
    .walk()
    .map((w) => w.account)
    .filter((a) => a.isPostable && a.active)
    .map((a) => ({
      id: a.id,
      name: `${a.code} — ${a.name}`,
      hint: chart.ancestors(a.id).reverse().map((p) => p.name).join(' › '),
      rules: chart.effectiveRules(a.id).map((r) => ({ typeId: r.dimensionTypeId, requirement: r.requirement })),
    }));
  const accName = new Map(accounts.map((a) => [a.id, a.name]));
  const today = todayUtc();
  const inYear = today >= fiscalYear.startDate && today <= fiscalYear.endDate ? today : fiscalYear.startDate;
  const monthly = await pendingMonthly(prisma, entity.id, inYear);
  const { jy, jm } = dateToJ(inYear);

  if (editable && (mode === 'new' || mode === 'edit')) {
    const initial =
      mode === 'edit' && selected
        ? {
            name: selected.name,
            description: selected.description ?? '',
            voucherType: selected.voucherType,
            recurrence: selected.recurrence,
            dayOfMonth: selected.dayOfMonth,
            active: selected.active,
            lines: (selected.lines as unknown as TemplateLine[]).map((l, i) => ({ ...l, key: `l${i}` })),
          }
        : null;
    return (
      <>
        <PageHeader title={mode === 'edit' ? `ویرایش قالب «${selected?.name}»` : 'قالب سند جدید'} subtitle="ردیف‌های ثابت سند را یک بار تعریف کنید؛ بعد هر ماه با یک کلیک سند ساخته می‌شود." />
        <TemplateEditor entityId={entity.id} templateId={mode === 'edit' ? selected?.id : null} initial={initial} accounts={accounts} types={types.map((t) => ({ id: t.id, name: t.name }))} values={values.map((v) => ({ id: v.id, typeId: v.typeId, name: v.name, code: v.code }))} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="قالب‌های سند و ثبت‌های تکراری"
        subtitle="برای ثبت‌های ماهانهٔ ثابت مثل حقوق، اجاره و استهلاک."
        actions={editable ? <Link href="?mode=new" className="rounded-lg bg-brand-600 px-3.5 py-2 text-sm text-white">قالب جدید</Link> : null}
      />

      {monthly.length > 0 && (
        <Card title={`ثبت‌های ماهانهٔ ${toFaDigits(jm)} / ${toFaDigits(jy)}`} className="mb-4" bodyClass="p-0">
          <table className="table">
            <tbody>
              {monthly.map((m) => (
                <tr key={m.template.id}>
                  <td>{m.template.name}</td>
                  <td className="text-xs text-muted">تاریخ پیشنهادی: {formatJ(m.suggestedDate)}</td>
                  <td>{m.done ? <Badge tone="green">ثبت شده</Badge> : <Badge tone="amber">ثبت نشده</Badge>}</td>
                  <td className="text-left">
                    {editable && !m.done && <Link className="text-sm text-brand-700 hover:underline" href={`?id=${m.template.id}`}>ایجاد سند ←</Link>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
        <Card bodyClass="p-0">
          {templates.length === 0 ? (
            <div className="p-4"><Empty>هنوز قالبی ساخته نشده است. می‌توانید از صفحهٔ هر سند هم «ذخیره به عنوان قالب» بزنید.</Empty></div>
          ) : (
            <table className="table">
              <thead><tr><th>نام</th><th>تکرار</th><th>تعداد ردیف</th><th>آخرین استفاده</th><th>وضعیت</th></tr></thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.id} className={cn(t.id === selected?.id && 'bg-brand-50', !t.active && 'text-slate-400')}>
                    <td><Link className="hover:text-brand-700" href={`?id=${t.id}`}>{t.name}</Link><div className="text-xs text-muted">{t.description}</div></td>
                    <td className="text-xs">{t.recurrence === 'MONTHLY' ? `ماهانه (روز ${toFaDigits(t.dayOfMonth)})` : 'بدون تکرار'}</td>
                    <td>{toFaDigits((t.lines as unknown as TemplateLine[]).length)}</td>
                    <td className="text-xs text-muted">{t.lastUsedAt ? formatJ(t.lastUsedAt) : '—'}</td>
                    <td><Badge tone={t.active ? 'green' : 'gray'}>{t.active ? 'فعال' : 'غیرفعال'}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        {selected && (
          <div className="space-y-4">
            <Card
              title={`ایجاد سند از «${selected.name}»`}
              actions={editable ? <Link href={`?mode=edit&id=${selected.id}`} className="text-xs text-brand-700">ویرایش قالب</Link> : null}
            >
              <ActionForm action={useTemplateAction.bind(null, selected.id)} submitLabel="ساخت سند یادداشت" variant="primary">
                <div>
                  <label className="label">تاریخ سند</label>
                  <JDateInput name="date" defaultValue={formatJ(selected.recurrence === 'MONTHLY' ? monthlyDate(jy, jm, selected.dayOfMonth) : today, false)} required />
                </div>
                <div>
                  <label className="label">شرح سند</label>
                  <input name="description" className="input" defaultValue={selected.description ?? selected.name} />
                </div>
                <div className="space-y-2">
                  {(selected.lines as unknown as TemplateLine[]).map((l, i) => (
                    <div key={i} className="rounded-lg border border-line p-2">
                      <div className="mb-1 text-xs text-muted">
                        {accName.get(l.accountId) ?? 'حساب حذف‌شده'} — {l.side === 'DEBIT' ? 'بدهکار' : 'بستانکار'}
                        {l.description ? ` — ${l.description}` : ''}
                      </div>
                      {l.amount ? (
                        <div className="text-sm"><Money value={BigInt(l.amount)} /> <span className="text-xs text-muted">(ثابت)</span></div>
                      ) : (
                        <input name={`amount:${i}`} dir="ltr" inputMode="numeric" className="input num" placeholder="مبلغ این ماه" required />
                      )}
                    </div>
                  ))}
                </div>
              </ActionForm>
            </Card>
            {editable && (
              <Card title="حذف قالب">
                <ActionForm inline action={deleteTemplateAction.bind(null, selected.id)} submitLabel="حذف" variant="danger" size="sm" confirm="این قالب حذف شود؟" />
              </Card>
            )}
          </div>
        )}
      </div>
    </>
  );
}
