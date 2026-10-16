import prisma from '@/lib/prisma';
import { can } from '@/lib/auth';
import { dateToJ, toFaDigits, todayUtc } from '@/lib/jalali';
import { one, pageContext, type SP } from '@/lib/page';
import { payrollSettings, DEFAULT_ACCOUNTS } from '@/modules/hr/settings';
import { Card, Empty, PageHeader } from '@/components/ui';
import { ActionForm } from '@/components/action-form';
import { saveSettingsAction } from '../../payroll/actions';

export const metadata = { title: 'تنظیمات حقوق و دستمزد' };

const ACCOUNT_LABELS: Record<keyof typeof DEFAULT_ACCOUNTS, string> = {
  salaryExpense: 'هزینهٔ حقوق و دستمزد',
  overtimeExpense: 'هزینهٔ اضافه‌کار و پاداش',
  employerInsuranceExpense: 'هزینهٔ بیمهٔ سهم کارفرما',
  severanceExpense: 'هزینهٔ مزایای پایان خدمت',
  salaryPayable: 'حقوق و دستمزد پرداختنی',
  insurancePayable: 'حق بیمهٔ پرداختنی',
  taxPayable: 'مالیات تکلیفی پرداختنی',
  severanceProvision: 'ذخیرهٔ مزایای پایان خدمت',
  employeeLoan: 'وام و مساعدهٔ کارکنان',
};

