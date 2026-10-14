import Link from 'next/link';
import prisma from '@/lib/prisma';
import { can } from '@/lib/auth';
import { formatJ, toFaDigits } from '@/lib/jalali';
import { one, pageContext, type SP } from '@/lib/page';
import { Badge, Card, Empty, PageHeader } from '@/components/ui';
import { ActionForm } from '@/components/action-form';
import { cn } from '@/lib/utils';
import { deleteDimensionValueAction, saveDimensionTypeAction, saveDimensionValueAction } from '../actions';

export const metadata = { title: 'تفصیلی‌ها و کسب‌وکارها' };

const KIND_LABEL = { WEBSITE: 'سایت / پلتفرم', TRADING: 'بازرگانی (واردات/صادرات)', PROJECT: 'پروژه', INVESTMENT: 'سرمایه‌گذاری', HEADQUARTERS: 'ستاد / مشترک', OTHER: 'سایر' } as const;

export default async function DimensionsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { user, entity, entities } = await pageContext();
  if (!entity) return <Empty>شرکتی تعریف نشده است.</Empty>;
  const editable = can(user, 'settings.accounting');
  const types = await prisma.dimensionType.findMany({ orderBy: { sortOrder: 'asc' }, include: { _count: { select: { values: true } } } });
  const type = types.find((t) => t.id === one(sp.type)) ?? types.find((t) => t.code === 'BUSINESS') ?? types[0];
  if (!type) return <Empty>نوع تفصیلی تعریف نشده است.</Empty>;
  const q = one(sp.q).trim();
  const values = await prisma.dimensionValue.findMany({
    where: { typeId: type.id, ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { code: { contains: q } }] } : {}) },
    orderBy: { code: 'asc' },
    include: { businessUnit: true, parent: true, entity: true, _count: { select: { setItems: true } } },
    take: 500,
  });
  const edit = one(sp.edit) ? await prisma.dimensionValue.findUnique({ where: { id: one(sp.edit) }, include: { businessUnit: true } }) : null;
  const parents = type.isHierarchical ? await prisma.dimensionValue.findMany({ where: { typeId: type.id }, orderBy: { code: 'asc' } }) : [];
  const isBusiness = type.code === 'BUSINESS';

  return (
    <>
      <PageHeader
        title="تفصیلی‌ها، مراکز و کسب‌وکارها"
        subtitle="هر «نوع» یک بُعد تحلیلی است که روی ردیف‌های سند ثبت می‌شود. کسب‌وکار یا پروژهٔ جدید = یک مقدار جدید؛ بدون تغییر در نرم‌افزار."
      />
      <div className="grid gap-4 lg:grid-cols-[240px_1fr_380px]">
        <Card title="انواع" bodyClass="p-2">
          <ul>
            {types.map((t) => (
              <li key={t.id}>
                <Link href={`?type=${t.id}`} className={cn('flex items-center justify-between rounded-lg px-3 py-2 text-sm', t.id === type.id ? 'bg-brand-600 text-white' : 'hover:bg-slate-100')}>
                  <span>{t.name}</span>
                  <span className="text-xs opacity-70">{toFaDigits(t._count.values)}</span>
                </Link>
              </li>
            ))}
          </ul>
          {editable && (
            <details className="mt-3 border-t border-line px-2 pt-3">
              <summary className="cursor-pointer text-sm text-brand-700">+ نوع جدید (مثلاً قرارداد، شعبه)</summary>
              <ActionForm action={saveDimensionTypeAction} submitLabel="ایجاد" size="sm" className="mt-2">
                <input name="code" dir="ltr" placeholder="CONTRACT" className="input" required />
                <input name="name" placeholder="نام فارسی" className="input" required />
                <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="isHierarchical" /> درختی</label>
              </ActionForm>
            </details>
          )}
        </Card>

        <Card
          bodyClass="p-0"
          title={
            <div className="flex items-center gap-3">
              <span>{type.name}</span>
              {type.isSystem && <Badge tone="violet">سیستمی</Badge>}
              <form><input type="hidden" name="type" value={type.id} /><input name="q" defaultValue={q} placeholder="جستجو…" className="input w-44 py-1" /></form>
            </div>
          }
        >
          {type.description && <p className="border-b border-line px-4 py-2 text-xs text-muted">{type.description}</p>}
          {values.length === 0 ? (
            <div className="p-4"><Empty>مقداری تعریف نشده است.</Empty></div>
          ) : (
            <div className="max-h-[70vh] overflow-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>کد</th>
                    <th>نام</th>
                    {type.isHierarchical && <th>والد</th>}
                    {isBusiness && <th>نوع / دامنه</th>}
                    <th>دامنه</th>
                    <th>استفاده</th>
                  </tr>
                </thead>
                <tbody>
                  {values.map((v) => (
                    <tr key={v.id} className={cn(v.id === edit?.id && 'bg-brand-50', !v.active && 'text-slate-400')}>
                      <td className="num">{v.code}</td>
                      <td>
                        {editable ? <Link className="hover:text-brand-700" href={`?type=${type.id}&edit=${v.id}`}>{v.name}</Link> : v.name}
                        {!v.active && <Badge>غیرفعال</Badge>}
                      </td>
                      {type.isHierarchical && <td className="text-xs">{v.parent?.name}</td>}
                      {isBusiness && (
                        <td className="text-xs">
                          {v.businessUnit ? KIND_LABEL[v.businessUnit.kind] : '—'}
                          {v.businessUnit?.domain && <div dir="ltr" className="text-muted">{v.businessUnit.domain}</div>}
                          {v.businessUnit?.launchedAt && <div className="text-muted">راه‌اندازی {formatJ(v.businessUnit.launchedAt)}</div>}
                        </td>
                      )}
                      <td className="text-xs">{v.entity?.name ?? 'کل مجموعه'}</td>
                      <td className="text-xs text-muted">{v._count.setItems ? 'دارد' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {editable && (
          <Card title={edit ? `ویرایش «${edit.name}»` : `افزودن به «${type.name}»`} actions={edit ? <Link href={`?type=${type.id}`} className="text-xs text-brand-700">+ جدید</Link> : null}>
            <ActionForm action={saveDimensionValueAction} submitLabel={edit ? 'ذخیره' : 'افزودن'} resetOnSuccess={!edit} key={edit?.id ?? 'new'}>
              <input type="hidden" name="typeId" value={type.id} />
              {edit && <input type="hidden" name="id" value={edit.id} />}
              <div className="grid grid-cols-[110px_1fr] gap-2">
                <div>
                  <label className="label">کد</label>
                  <input name="code" dir="ltr" className="input" defaultValue={edit?.code} required />
                </div>
                <div>
                  <label className="label">نام</label>
                  <input name="name" className="input" defaultValue={edit?.name} required />
                </div>
              </div>
              {type.isHierarchical && (
                <div>
                  <label className="label">والد</label>
                  <select name="parentId" className="input" defaultValue={edit?.parentId ?? ''}>
                    <option value="">— ریشه —</option>
                    {parents.filter((p) => p.id !== edit?.id).map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="label">محدودهٔ استفاده</label>
                <select name="entityId" className="input" defaultValue={edit?.entityId ?? ''}>
                  <option value="">همهٔ شرکت‌های مجموعه</option>
                  {entities.map((e) => <option key={e.id} value={e.id}>فقط {e.name}</option>)}
                </select>
              </div>
              {isBusiness && (
                <div className="space-y-2 rounded-lg bg-slate-50 p-3">
                  <div className="text-xs font-semibold text-slate-600">مشخصات کسب‌وکار</div>
                  <input type="hidden" name="businessEntityId" value={edit?.businessUnit?.entityId ?? entity.id} />
                  <select name="kind" className="input" defaultValue={edit?.businessUnit?.kind ?? 'WEBSITE'}>
                    {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                  <input name="domain" dir="ltr" placeholder="example.ir" className="input" defaultValue={edit?.businessUnit?.domain ?? ''} />
                  <input name="launchedAt" dir="ltr" placeholder="تاریخ راه‌اندازی 1405/01/01" className="input" defaultValue={edit?.businessUnit?.launchedAt ? formatJ(edit.businessUnit.launchedAt, false) : ''} />
                </div>
              )}
              <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="active" defaultChecked={edit ? edit.active : true} /> فعال</label>
            </ActionForm>
            {edit && (
              <div className="mt-3 border-t border-line pt-3">
                <ActionForm action={deleteDimensionValueAction.bind(null, edit.id)} submitLabel="حذف" variant="danger" size="sm" confirm="حذف شود؟" />
              </div>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
