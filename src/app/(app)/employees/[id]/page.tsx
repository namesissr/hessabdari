import Link from 'next/link';
import { notFound } from 'next/navigation';
import prisma from '@/lib/prisma';
import { assertEntityAccess, can } from '@/lib/auth';
import { dateToJ, formatJ, toFaDigits, todayUtc } from '@/lib/jalali';
import { one, pageContext, type SP } from '@/lib/page';
import { CONTRACT_LABEL, LEAVE_LABEL, STATUS_LABEL, employeeProfile } from '@/modules/hr/employees';
import { employeeYearSummary } from '@/modules/hr/payroll';
import { Badge, Card, Empty, LinkButton, Money, PageHeader, Stat } from '@/components/ui';
import { ActionForm } from '@/components/action-form';
import { JDateInput } from '@/components/jdate-input';
import { cn } from '@/lib/utils';
import { EmployeeForm } from '../employee-form';
import { addContractAction, addLeaveAction, addLoanAction, cancelLoanAction, deleteLeaveAction } from '../actions';

export const metadata = { title: 'پروندهٔ کارمند' };

const TABS = [
  { key: 'overview', label: 'خلاصه' },
  { key: 'payslips', label: 'فیش‌های حقوقی' },
  { key: 'contracts', label: 'احکام و قراردادها' },
  { key: 'loans', label: 'وام و مساعده' },
  { key: 'leaves', label: 'مرخصی و مأموریت' },
  { key: 'edit', label: 'ویرایش پرونده' },
];

