import Link from 'next/link';
import prisma from '@/lib/prisma';
import { can } from '@/lib/auth';
import { JALALI_MONTHS, addDays, dateToJ, formatJ, jToDate, toFaDigits, todayUtc } from '@/lib/jalali';
import { one, pageContext, type SP } from '@/lib/page';
import { Badge, Card, Empty, PageHeader } from '@/components/ui';
import { ActionForm } from '@/components/action-form';
import { cn } from '@/lib/utils';
import { saveEntityAction } from '../actions';

export const metadata = { title: 'شرکت‌ها' };

export default async function EntitiesPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { user } = await pageContext();
  if (!can(user, 'settings.entities')) return <Empty>دسترسی ندارید.</Empty>;
  const entities = await prisma.entity.findMany({
    orderBy: { code: 'asc' },
    include: { parent: true, _count: { select: { vouchers: true, businessUnits: true } }, fiscalYears: { orderBy: { startDate: 'desc' }, take: 1 } },
  });
  const edit = entities.find((e) => e.id === one(sp.edit)) ?? null;
  const { jy } = dateToJ(todayUtc());

  return (
    <>
      <PageHeader title="شرکت‌ها (شخصیت‌های حقوقی)" subtitle="هر شرکت ثبت‌شده دفتر، سال مالی و شماره‌گذاری اسناد مستقل دارد. کسب‌وکارها و پروژه‌ها زیر شرکت‌ها و از بخش تفصیلی‌ها تعریف می‌شوند." />
      <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
        <Card bodyClass="p-0">
          <table className="table">
            <thead>
              <tr>
                <th>کد</th>
                <th>نام</th>
                <th>شناسهٔ ملی / کد اقتصادی</th>
                <th>شرکت مادر</th>
                <th>کسب‌وکارها</th>
                <th>آخرین سال مالی</th>
                <th>وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {entities.map((e) => (
                <tr key={e.id} className={cn(e.id === edit?.id && 'bg-brand-50')}>
                  <td className="num">{e.code}</td>
                  <td><Link className="hover:text-brand-700" href={`?edit=${e.id}`}>{e.name}</Link><div className="text-xs text-muted">{e.legalType}</div></td>
                  <td className="text-xs">{e.nationalId || '—'} / {e.economicCode || '—'}</td>
                  <td className="text-xs">{e.parent?.name ?? '—'}</td>
                  <td>{toFaDigits(e._count.businessUnits)}</td>
                  <td className="text-xs">{e.fiscalYears[0] ? `${e.fiscalYears[0].title} (${formatJ(e.fiscalYears[0].startDate)})` : '—'}</td>
                  <td><Badge tone={e.status === 'ACTIVE' ? 'green' : 'gray'}>{e.status === 'ACTIVE' ? 'فعال' : 'غیرفعال'}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title={edit ? `ویرایش ${edit.name}` : 'شرکت جدید'} actions={edit ? <Link href="?" className="text-xs text-brand-700">+ جدید</Link> : null}>
          <ActionForm action={saveEntityAction} submitLabel={edit ? 'ذخیره' : 'ایجاد شرکت'} key={edit?.id ?? 'new'}>
            {edit && <input type="hidden" name="id" value={edit.id} />}
            <div className="grid grid-cols-[110px_1fr] gap-2">
              <div><label className="label">کد</label><input name="code" dir="ltr" className="input" defaultValue={edit?.code} disabled={!!edit} placeholder="GOLD" required={!edit} /></div>
              <div><label className="label">نام</label><input name="name" className="input" defaultValue={edit?.name} required /></div>
            </div>
            <div><label className="label">نام ثبتی</label><input name="legalName" className="input" defaultValue={edit?.legalName ?? ''} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="label">نوع شرکت</label><input name="legalType" className="input" placeholder="سهامی خاص" defaultValue={edit?.legalType ?? ''} /></div>
              <div><label className="label">شمارهٔ ثبت</label><input name="registrationNo" dir="ltr" className="input" defaultValue={edit?.registrationNo ?? ''} /></div>
              <div><label className="label">شناسهٔ ملی</label><input name="nationalId" dir="ltr" className="input" defaultValue={edit?.nationalId ?? ''} /></div>
              <div><label className="label">کد اقتصادی</label><input name="economicCode" dir="ltr" className="input" defaultValue={edit?.economicCode ?? ''} /></div>
            </div>
            <div><label className="label">نشانی</label><input name="address" className="input" defaultValue={edit?.address ?? ''} /></div>
            <div>
              <label className="label">شرکت مادر (برای تلفیق)</label>
              <select name="parentId" className="input" defaultValue={edit?.parentId ?? ''}>
                <option value="">—</option>
                {entities.filter((e) => e.id !== edit?.id).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">پیش‌فرض شروع سال مالی (برای پیشنهاد سال‌های بعد)</label>
              <div className="grid grid-cols-2 gap-2">
                <select name="fiscalStartMonth" className="input" defaultValue={edit?.fiscalStartMonth ?? 1}>
                  {JALALI_MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select>
                <input name="fiscalStartDay" type="number" min={1} max={31} className="input" defaultValue={edit?.fiscalStartDay ?? 1} />
              </div>
            </div>
            {!edit && (
              <div className="rounded-lg bg-slate-50 p-3">
                <div className="mb-2 text-xs font-semibold text-slate-600">اولین سال مالی (اختیاری)</div>
                <div className="grid grid-cols-3 gap-2">
                  <input name="fyTitle" className="input" defaultValue={String(jy)} />
                  <input name="fyStart" dir="ltr" className="input" defaultValue={formatJ(jToDate(jy, 1, 1), false)} />
                  <input name="fyEnd" dir="ltr" className="input" defaultValue={formatJ(addDays(jToDate(jy + 1, 1, 1), -1), false)} />
                </div>
              </div>
            )}
            <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="active" defaultChecked={edit ? edit.status === 'ACTIVE' : true} /> فعال</label>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
