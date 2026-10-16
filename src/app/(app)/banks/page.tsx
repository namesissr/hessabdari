import Link from 'next/link';
import prisma from '@/lib/prisma';
import { can } from '@/lib/auth';
import { formatJ, toFaDigits, todayUtc } from '@/lib/jalali';
import { one, pageContext, type SP } from '@/lib/page';
import { BANK_KIND_LABEL, bankBalances } from '@/modules/treasury/masters';
import { loadChart } from '@/modules/accounts/chart';
import { Badge, Card, Empty, LinkButton, Money, PageHeader, Stat } from '@/components/ui';
import { ActionForm } from '@/components/action-form';
import { cn } from '@/lib/utils';
import { saveBankAccountAction, saveChequeBookAction } from './actions';

export const metadata = { title: 'بانک، صندوق و تنخواه' };

export default async function BanksPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { user, entity } = await pageContext();
  if (!entity) return <Empty>ابتدا شرکت را تعریف کنید.</Empty>;
  const editable = can(user, 'settings.accounting');

  const [accounts, parties, chart, layouts, books] = await Promise.all([
    prisma.bankAccount.findMany({ where: { entityId: entity.id }, include: { dimensionValue: true, glAccount: true, custodian: { include: { dimensionValue: true } } }, orderBy: { dimensionValue: { code: 'asc' } } }),
    prisma.party.findMany({ where: { active: true }, include: { dimensionValue: true }, orderBy: { dimensionValue: { name: 'asc' } } }),
    loadChart(prisma, entity.chartId),
    prisma.chequeLayout.findMany({ orderBy: { name: 'asc' } }),
    prisma.chequeBook.findMany({ where: { bankAccount: { entityId: entity.id } }, include: { bankAccount: { include: { dimensionValue: true } }, layout: true, _count: { select: { cheques: true } } } }),
  ]);
  const balances = await bankBalances(prisma, [entity.id]);
  const edit = accounts.find((a) => a.id === one(sp.edit)) ?? null;
  const cashAccounts = chart.walk().map((w) => w.account).filter((a) => a.isPostable && a.active && (chart.hasTag(a.id, 'CASH') || a.code.startsWith('11')));
  const total = accounts.reduce((s, a) => s + (balances.get(a.dimensionValueId) ?? 0n), 0n);

  return (
    <>
      <PageHeader
        title="بانک، صندوق و تنخواه"
        subtitle={`${entity.name} — موجودی‌ها تا ${formatJ(todayUtc())}`}
        actions={<LinkButton href="/treasury/new?type=TRANSFER">انتقال بین حساب‌ها</LinkButton>}
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat label="جمع موجودی" value={total} />
        <Stat label="تعداد حساب‌های فعال" value={BigInt(accounts.filter((a) => a.active).length)} hint="بانک، صندوق و تنخواه" />
        <Stat label="دسته‌چک‌های فعال" value={BigInt(books.filter((b) => b.active).length)} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_400px]">
        <div className="space-y-4">
          <Card title="حساب‌ها" bodyClass="p-0">
            {accounts.length === 0 ? (
              <div className="p-4"><Empty>حسابی تعریف نشده است. اولین حساب بانکی را از فرم کنار اضافه کنید.</Empty></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr><th>کد</th><th>نام</th><th>نوع</th><th>بانک / شماره حساب</th><th>حساب معین</th><th>موجودی (ریال)</th><th>وضعیت</th></tr>
                  </thead>
                  <tbody>
                    {accounts.map((a) => (
                      <tr key={a.id} className={cn(a.id === edit?.id && 'bg-brand-50', !a.active && 'text-slate-400')}>
                        <td className="num">{a.dimensionValue.code}</td>
                        <td>
                          {editable ? <Link className="hover:text-brand-700" href={`?edit=${a.id}`}>{a.dimensionValue.name}</Link> : a.dimensionValue.name}
                          {a.custodian && <div className="text-xs text-muted">مسئول: {a.custodian.dimensionValue.name}</div>}
                        </td>
                        <td className="text-xs">{BANK_KIND_LABEL[a.kind]}</td>
                        <td className="text-xs">
                          {a.bankName ?? '—'}
                          {a.accountNo && <div className="num text-muted">{toFaDigits(a.accountNo)}</div>}
                          {a.iban && <div className="num text-muted" dir="ltr">{a.iban}</div>}
                        </td>
                        <td className="text-xs"><span className="num">{a.glAccount.code}</span> {a.glAccount.name}</td>
                        <td>
                          <Link href={`/reports/ledger?dim=${a.dimensionValueId}`} className="hover:underline">
                            <Money value={balances.get(a.dimensionValueId) ?? 0n} colored />
                          </Link>
                        </td>
                        <td><Badge tone={a.active ? 'green' : 'gray'}>{a.active ? 'فعال' : 'بسته'}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="دسته‌چک‌ها" bodyClass="p-0">
            {books.length === 0 ? (
              <div className="p-4 text-sm text-muted">دسته‌چکی ثبت نشده است. با ثبت دسته‌چک، قالب چاپ هر بانک هم مشخص می‌شود.</div>
            ) : (
              <table className="table">
                <thead>
                  <tr><th>نام</th><th>حساب</th><th>سری</th><th>قالب چاپ</th><th>چک‌های صادره</th><th>وضعیت</th></tr>
                </thead>
                <tbody>
                  {books.map((b) => (
                    <tr key={b.id}>
                      <td>{b.name}</td>
                      <td className="text-xs">{b.bankAccount.dimensionValue.name}</td>
                      <td className="num text-xs">{b.serialFrom ?? '—'} تا {b.serialTo ?? '—'}</td>
                      <td className="text-xs">{b.layout?.name ?? 'پیش‌فرض'}</td>
                      <td>{toFaDigits(b._count.cheques)}</td>
                      <td><Badge tone={b.active ? 'green' : 'gray'}>{b.active ? 'فعال' : 'تمام‌شده'}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>

        {editable && (
          <div className="space-y-4">
            <Card title={edit ? `ویرایش ${edit.dimensionValue.name}` : 'حساب جدید'} actions={edit ? <Link href="?" className="text-xs text-brand-700">+ جدید</Link> : null}>
              <ActionForm action={saveBankAccountAction} submitLabel={edit ? 'ذخیره' : 'افزودن'} key={edit?.id ?? 'new'}>
                <input type="hidden" name="entityId" value={entity.id} />
                {edit && <input type="hidden" name="id" value={edit.id} />}
                <div className="grid grid-cols-[110px_1fr] gap-2">
                  <div>
                    <label className="label">کد</label>
                    <input name="code" dir="ltr" className="input" defaultValue={edit?.dimensionValue.code} placeholder="خودکار" />
                  </div>
                  <div>
                    <label className="label">نام حساب *</label>
                    <input name="name" className="input" defaultValue={edit?.dimensionValue.name} placeholder="بانک ملت — جاری ۱۲۳" required />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="label">نوع</label>
                    <select name="kind" className="input" defaultValue={edit?.kind ?? 'BANK'}>
                      {Object.entries(BANK_KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">حساب معین *</label>
                    <select name="glAccountId" className="input" defaultValue={edit?.glAccountId ?? ''} required>
                      <option value="">— انتخاب کنید —</option>
                      {cashAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">بانک</label>
                    <input name="bankName" className="input" defaultValue={edit?.bankName ?? ''} />
                  </div>
                  <div>
                    <label className="label">شعبه</label>
                    <input name="branch" className="input" defaultValue={edit?.branch ?? ''} />
                  </div>
                  <div>
                    <label className="label">شمارهٔ حساب</label>
                    <input name="accountNo" dir="ltr" className="input" defaultValue={edit?.accountNo ?? ''} />
                  </div>
                  <div>
                    <label className="label">شمارهٔ کارت</label>
                    <input name="cardNo" dir="ltr" className="input" defaultValue={edit?.cardNo ?? ''} />
                  </div>
                </div>
                <div>
                  <label className="label">شبا</label>
                  <input name="iban" dir="ltr" className="input" defaultValue={edit?.iban ?? ''} />
                </div>
                <div>
                  <label className="label">مسئول (برای تنخواه)</label>
                  <select name="custodianPartyId" className="input" defaultValue={edit?.custodianPartyId ?? ''}>
                    <option value="">—</option>
                    {parties.map((p) => <option key={p.id} value={p.id}>{p.dimensionValue.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">توضیح</label>
                  <input name="description" className="input" defaultValue={edit?.description ?? ''} />
                </div>
                <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="active" defaultChecked={edit ? edit.active : true} /> فعال</label>
              </ActionForm>
            </Card>

            <Card title="دسته‌چک جدید">
              <ActionForm action={saveChequeBookAction} submitLabel="ثبت دسته‌چک" size="sm" resetOnSuccess>
                <div>
                  <label className="label">حساب بانکی *</label>
                  <select name="bankAccountId" className="input" required defaultValue={edit?.kind === 'BANK' ? edit.id : ''}>
                    <option value="">— انتخاب کنید —</option>
                    {accounts.filter((a) => a.kind === 'BANK').map((a) => <option key={a.id} value={a.id}>{a.dimensionValue.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">نام دسته‌چک *</label>
                  <input name="name" className="input" placeholder="دسته‌چک ۲۵ برگی ملت" required />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="label">از سری</label><input name="serialFrom" dir="ltr" className="input" /></div>
                  <div><label className="label">تا سری</label><input name="serialTo" dir="ltr" className="input" /></div>
                </div>
                <div>
                  <label className="label">قالب چاپ چک</label>
                  <select name="layoutId" className="input">
                    <option value="">پیش‌فرض</option>
                    {layouts.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </div>
                <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="active" defaultChecked /> فعال</label>
              </ActionForm>
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
