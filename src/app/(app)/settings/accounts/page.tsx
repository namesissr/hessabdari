import Link from 'next/link';
import prisma from '@/lib/prisma';
import { can } from '@/lib/auth';
import { one, pageContext, type SP } from '@/lib/page';
import { ACCOUNT_TAGS, CATEGORY_LABELS, LEVEL_LABELS, loadChart } from '@/modules/accounts/chart';
import { Badge, Card, Empty, LinkButton, PageHeader } from '@/components/ui';
import { ActionForm } from '@/components/action-form';
import { cn } from '@/lib/utils';
import { deleteAccountAction, saveAccountAction } from '../actions';

export const metadata = { title: 'کدینگ حساب‌ها' };

const REQ_LABEL = { REQUIRED: 'اجباری', OPTIONAL: 'اختیاری', FORBIDDEN: 'ممنوع' } as const;

export default async function AccountsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { user, entity } = await pageContext();
  if (!entity) return <Empty>شرکتی تعریف نشده است.</Empty>;
  const chart = await loadChart(prisma, entity.chartId);
  const chartRow = await prisma.chart.findUniqueOrThrow({ where: { id: entity.chartId } });
  const types = await prisma.dimensionType.findMany({ orderBy: { sortOrder: 'asc' } });
  const typeName = new Map(types.map((t) => [t.id, t.name]));
  const editable = can(user, 'settings.accounting');
  const q = one(sp.q).trim();

  const selId = one(sp.id);
  const parentId = one(sp.parent);
  const selected = selId ? chart.get(selId) : null;
  const parent = parentId ? chart.get(parentId) : null;
  const usedIds = new Set((await prisma.voucherLine.groupBy({ by: ['accountId'] })).map((g) => g.accountId));

  const rows = chart.walk().filter(({ account: a }) => !q || a.code.startsWith(q) || a.name.includes(q));

  const form = (selected || parent) && editable && (
    <Card title={selected ? `ویرایش حساب ${selected.code}` : `حساب جدید زیر «${parent!.code} ${parent!.name}»`}>
      <ActionForm action={saveAccountAction} submitLabel="ذخیره" key={selected?.id ?? parent?.id}>
        {selected && <input type="hidden" name="id" value={selected.id} />}
        {parent && <input type="hidden" name="parentId" value={parent.id} />}
        <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
          <div>
            <label className="label">کد</label>
            <input name="code" dir="ltr" className="input" defaultValue={selected?.code ?? (parent ? parent.code : '')} disabled={!!selected && usedIds.has(selected.id)} />
          </div>
          <div>
            <label className="label">نام حساب</label>
            <input name="name" className="input" defaultValue={selected?.name ?? ''} required />
          </div>
        </div>
        <div className="text-xs text-muted">
          سطح: {selected ? LEVEL_LABELS[selected.level] : parent!.level === 'GROUP' ? 'کل' : 'معین'} — ماهیت: {CATEGORY_LABELS[(selected ?? parent)!.category]}
          {selected && usedIds.has(selected.id) && ' — این حساب گردش دارد و کدش ثابت است.'}
        </div>
        <div>
          <label className="label">برچسب‌های گزارشی (داشبورد و صورت‌های مالی)</label>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
            {Object.entries(ACCOUNT_TAGS).map(([k, v]) => (
              <label key={k} className="flex items-center gap-1.5">
                <input type="checkbox" name="tags" value={k} defaultChecked={selected?.tags.includes(k)} /> {v}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted">برچسب روی حساب کل، به همهٔ معین‌های زیرش هم اعمال می‌شود.</p>
        </div>
        <div>
          <label className="label">قوانین تفصیلی (کدام بُعدها روی ردیف سند این حساب لازم است)</label>
          <label className="mb-2 flex items-center gap-2 text-sm">
            <input type="checkbox" name="inheritRules" defaultChecked={selected ? selected.rules.length === 0 : true} /> ارث‌بری از حساب والد
          </label>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {types.map((t) => {
              const cur = selected?.rules.find((r) => r.dimensionTypeId === t.id)?.requirement ?? '';
              return (
                <div key={t.id} className="flex items-center justify-between gap-2 rounded-md border border-line px-2 py-1">
                  <span className="text-sm">{t.name}</span>
                  <select name={`rule:${t.id}`} defaultValue={cur} className="input w-28 py-0.5 text-xs">
                    <option value="">—</option>
                    <option value="REQUIRED">اجباری</option>
                    <option value="OPTIONAL">اختیاری</option>
                    <option value="FORBIDDEN">ممنوع</option>
                  </select>
                </div>
              );
            })}
          </div>
          {selected && (
            <p className="mt-1 text-xs text-muted">
              قوانین مؤثر فعلی: {chart.effectiveRules(selected.id).map((r) => `${typeName.get(r.dimensionTypeId)} (${REQ_LABEL[r.requirement]})`).join('، ') || 'ندارد'}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-1.5"><input type="checkbox" name="active" defaultChecked={selected ? selected.active : true} /> فعال</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" name="allowFx" defaultChecked={selected?.allowFx} /> حساب ارزی</label>
        </div>
        <div>
          <label className="label">توضیح</label>
          <input name="description" className="input" defaultValue={selected?.description ?? ''} />
        </div>
      </ActionForm>
      {selected && !selected.systemRole && !usedIds.has(selected.id) && !chart.children.get(selected.id)?.length && (
        <div className="mt-3 border-t border-line pt-3">
          <ActionForm action={deleteAccountAction.bind(null, selected.id)} submitLabel="حذف حساب" variant="danger" size="sm" confirm="حساب حذف شود؟" />
        </div>
      )}
    </Card>
  );

  return (
    <>
      <PageHeader
        title="کدینگ حساب‌ها"
        subtitle={`${chartRow.name} — گروه / کل / معین؛ «تفصیلی» از طریق ابعاد تعریف می‌شود. این چارت بین همهٔ شرکت‌های مجموعه مشترک است.`}
      />
      <div className="grid gap-4 xl:grid-cols-[1fr_440px]">
        <Card
          bodyClass="p-0"
          title={
            <form className="flex gap-2">
              <input name="q" defaultValue={q} placeholder="جستجوی کد یا نام…" className="input w-56 py-1" />
            </form>
          }
        >
          <div className="max-h-[75vh] overflow-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>کد</th>
                  <th>نام</th>
                  <th>سطح</th>
                  <th>تفصیلی‌های مؤثر</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map(({ account: a, depth }) => (
                  <tr key={a.id} className={cn(a.id === selId && 'bg-brand-50', !a.active && 'text-slate-400', depth === 0 && 'bg-slate-50 font-bold')}>
                    <td className="num">{a.code}</td>
                    <td style={{ paddingRight: `${0.6 + depth * 1.1}rem` }}>
                      {editable ? <Link href={`?id=${a.id}${q ? `&q=${q}` : ''}`} className="hover:text-brand-700">{a.name}</Link> : a.name}
                      {a.systemRole && <Badge tone="violet">سیستمی</Badge>}
                      {!a.active && <Badge>غیرفعال</Badge>}
                    </td>
                    <td className="text-xs">{LEVEL_LABELS[a.level]}</td>
                    <td className="text-xs text-muted">
                      {a.isPostable &&
                        chart
                          .effectiveRules(a.id)
                          .filter((r) => r.requirement !== 'FORBIDDEN')
                          .map((r) => (
                            <span key={r.dimensionTypeId} className={cn('ml-1', r.requirement === 'REQUIRED' && 'font-semibold text-slate-700')}>
                              {typeName.get(r.dimensionTypeId)}{r.requirement === 'REQUIRED' ? '*' : ''}
                            </span>
                          ))}
                    </td>
                    <td className="text-left">
                      {editable && a.level !== 'SUBSIDIARY' && (
                        <Link href={`?parent=${a.id}`} className="text-xs text-brand-700 hover:underline">+ زیرحساب</Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <div>
          {form || (
            <Card title="راهنما">
              <ul className="list-disc space-y-2 pr-4 text-sm text-slate-600">
                <li>نام کسب‌وکارها (ارزینو، بلوپال…) را در کدینگ نیاورید؛ کسب‌وکار روی ردیف سند به‌عنوان «بُعد» ثبت می‌شود.</li>
                <li>فقط حساب‌های معین قابل ثبت در سند هستند.</li>
                <li>ستارهٔ کنار تفصیلی یعنی هنگام قطعی کردن سند الزامی است.</li>
                <li>برای افزودن حساب، روی «+ زیرحساب» کنار حساب والد بزنید.</li>
              </ul>
              {editable && <div className="mt-3"><LinkButton href="/settings/dimensions" size="sm">مدیریت تفصیلی‌ها</LinkButton></div>}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
