import Link from 'next/link';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { can } from '@/lib/auth';
import { toFaDigits } from '@/lib/jalali';
import { one, pageContext, type SP } from '@/lib/page';
import { PARTY_ROLES } from '@/modules/treasury/masters';
import { Badge, Card, Empty, Money, PageHeader } from '@/components/ui';
import { ActionForm } from '@/components/action-form';
import { cn } from '@/lib/utils';
import { deletePartyAction, savePartyAction } from './actions';

export const metadata = { title: 'طرف حساب‌ها' };

export default async function PartiesPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { user, entity, entities } = await pageContext();
  if (!entity) return <Empty>ابتدا شرکت را تعریف کنید.</Empty>;
  const editable = can(user, 'voucher.edit');
  const q = one(sp.q).trim();
  const role = one(sp.role);

  const where: Prisma.PartyWhereInput = {
    ...(role ? { roles: { has: role } } : {}),
    ...(q
      ? {
          OR: [
            { dimensionValue: { name: { contains: q, mode: 'insensitive' } } },
            { dimensionValue: { code: { contains: q, mode: 'insensitive' } } },
            { nationalCode: { contains: q } },
            { mobile: { contains: q } },
          ],
        }
      : {}),
  };
  const parties = await prisma.party.findMany({ where, include: { dimensionValue: true }, orderBy: { dimensionValue: { name: 'asc' } }, take: 300 });
  const edit = one(sp.edit) ? await prisma.party.findUnique({ where: { id: one(sp.edit) }, include: { dimensionValue: true } }) : null;

  // ماندهٔ حساب هر طرف حساب (دریافتنی مثبت، پرداختنی منفی)
  const balances = new Map<string, bigint>(
    (
      await prisma.$queryRaw<{ valueId: string; balance: bigint }[]>`
        SELECT i."valueId", COALESCE(SUM(l."debit" - l."credit"), 0)::bigint AS balance
        FROM "voucher_lines" l
        JOIN "vouchers" v ON v.id = l."voucherId"
        JOIN "dimension_set_items" i ON i."setId" = l."dimensionSetId"
        JOIN "dimension_types" t ON t.id = i."typeId" AND t."code" = 'PARTY'
        WHERE v."status" = 'POSTED' AND v."entityId" = ${entity.id} AND v."type"::text <> 'CLOSING'
        GROUP BY i."valueId"`
    ).map((r) => [r.valueId, r.balance]),
  );

  return (
    <>
      <PageHeader title="طرف حساب‌ها" subtitle="مشتری، تأمین‌کننده، کارمند، سهامدار و… — هر طرف حساب خودکار به تفصیلی حسابداری وصل می‌شود." />
      <div className="grid gap-4 xl:grid-cols-[1fr_400px]">
        <div className="space-y-4">
          <Card>
            <form className="grid gap-3 md:grid-cols-4">
              <div className="md:col-span-2">
                <label className="label">جستجو (نام، کد، کد ملی، موبایل)</label>
                <input name="q" defaultValue={q} className="input" />
              </div>
              <div>
                <label className="label">نقش</label>
                <select name="role" defaultValue={role} className="input">
                  <option value="">همه</option>
                  {Object.entries(PARTY_ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div className="flex items-end">
                <button className="rounded-lg bg-slate-800 px-4 py-2 text-sm text-white">فیلتر</button>
              </div>
            </form>
          </Card>
          <Card bodyClass="p-0">
            {parties.length === 0 ? (
              <div className="p-4"><Empty>طرف حسابی ثبت نشده است.</Empty></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr><th>کد</th><th>نام</th><th>نقش‌ها</th><th>تماس</th><th>مانده (ریال)</th><th>وضعیت</th></tr>
                  </thead>
                  <tbody>
                    {parties.map((p) => {
                      const bal = balances.get(p.dimensionValueId) ?? 0n;
                      return (
                        <tr key={p.id} className={cn(p.id === edit?.id && 'bg-brand-50', !p.active && 'text-slate-400')}>
                          <td className="num">{p.dimensionValue.code}</td>
                          <td>
                            {editable ? <Link className="hover:text-brand-700" href={`?edit=${p.id}`}>{p.dimensionValue.name}</Link> : p.dimensionValue.name}
                            {p.nationalCode && <div className="text-xs text-muted num">{toFaDigits(p.nationalCode)}</div>}
                          </td>
                          <td className="text-xs">{p.roles.map((r) => PARTY_ROLES[r] ?? r).join('، ') || '—'}</td>
                          <td className="text-xs num">{p.mobile ?? p.phone ?? '—'}</td>
                          <td>
                            <Link href={`/reports/ledger?dim=${p.dimensionValueId}`} className="hover:underline">
                              <Money value={bal} colored />
                              <span className="mr-1 text-xs text-muted">{bal > 0n ? 'بدهکار' : bal < 0n ? 'بستانکار' : ''}</span>
                            </Link>
                          </td>
                          <td><Badge tone={p.active ? 'green' : 'gray'}>{p.active ? 'فعال' : 'غیرفعال'}</Badge></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        {editable && (
          <Card title={edit ? `ویرایش ${edit.dimensionValue.name}` : 'طرف حساب جدید'} actions={edit ? <Link href="?" className="text-xs text-brand-700">+ جدید</Link> : null}>
            <ActionForm action={savePartyAction} submitLabel={edit ? 'ذخیره' : 'افزودن'} key={edit?.id ?? 'new'} resetOnSuccess={!edit}>
              {edit && <input type="hidden" name="id" value={edit.id} />}
              <div className="grid grid-cols-[110px_1fr] gap-2">
                <div>
                  <label className="label">کد</label>
                  <input name="code" dir="ltr" className="input" defaultValue={edit?.dimensionValue.code} placeholder="خودکار" />
                </div>
                <div>
                  <label className="label">نام *</label>
                  <input name="name" className="input" defaultValue={edit?.dimensionValue.name} required />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label">نوع</label>
                  <select name="kind" className="input" defaultValue={edit?.kind ?? 'COMPANY'}>
                    <option value="COMPANY">حقوقی (شرکت)</option>
                    <option value="PERSON">حقیقی</option>
                  </select>
                </div>
                <div>
                  <label className="label">کد/شناسهٔ ملی</label>
                  <input name="nationalCode" dir="ltr" inputMode="numeric" className="input" defaultValue={edit?.nationalCode ?? ''} />
                </div>
                <div>
                  <label className="label">کد اقتصادی</label>
                  <input name="economicCode" dir="ltr" className="input" defaultValue={edit?.economicCode ?? ''} />
                </div>
                <div>
                  <label className="label">شمارهٔ ثبت</label>
                  <input name="registrationNo" dir="ltr" className="input" defaultValue={edit?.registrationNo ?? ''} />
                </div>
                <div>
                  <label className="label">موبایل</label>
                  <input name="mobile" dir="ltr" className="input" defaultValue={edit?.mobile ?? ''} />
                </div>
                <div>
                  <label className="label">تلفن</label>
                  <input name="phone" dir="ltr" className="input" defaultValue={edit?.phone ?? ''} />
                </div>
              </div>
              <div>
                <label className="label">نقش‌ها</label>
                <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
                  {Object.entries(PARTY_ROLES).map(([k, v]) => (
                    <label key={k} className="flex items-center gap-1.5">
                      <input type="checkbox" name="roles" value={k} defaultChecked={edit?.roles.includes(k)} /> {v}
                    </label>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label">بانک</label>
                  <input name="bankName" className="input" defaultValue={edit?.bankName ?? ''} />
                </div>
                <div>
                  <label className="label">شمارهٔ حساب</label>
                  <input name="accountNo" dir="ltr" className="input" defaultValue={edit?.accountNo ?? ''} />
                </div>
              </div>
              <div>
                <label className="label">شبا</label>
                <input name="iban" dir="ltr" className="input" placeholder="IR000000000000000000000000" defaultValue={edit?.iban ?? ''} />
              </div>
              <div>
                <label className="label">نشانی</label>
                <input name="address" className="input" defaultValue={edit?.address ?? ''} />
              </div>
              <div>
                <label className="label">یادداشت</label>
                <input name="notes" className="input" defaultValue={edit?.notes ?? ''} />
              </div>
              <div>
                <label className="label">محدودهٔ استفاده</label>
                <select name="entityId" className="input" defaultValue={edit?.entityId ?? ''}>
                  <option value="">همهٔ شرکت‌های مجموعه</option>
                  {entities.map((e) => <option key={e.id} value={e.id}>فقط {e.name}</option>)}
                </select>
              </div>
              <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="active" defaultChecked={edit ? edit.active : true} /> فعال</label>
            </ActionForm>
            {edit && can(user, 'settings.accounting') && (
              <div className="mt-3 border-t border-line pt-3">
                <ActionForm inline action={deletePartyAction.bind(null, edit.id)} submitLabel="حذف" variant="danger" size="sm" confirm="حذف شود؟" />
              </div>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