export default async function EmployeePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { id } = await params;
  const sp = await searchParams;
  const { user, entity } = await pageContext();
  const emp = await employeeProfile(prisma, id);
  if (!emp) notFound();
  assertEntityAccess(user, emp.entityId);
  const editable = can(user, 'voucher.edit');
  const tab = one(sp.tab) || 'overview';

  const today = todayUtc();
  const { jy } = dateToJ(today);
  const [banks, year, dims] = await Promise.all([
    prisma.bankAccount.findMany({ where: { entityId: emp.entityId, active: true }, include: { dimensionValue: true } }),
    employeeYearSummary(prisma, emp.id, jy),
    prisma.dimensionValue.findMany({ where: { id: { in: [emp.businessDimId, emp.costCenterDimId].filter(Boolean) as string[] } } }),
  ]);
  const dimName = new Map(dims.map((d) => [d.id, d.name]));

  const totalMonthly = emp.baseSalary + emp.housingAllowance + emp.foodAllowance + emp.transportAllowance + emp.otherAllowance;
  const openLoans = emp.loans.filter((l) => l.status === 'ACTIVE');
  const loanRemaining = openLoans.reduce((s, l) => s + (l.amount - l.paidAmount), 0n);
  const severanceTotal = emp.payslips.filter((p) => p.run.status === 'POSTED').reduce((s, p) => s + p.severanceAccrual, 0n);
  const serviceStart = emp.severanceStartDate ?? emp.hireDate;
  const serviceYears = ((today.getTime() - serviceStart.getTime()) / (365.25 * 86400000)).toFixed(1);
  const annualLeaveUsed = emp.leaves.filter((l) => l.type === 'ANNUAL' && dateToJ(l.fromDate).jy === jy).reduce((s, l) => s + Number(l.days), 0);

  return (
    <>
      <PageHeader
        title={`${emp.firstName} ${emp.lastName}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={emp.status === 'ACTIVE' ? 'green' : emp.status === 'TERMINATED' ? 'gray' : 'amber'}>{STATUS_LABEL[emp.status]}</Badge>
            <span className="num">کد {toFaDigits(emp.code)}</span>
            {emp.position && <span>{emp.position}</span>}
            <span className="text-xs">استخدام {formatJ(emp.hireDate)} — {toFaDigits(serviceYears)} سال سابقه</span>
          </span>
        }
        actions={
          <>
            <LinkButton href={`/reports/ledger?dim=${emp.party.dimensionValueId}`}>گردش حساب</LinkButton>
            <LinkButton href="/employees">فهرست کارکنان</LinkButton>
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="حقوق و مزایای ماهانه" value={totalMonthly} hint={`پایه ${toFaDigits((Number(emp.baseSalary) / 10_000_000).toFixed(1))} میلیون تومان`} />
        <Stat label={`جمع دریافتی ${toFaDigits(jy)}`} value={year.totals.net} hint={`ناخالص ${(Number(year.totals.gross) / 1e9).toFixed(1)} میلیارد ریال`} />
        <Stat label="ذخیرهٔ سنوات" value={severanceTotal} hint="انباشته از فیش‌های قطعی" />
        <Stat label="ماندهٔ وام و مساعده" value={loanRemaining} tone={loanRemaining > 0n ? 'red' : undefined} hint={`${toFaDigits(openLoans.length)} مورد باز`} />
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.filter((t) => t.key !== 'edit' || editable).map((t) => (
          <Link key={t.key} href={`?tab=${t.key}`} className={cn('rounded-lg border px-3 py-1.5 text-sm', tab === t.key ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-white hover:bg-slate-50')}>
            {t.label}
          </Link>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="اطلاعات فردی">
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div><dt className="text-muted">کد ملی</dt><dd className="num">{emp.nationalCode ? toFaDigits(emp.nationalCode) : '—'}</dd></div>
              <div><dt className="text-muted">شمارهٔ شناسنامه</dt><dd className="num">{emp.idNumber ? toFaDigits(emp.idNumber) : '—'}</dd></div>
              <div><dt className="text-muted">نام پدر</dt><dd>{emp.fatherName ?? '—'}</dd></div>
              <div><dt className="text-muted">تاریخ تولد</dt><dd>{emp.birthDate ? formatJ(emp.birthDate) : '—'}</dd></div>
              <div><dt className="text-muted">وضعیت تأهل</dt><dd>{emp.maritalStatus === 'MARRIED' ? 'متأهل' : 'مجرد'} — {toFaDigits(emp.childrenCount)} فرزند</dd></div>
              <div><dt className="text-muted">موبایل</dt><dd className="num">{emp.mobile ? toFaDigits(emp.mobile) : '—'}</dd></div>
              <div className="sm:col-span-2"><dt className="text-muted">نشانی</dt><dd>{emp.address ?? '—'}</dd></div>
              <div><dt className="text-muted">تماس اضطراری</dt><dd>{emp.emergencyName ?? '—'} {emp.emergencyPhone ? `— ${toFaDigits(emp.emergencyPhone)}` : ''}</dd></div>
            </dl>
          </Card>

          <Card title="اطلاعات شغلی و بیمه">
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div><dt className="text-muted">نوع قرارداد</dt><dd>{CONTRACT_LABEL[emp.contractType]}</dd></div>
              <div><dt className="text-muted">مدیر مستقیم</dt><dd>{emp.manager ? `${emp.manager.firstName} ${emp.manager.lastName}` : '—'}</dd></div>
              <div><dt className="text-muted">کسب‌وکار</dt><dd>{emp.businessDimId ? dimName.get(emp.businessDimId) : '—'}</dd></div>
              <div><dt className="text-muted">مرکز هزینه</dt><dd>{emp.costCenterDimId ? dimName.get(emp.costCenterDimId) : '—'}</dd></div>
              <div><dt className="text-muted">شمارهٔ بیمه</dt><dd className="num">{emp.insuranceNo ? toFaDigits(emp.insuranceNo) : '—'}</dd></div>
              <div><dt className="text-muted">وضعیت بیمه</dt><dd>{emp.insured ? 'مشمول بیمه' : 'بدون بیمه'}{emp.taxExempt ? ' — معاف از مالیات' : ''}</dd></div>
              <div><dt className="text-muted">مبنای سنوات</dt><dd>{formatJ(serviceStart)}</dd></div>
              <div><dt className="text-muted">مرخصی استحقاقی استفاده‌شده</dt><dd>{toFaDigits(annualLeaveUsed)} روز در {toFaDigits(jy)}</dd></div>
              <div className="sm:col-span-2"><dt className="text-muted">حساب بانکی</dt><dd className="num" dir="ltr">{emp.iban ?? emp.accountNo ?? '—'} {emp.bankName ? `(${emp.bankName})` : ''}</dd></div>
              {emp.notes && <div className="sm:col-span-2"><dt className="text-muted">یادداشت</dt><dd>{emp.notes}</dd></div>}
            </dl>
          </Card>

          <Card title="ساختار حقوق جاری" bodyClass="p-0">
            <table className="table">
              <tbody>
                <tr><td>حقوق پایه</td><td><Money value={emp.baseSalary} /></td></tr>
                <tr><td>حق مسکن</td><td><Money value={emp.housingAllowance} zero="پیش‌فرض سال" /></td></tr>
                <tr><td>بن خواربار</td><td><Money value={emp.foodAllowance} zero="پیش‌فرض سال" /></td></tr>
                <tr><td>حق اولاد</td><td><Money value={emp.childAllowance} zero="بر اساس تعداد فرزند" /></td></tr>
                <tr><td>ایاب و ذهاب</td><td><Money value={emp.transportAllowance} /></td></tr>
                <tr><td>سایر مزایا</td><td><Money value={emp.otherAllowance} /></td></tr>
              </tbody>
              <tfoot><tr><td>جمع ماهانه</td><td><Money value={totalMonthly} /></td></tr></tfoot>
            </table>
          </Card>

          <Card title={`خلاصهٔ سال ${toFaDigits(jy)}`} bodyClass="p-0">
            <table className="table">
              <tbody>
                <tr><td>تعداد فیش قطعی‌شده</td><td>{toFaDigits(year.items.length)}</td></tr>
                <tr><td>جمع ناخالص</td><td><Money value={year.totals.gross} /></td></tr>
                <tr><td>جمع اضافه‌کار</td><td><Money value={year.totals.overtime} /></td></tr>
                <tr><td>بیمهٔ سهم کارمند</td><td><Money value={year.totals.insurance} /></td></tr>
                <tr><td>بیمهٔ سهم کارفرما</td><td><Money value={year.totals.employerInsurance} /></td></tr>
                <tr><td>مالیات حقوق</td><td><Money value={year.totals.tax} /></td></tr>
                <tr><td>ذخیرهٔ سنوات سال</td><td><Money value={year.totals.severance} /></td></tr>
              </tbody>
              <tfoot><tr><td>خالص پرداختی</td><td><Money value={year.totals.net} /></td></tr></tfoot>
            </table>
          </Card>
        </div>
      )}

      {tab === 'payslips' && (
        <Card bodyClass="p-0">
          {emp.payslips.length === 0 ? (
            <div className="p-4"><Empty>هنوز فیش حقوقی برای این کارمند صادر نشده است.</Empty></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr><th>ماه</th><th>کارکرد</th><th>ناخالص</th><th>بیمه</th><th>مالیات</th><th>کسورات</th><th>خالص</th><th>سنوات</th><th>وضعیت</th><th /></tr>
                </thead>
                <tbody>
                  {emp.payslips.map((p) => (
                    <tr key={p.id}>
                      <td>{p.run.title}</td>
                      <td className="num">{toFaDigits(Number(p.workingDays))}</td>
                      <td><Money value={p.grossEarnings} /></td>
                      <td><Money value={p.insuranceEmployee} /></td>
                      <td><Money value={p.tax} /></td>
                      <td><Money value={p.totalDeductions} /></td>
                      <td className="font-semibold"><Money value={p.netPay} /></td>
                      <td><Money value={p.severanceAccrual} /></td>
                      <td><Badge tone={p.run.status === 'POSTED' ? 'green' : 'amber'}>{p.run.status === 'POSTED' ? 'قطعی' : 'پیش‌نویس'}</Badge></td>
                      <td><Link className="text-xs text-brand-700 hover:underline" href={`/print/payslip/${p.id}`}>فیش حقوقی</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === 'contracts' && (
        <div className="grid gap-4 xl:grid-cols-[1fr_400px]">
          <Card title="تاریخچهٔ احکام" bodyClass="p-0">
            <table className="table">
              <thead><tr><th>از تاریخ</th><th>تا تاریخ</th><th>نوع</th><th>سمت</th><th>حقوق پایه</th><th>مزایا</th><th>توضیح</th></tr></thead>
              <tbody>
                {emp.contracts.map((c) => (
                  <tr key={c.id}>
                    <td className="whitespace-nowrap">{formatJ(c.startDate)}</td>
                    <td className="whitespace-nowrap">{c.endDate ? formatJ(c.endDate) : '—'}</td>
                    <td className="text-xs">{CONTRACT_LABEL[c.contractType]}</td>
                    <td className="text-xs">{c.position ?? '—'}</td>
                    <td><Money value={c.baseSalary} /></td>
                    <td className="text-xs"><Money value={c.housingAllowance + c.foodAllowance + c.transportAllowance + c.otherAllowance} /></td>
                    <td className="text-xs text-muted">{c.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          {editable && (
            <Card title="ثبت حکم جدید">
              <ActionForm action={addContractAction.bind(null, emp.id)} submitLabel="ثبت حکم" size="sm">
                <div><label className="label">از تاریخ *</label><JDateInput name="startDate" required /></div>
                <div><label className="label">تا تاریخ</label><JDateInput name="endDate" /></div>
                <div>
                  <label className="label">نوع قرارداد</label>
                  <select name="contractType" className="input" defaultValue={emp.contractType}>
                    {Object.entries(CONTRACT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div><label className="label">سمت</label><input name="position" className="input" defaultValue={emp.position ?? ''} /></div>
                <div><label className="label">حقوق پایه</label><input name="baseSalary" dir="ltr" className="input num" defaultValue={emp.baseSalary.toString()} /></div>
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="label">حق مسکن</label><input name="housingAllowance" dir="ltr" className="input num" defaultValue={emp.housingAllowance.toString()} /></div>
                  <div><label className="label">بن خواربار</label><input name="foodAllowance" dir="ltr" className="input num" defaultValue={emp.foodAllowance.toString()} /></div>
                  <div><label className="label">ایاب و ذهاب</label><input name="transportAllowance" dir="ltr" className="input num" defaultValue={emp.transportAllowance.toString()} /></div>
                  <div><label className="label">سایر مزایا</label><input name="otherAllowance" dir="ltr" className="input num" defaultValue={emp.otherAllowance.toString()} /></div>
                </div>
                <div><label className="label">توضیح</label><input name="note" className="input" placeholder="افزایش سالانه" /></div>
                <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="apply" defaultChecked /> حقوق جاری کارمند هم به‌روز شود</label>
              </ActionForm>
            </Card>
          )}
        </div>
      )}

      {tab === 'loans' && (
        <div className="grid gap-4 xl:grid-cols-[1fr_400px]">
          <Card title="وام و مساعده" bodyClass="p-0">
            {emp.loans.length === 0 ? (
              <div className="p-4 text-sm text-muted">موردی ثبت نشده است.</div>
            ) : (
              <table className="table">
                <thead><tr><th>تاریخ</th><th>نوع</th><th>مبلغ</th><th>قسط</th><th>پرداخت‌شده</th><th>مانده</th><th>وضعیت</th><th>سند</th><th /></tr></thead>
                <tbody>
                  {emp.loans.map((l) => (
                    <tr key={l.id}>
                      <td className="whitespace-nowrap">{formatJ(l.date)}</td>
                      <td className="text-xs">{l.isAdvance ? 'مساعده' : 'وام'}{l.description ? ` — ${l.description}` : ''}</td>
                      <td><Money value={l.amount} /></td>
                      <td><Money value={l.installmentAmount} /></td>
                      <td><Money value={l.paidAmount} /></td>
                      <td className="font-semibold"><Money value={l.amount - l.paidAmount} /></td>
                      <td><Badge tone={l.status === 'ACTIVE' ? 'blue' : l.status === 'SETTLED' ? 'green' : 'gray'}>{l.status === 'ACTIVE' ? 'جاری' : l.status === 'SETTLED' ? 'تسویه' : 'ابطال'}</Badge></td>
                      <td className="text-xs">{l.voucherId ? <Link className="text-brand-700 hover:underline" href={`/vouchers/${l.voucherId}`}>سند</Link> : '—'}</td>
                      <td>
                        {editable && l.status === 'ACTIVE' && l.paidAmount === 0n && (
                          <ActionForm inline action={cancelLoanAction.bind(null, l.id)} submitLabel="ابطال" variant="ghost" size="sm" confirm="ابطال شود؟" />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          {can(user, 'voucher.post') && (
            <Card title="پرداخت وام یا مساعده">
              <ActionForm action={addLoanAction.bind(null, emp.id)} submitLabel="ثبت" size="sm">
                <div><label className="label">تاریخ *</label><JDateInput name="date" defaultValue={formatJ(today, false)} required /></div>
                <div><label className="label">مبلغ *</label><input name="amount" dir="ltr" className="input num" required /></div>
                <div><label className="label">قسط ماهانه</label><input name="installmentAmount" dir="ltr" className="input num" placeholder="برای مساعده خالی بگذارید" /></div>
                <div>
                  <label className="label">پرداخت از حساب</label>
                  <select name="bankAccountId" className="input">
                    <option value="">بدون سند (فقط ثبت تعهد)</option>
                    {banks.map((b) => <option key={b.id} value={b.id}>{b.dimensionValue.name}</option>)}
                  </select>
                </div>
                <div><label className="label">توضیح</label><input name="description" className="input" /></div>
                <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="isAdvance" /> مساعده (یک‌جا از حقوق همان ماه کسر شود)</label>
                <p className="text-xs text-muted">اقساط به‌صورت خودکار در لیست حقوق ماه بعد کسر می‌شوند.</p>
              </ActionForm>
            </Card>
          )}
        </div>
      )}

      {tab === 'leaves' && (
        <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
          <Card title="مرخصی و مأموریت" bodyClass="p-0">
            {emp.leaves.length === 0 ? (
              <div className="p-4 text-sm text-muted">موردی ثبت نشده است.</div>
            ) : (
              <table className="table">
                <thead><tr><th>نوع</th><th>از</th><th>تا</th><th>روز</th><th>توضیح</th><th /></tr></thead>
                <tbody>
                  {emp.leaves.map((l) => (
                    <tr key={l.id}>
                      <td><Badge tone={l.type === 'UNPAID' ? 'amber' : 'gray'}>{LEAVE_LABEL[l.type]}</Badge></td>
                      <td className="whitespace-nowrap">{formatJ(l.fromDate)}</td>
                      <td className="whitespace-nowrap">{formatJ(l.toDate)}</td>
                      <td className="num">{toFaDigits(Number(l.days))}</td>
                      <td className="text-xs text-muted">{l.note}</td>
                      <td>{editable && <ActionForm inline action={deleteLeaveAction.bind(null, l.id)} submitLabel="حذف" variant="ghost" size="sm" confirm="حذف شود؟" />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          {editable && (
            <Card title="ثبت مرخصی">
              <ActionForm action={addLeaveAction.bind(null, emp.id)} submitLabel="ثبت" size="sm">
                <div>
                  <label className="label">نوع</label>
                  <select name="type" className="input">
                    {Object.entries(LEAVE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div><label className="label">از تاریخ *</label><JDateInput name="fromDate" required /></div>
                <div><label className="label">تا تاریخ *</label><JDateInput name="toDate" required /></div>
                <div><label className="label">تعداد روز</label><input name="days" dir="ltr" type="number" step="0.5" className="input" placeholder="خودکار" /></div>
                <div><label className="label">توضیح</label><input name="note" className="input" /></div>
                <p className="text-xs text-muted">مرخصی بدون حقوق را هنگام تنظیم کارکرد در لیست حقوق به عنوان «غیبت» وارد کنید.</p>
              </ActionForm>
            </Card>
          )}
        </div>
      )}

      {tab === 'edit' && editable && (
        <>
          <p className="mb-3 text-xs text-muted">تغییر حقوق از اینجا روی ماه‌های آینده اثر می‌گذارد؛ برای ثبت تاریخچه، از تب «احکام» استفاده کنید.</p>
          <EmployeeForm entityId={emp.entityId} employee={emp} />
        </>
      )}
    </>
  );
}
