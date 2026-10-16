import prisma from '@/lib/prisma';
import { can } from '@/lib/auth';
import { formatJ, todayUtc } from '@/lib/jalali';
import { one, pageContext, type SP } from '@/lib/page';
import { Card, Empty, PageHeader } from '@/components/ui';
import { ActionForm } from '@/components/action-form';
import { JDateInput } from '@/components/jdate-input';
import { saveChequeAction } from '../actions';

export const metadata = { title: 'ثبت چک' };

export default async function NewChequePage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { user, entity } = await pageContext();
  if (!entity) return <Empty>ابتدا شرکت را تعریف کنید.</Empty>;
  if (!can(user, 'voucher.edit')) return <Empty>دسترسی ندارید.</Empty>;
  const direction = one(sp.direction) === 'RECEIVED' ? 'RECEIVED' : 'ISSUED';
  const isIssued = direction === 'ISSUED';

  const [parties, banks, books, businesses] = await Promise.all([
    prisma.party.findMany({ where: { active: true, OR: [{ entityId: null }, { entityId: entity.id }] }, include: { dimensionValue: true }, orderBy: { dimensionValue: { name: 'asc' } } }),
    prisma.bankAccount.findMany({ where: { entityId: entity.id, active: true }, include: { dimensionValue: true }, orderBy: { dimensionValue: { code: 'asc' } } }),
    prisma.chequeBook.findMany({ where: { active: true, bankAccount: { entityId: entity.id } }, include: { bankAccount: { include: { dimensionValue: true } } } }),
    prisma.dimensionValue.findMany({ where: { type: { code: 'BUSINESS' }, active: true }, orderBy: { code: 'asc' } }),
  ]);

  return (
    <>
      <PageHeader
        title={isIssued ? 'ثبت چک پرداختی (صادره توسط ما)' : 'ثبت چک دریافتی'}
        subtitle={
          isIssued
            ? 'برای چکی که بابت پرداخت صادر می‌کنید. معمولاً بهتر است چک را از صفحهٔ «پرداخت» ثبت کنید تا هزینه/بدهی هم هم‌زمان ثبت شود.'
            : 'برای چکی که از مشتری گرفته‌اید. اگر بابت تسویهٔ فاکتور است، از صفحهٔ «دریافت» ثبت کنید.'
        }
      />
      <Card>
        <ActionForm action={saveChequeAction} submitLabel="ثبت چک" className="space-y-4">
          <input type="hidden" name="entityId" value={entity.id} />
          <input type="hidden" name="direction" value={direction} />

          <div className="grid gap-3 md:grid-cols-4">
            <div>
              <label className="label">شمارهٔ چک (سریال) *</label>
              <input name="serialNo" dir="ltr" className="input" required />
            </div>
            <div>
              <label className="label">شناسهٔ صیاد (۱۶ رقم)</label>
              <input name="sayadId" dir="ltr" inputMode="numeric" className="input" />
            </div>
            <div>
              <label className="label">مبلغ (ریال) *</label>
              <input name="amount" dir="ltr" inputMode="numeric" className="input num" required />
            </div>
            <div>
              <label className="label">تاریخ سررسید *</label>
              <JDateInput name="dueDate" required />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <div>
              <label className="label">تاریخ صدور</label>
              <JDateInput name="issueDate" defaultValue={formatJ(todayUtc(), false)} />
            </div>
            <div className="md:col-span-2">
              <label className="label">{isIssued ? 'در وجه (طرف حساب)' : 'دریافت از (طرف حساب)'}</label>
              <select name="partyId" className="input">
                <option value="">— انتخاب کنید —</option>
                {parties.map((p) => <option key={p.id} value={p.id}>{p.dimensionValue.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">نام روی چک (اگر با نام طرف حساب فرق دارد)</label>
              <input name="counterpartyName" className="input" />
            </div>
          </div>

          {isIssued ? (
            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <label className="label">از حساب بانکی ما *</label>
                <select name="bankAccountId" className="input" required>
                  <option value="">— انتخاب کنید —</option>
                  {banks.filter((b) => b.kind === 'BANK').map((b) => <option key={b.id} value={b.id}>{b.dimensionValue.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">دسته‌چک</label>
                <select name="chequeBookId" className="input">
                  <option value="">—</option>
                  {books.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.bankAccount.dimensionValue.name})</option>)}
                </select>
              </div>
              <div>
                <label className="label">نام بانک (برای چاپ)</label>
                <input name="bankName" className="input" />
              </div>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-4">
              <div>
                <label className="label">بانک صادرکننده</label>
                <input name="bankName" className="input" />
              </div>
              <div>
                <label className="label">شعبه</label>
                <input name="branch" className="input" />
              </div>
              <div>
                <label className="label">شمارهٔ حساب صادرکننده</label>
                <input name="accountNo" dir="ltr" className="input" />
              </div>
              <div>
                <label className="label">صاحب حساب</label>
                <input name="drawerName" className="input" />
              </div>
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-3">
            <div className="md:col-span-2">
              <label className="label">بابت</label>
              <input name="description" className="input" placeholder="مثلاً بابت فاکتور ۱۰۲" />
            </div>
            <div>
              <label className="label">کسب‌وکار</label>
              <select name="businessDimId" className="input">
                <option value="">—</option>
                {businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap gap-6 rounded-lg bg-slate-50 p-3 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" name="isGuarantee" /> چک تضمینی است (فقط در حساب‌های انتظامی ثبت می‌شود)</label>
            {can(user, 'voucher.post') && (
              <label className="flex items-center gap-2"><input type="checkbox" name="post" defaultChecked /> سند حسابداری هم صادر شود</label>
            )}
          </div>
          <p className="text-xs text-muted">
            سند خودکار: چک دریافتی → بدهکار «اسناد دریافتنی» و بستانکار «حساب‌های دریافتنی تجاری» طرف حساب؛ چک پرداختی → بدهکار «حساب‌های پرداختنی» و بستانکار «اسناد پرداختنی».
          </p>
        </ActionForm>
      </Card>
    </>
  );
}
