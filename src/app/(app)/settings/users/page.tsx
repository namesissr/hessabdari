import Link from 'next/link';
import prisma from '@/lib/prisma';
import { can, ROLE_LABELS } from '@/lib/auth';
import { formatJ } from '@/lib/jalali';
import { one, pageContext, type SP } from '@/lib/page';
import { Badge, Card, Empty, PageHeader } from '@/components/ui';
import { ActionForm } from '@/components/action-form';
import { cn } from '@/lib/utils';
import { saveUserAction } from '../actions';

export const metadata = { title: 'کاربران' };

export default async function UsersPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { user } = await pageContext();
  if (!can(user, 'users.manage')) return <Empty>دسترسی ندارید.</Empty>;
  const users = await prisma.user.findMany({ orderBy: { createdAt: 'asc' }, include: { scopes: { include: { entity: true } } } });
  const entities = await prisma.entity.findMany({ orderBy: { code: 'asc' } });
  const edit = users.find((u) => u.id === one(sp.edit)) ?? null;
  const editScopes = new Set(edit?.scopes.map((s) => s.entityId) ?? []);

  return (
    <>
      <PageHeader title="کاربران و دسترسی‌ها" subtitle="حسابدار: ثبت و ویرایش یادداشت — مدیر مالی: قطعی کردن، برگشت، قفل دوره و بستن سال — مدیر سیستم: همه‌چیز." />
      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <Card bodyClass="p-0">
          <table className="table">
            <thead>
              <tr><th>نام</th><th>ایمیل</th><th>نقش</th><th>شرکت‌های مجاز</th><th>آخرین ورود</th><th>وضعیت</th></tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className={cn(u.id === edit?.id && 'bg-brand-50')}>
                  <td><Link className="hover:text-brand-700" href={`?edit=${u.id}`}>{u.name}</Link></td>
                  <td dir="ltr" className="text-left text-xs">{u.email}</td>
                  <td>{ROLE_LABELS[u.role]}</td>
                  <td className="text-xs">{u.scopes.length ? u.scopes.map((s) => s.entity?.name).join('، ') : 'همه'}</td>
                  <td className="text-xs">{u.lastLoginAt ? formatJ(u.lastLoginAt) : '—'}</td>
                  <td><Badge tone={u.active ? 'green' : 'gray'}>{u.active ? 'فعال' : 'غیرفعال'}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title={edit ? `ویرایش ${edit.name}` : 'کاربر جدید'} actions={edit ? <Link href="?" className="text-xs text-brand-700">+ جدید</Link> : null}>
          <ActionForm action={saveUserAction} submitLabel={edit ? 'ذخیره' : 'ایجاد کاربر'} key={edit?.id ?? 'new'} resetOnSuccess={!edit}>
            {edit && <input type="hidden" name="id" value={edit.id} />}
            <div><label className="label">نام</label><input name="name" className="input" defaultValue={edit?.name} required /></div>
            <div><label className="label">ایمیل</label><input name="email" type="email" dir="ltr" className="input" defaultValue={edit?.email} disabled={!!edit} required={!edit} /></div>
            <div>
              <label className="label">نقش</label>
              <select name="role" className="input" defaultValue={edit?.role ?? 'ACCOUNTANT'}>
                {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="label">{edit ? 'رمز جدید (خالی = بدون تغییر)' : 'رمز عبور (حداقل ۱۰ کاراکتر)'}</label>
              <input name="password" type="password" dir="ltr" className="input" autoComplete="new-password" />
            </div>
            <div>
              <label className="label">محدود به شرکت‌ها (هیچ = همه)</label>
              <div className="space-y-1">
                {entities.map((e) => (
                  <label key={e.id} className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" name="entityIds" value={e.id} defaultChecked={editScopes.has(e.id)} /> {e.name}
                  </label>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="active" defaultChecked={edit ? edit.active : true} /> فعال</label>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