export default async function PayrollSettingsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { user, entity } = await pageContext();
  if (!entity) return <Empty>ابتدا شرکت را تعریف کنید.</Empty>;
  if (!can(user, 'settings.accounting')) return <Empty>دسترسی ندارید.</Empty>;

  const jy = Number(one(sp.jy)) || dateToJ(todayUtc()).jy;
  const s = await payrollSettings(prisma, entity.id, jy);
  const years = await prisma.payrollSettings.findMany({ where: { entityId: entity.id }, orderBy: { jy: 'desc' }, select: { jy: true } });
  const money = (v: bigint) => v.toString();

  return (
    <>
      <PageHeader
        title="نرخ‌ها و تنظیمات حقوق و دستمزد"
        subtitle={`سال ${toFaDigits(jy)} — این نرخ‌ها هر سال با بخشنامهٔ وزارت کار و قانون بودجه تغییر می‌کنند؛ قبل از اولین لیست حقوق هر سال، این صفحه را به‌روز کنید.`}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <form className="flex items-end gap-2">
          <div>
            <label className="label">سال مالیاتی</label>
            <input name="jy" type="number" className="input num w-28" defaultValue={jy} />
          </div>
          <button className="rounded-lg bg-slate-800 px-4 py-2 text-sm text-white">نمایش</button>
        </form>
        {years.length > 0 && <span className="text-xs text-muted">سال‌های تنظیم‌شده: {years.map((y) => toFaDigits(y.jy)).join('، ')}</span>}
        {!s.id && <span className="rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800">برای این سال هنوز تنظیماتی ذخیره نشده؛ مقادیر نمایش‌داده‌شده پیش‌فرض یا از سال قبل است.</span>}
      </div>

      <ActionForm action={saveSettingsAction} submitLabel="ذخیرهٔ تنظیمات سال" className="space-y-4">
        <input type="hidden" name="entityId" value={entity.id} />
        <input type="hidden" name="jy" value={jy} />

        <Card title="دستمزد و ساعت کار">
          <div className="grid gap-3 md:grid-cols-4">
            <div><label className="label">حداقل دستمزد روزانه (ریال)</label><input name="dailyMinWage" dir="ltr" className="input num" defaultValue={money(s.dailyMinWage)} /></div>
            <div><label className="label">ساعت کاری ماه</label><input name="monthlyWorkHours" dir="ltr" className="input num" defaultValue={s.monthlyWorkHours} /></div>
            <div><label className="label">حق مسکن پیش‌فرض</label><input name="housingDefault" dir="ltr" className="input num" defaultValue={money(s.housingDefault)} /></div>
            <div><label className="label">بن خواربار پیش‌فرض</label><input name="foodDefault" dir="ltr" className="input num" defaultValue={money(s.foodDefault)} /></div>
            <div><label className="label">حق اولاد (هر فرزند)</label><input name="childAllowanceRate" dir="ltr" className="input num" defaultValue={money(s.childAllowanceRate)} /></div>
            <div><label className="label">ضریب اضافه‌کار</label><input name="overtimeFactor" dir="ltr" className="input num" defaultValue={s.overtimeFactor} /></div>
            <div><label className="label">ضریب تعطیل‌کاری</label><input name="holidayFactor" dir="ltr" className="input num" defaultValue={s.holidayFactor} /></div>
            <div><label className="label">ضریب شب‌کاری</label><input name="nightFactor" dir="ltr" className="input num" defaultValue={s.nightFactor} /></div>
          </div>
        </Card>

        <Card title="بیمه و سنوات">
          <div className="grid gap-3 md:grid-cols-4">
            <div><label className="label">سهم کارمند (٪)</label><input name="insuranceEmployeeRate" dir="ltr" className="input num" defaultValue={s.insuranceEmployeeRate} /></div>
            <div><label className="label">سهم کارفرما (٪)</label><input name="insuranceEmployerRate" dir="ltr" className="input num" defaultValue={s.insuranceEmployerRate} /></div>
            <div><label className="label">سقف دستمزد مشمول بیمه</label><input name="insuranceCeiling" dir="ltr" className="input num" defaultValue={money(s.insuranceCeiling)} placeholder="۰ = بدون سقف" /></div>
            <div><label className="label">روزهای سنوات در سال</label><input name="severanceDaysPerYear" dir="ltr" className="input num" defaultValue={s.severanceDaysPerYear} /></div>
          </div>
          <p className="mt-2 text-xs text-muted">حق اولاد و مأموریت مشمول بیمه و مالیات محاسبه نمی‌شوند.</p>
        </Card>

        <Card title="مالیات حقوق">
          <div className="grid gap-3 md:grid-cols-4">
            <div><label className="label">معافیت ماهانه (ریال)</label><input name="taxExemptMonthly" dir="ltr" className="input num" defaultValue={money(s.taxExemptMonthly)} /></div>
          </div>
          <div className="mt-3">
            <div className="label">پلکان مالیات (سقف ماهانه و نرخ)</div>
            <div className="grid gap-2 md:grid-cols-2">
              {Array.from({ length: Math.max(4, s.taxBrackets.length + 1) }).map((_, i) => {
                const b = s.taxBrackets[i];
                return (
                  <div key={i} className="flex items-center gap-2 rounded-md border border-line p-2">
                    <span className="w-16 text-xs text-muted">پلهٔ {toFaDigits(i + 1)}</span>
                    <input name={`bracketTo${i}`} dir="ltr" className="input num" defaultValue={b?.to ?? ''} placeholder="سقف (خالی = مازاد)" />
                    <input name={`bracketRate${i}`} dir="ltr" className="input num w-24" defaultValue={b?.rate ?? ''} placeholder="نرخ ٪" />
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-muted">
              سقف هر پله «درآمد ماهانهٔ مشمول» است و آخرین پله باید بدون سقف بماند. مالیات فقط روی مازاد بر معافیت و به‌صورت پلکانی حساب می‌شود.
            </p>
          </div>
        </Card>

        <Card title="حساب‌های حسابداری حقوق">
          <div className="grid gap-3 md:grid-cols-3">
            {(Object.keys(ACCOUNT_LABELS) as (keyof typeof DEFAULT_ACCOUNTS)[]).map((k) => (
              <div key={k}>
                <label className="label">{ACCOUNT_LABELS[k]}</label>
                <input name={`acc_${k}`} dir="ltr" className="input num" defaultValue={s.accounts[k]} />
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">کد حساب معین در چارت (مثلاً ۸۱۰۱). اگر حساب جدیدی ساختید، کد آن را اینجا بگذارید.</p>
        </Card>
      </ActionForm>
    </>
  );
}
