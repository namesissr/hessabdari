import Link from 'next/link';
import { notFound } from 'next/navigation';
import prisma from '@/lib/prisma';
import { assertEntityAccess, can } from '@/lib/auth';
import { formatJ, toFaDigits } from '@/lib/jalali';
import { pageContext } from '@/lib/page';
import { Badge, Card, Empty, LinkButton, Money, PageHeader, Stat } from '@/components/ui';
import { ActionForm } from '@/components/action-form';
import { PrintButton } from '@/components/print-button';
import { ExportButton } from '@/components/export-button';
import { deleteRunAction, postRunAction, removeItemAction, updateItemAction } from '../actions';

export const metadata = { title: 'لیست حقوق ماه' };

export default async function PayrollRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user } = await pageContext();
  const run = await prisma.payrollRun.findUnique({
    where: { id },
    include: {
      entity: true,
      createdBy: { select: { name: true } },
      voucher: { include: { reversedBy: true } },
      items: { include: { employee: true }, orderBy: { employee: { code: 'asc' } } },
    },
  });
  if (!run) notFound();
  assertEntityAccess(user, run.entityId);
  const editable = run.status === 'DRAFT' && can(user, 'voucher.edit');
  const totalEmployerInsurance = run.items.reduce((s, i) => s + i.insuranceEmployer, 0n);
  const totalSeverance = run.items.reduce((s, i) => s + i.severanceAccrual, 0n);

  return (
    <>
      <PageHeader
        title={`لیست حقوق ${run.title}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {run.voucher?.reversedBy ? <Badge tone="red">برگشت‌خورده</Badge> : <Badge tone={run.status === 'POSTED' ? 'green' : 'amber'}>{run.status === 'POSTED' ? 'قطعی' : 'پیش‌نویس'}</Badge>}
            <span>{run.entity.name}</span>
            <span className="text-xs">{toFaDigits(run.items.length)} نفر — ساخته‌شده توسط {run.createdBy.name}</span>
          </span>
        }
        actions={
          <>
            {run.status === 'DRAFT' && can(user, 'voucher.post') && (
              <ActionForm inline action={postRunAction.bind(null, run.id)} submitLabel="قطعی کردن و صدور سند" variant="success" confirm="سند حسابداری حقوق صادر و قطعی می‌شود و اقساط وام از ماندهٔ کارکنان کم می‌شود. ادامه؟" />
            )}
            {run.voucherId && <LinkButton href={`/vouchers/${run.voucherId}`}>سند حسابداری</LinkButton>}
            <LinkButton href={`/print/payroll/${run.id}`}>چاپ لیست و فیش‌ها</LinkButton>
            <PrintButton />
            <ExportButton filename={`payroll-${run.jy}-${run.jm}`} />
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="جمع ناخالص" value={run.totalGross} />
        <Stat label="بیمهٔ سهم کارمند و کارفرما" value={run.totalInsurance} />
        <Stat label="مالیات حقوق" value={run.totalTax} />
        <Stat label="خالص پرداختی" value={run.totalNet} tone="green" />
        <Stat label="هزینهٔ کامل کارفرما" value={run.totalEmployerCost} hint={`شامل ${(Number(totalEmployerInsurance) / 1e9).toFixed(2)} میلیارد بیمهٔ کارفرما و ${(Number(totalSeverance) / 1e9).toFixed(2)} سنوات`} />
      </div>

      <Card bodyClass="p-0">
        <div className="overflow-x-auto">
          <table className="table min-w-[1400px]">
            <thead>
              <tr>
                <th>کد</th>
                <th>کارمند</th>
                <th>کارکرد</th>
                <th>اضافه‌کار (ساعت)</th>
                <th>مزد و مزایا</th>
                <th>اضافه‌کار</th>
                <th>ناخالص</th>
                <th>بیمهٔ کارمند</th>
                <th>مالیات</th>
                <th>وام/مساعده</th>
                <th>سایر کسور</th>
                <th>خالص پرداختی</th>
                <th>سنوات</th>
                <th className="no-print" />
              </tr>
            </thead>
            <tbody>
              {run.items.map((i) => (
                <tr key={i.id}>
                  <td className="num">{toFaDigits(i.employee.code)}</td>
                  <td>
                    <Link className="hover:text-brand-700" href={`/employees/${i.employeeId}`}>{i.employee.firstName} {i.employee.lastName}</Link>
                    <div className="text-xs text-muted">{i.employee.position}</div>
                  </td>
                  <td className="num">{toFaDigits(Number(i.workingDays))}{Number(i.absenceDays) > 0 && <span className="text-xs text-red-600"> (غیبت {toFaDigits(Number(i.absenceDays))})</span>}</td>
                  <td className="num">{toFaDigits(Number(i.overtimeHours))}</td>
                  <td><Money value={i.baseAmount + i.housingAllowance + i.foodAllowance + i.childAllowance + i.transportAllowance + i.otherAllowance} /></td>
                  <td><Money value={i.overtimeAmount + i.holidayAmount + i.nightAmount + i.bonus} /></td>
                  <td className="font-semibold"><Money value={i.grossEarnings} /></td>
                  <td><Money value={i.insuranceEmployee} /></td>
                  <td><Money value={i.tax} /></td>
                  <td><Money value={i.loanDeduction + i.advanceDeduction} /></td>
                  <td><Money value={i.otherDeduction} /></td>
                  <td className="font-bold"><Money value={i.netPay} /></td>
                  <td><Money value={i.severanceAccrual} /></td>
                  <td className="no-print whitespace-nowrap text-xs">
                    <Link className="text-brand-700 hover:underline" href={`/print/payslip/${i.id}`}>فیش</Link>
                    {editable && (
                      <>
                        <span className="mx-1 text-muted">|</span>
                        <Link className="text-brand-700 hover:underline" href={`#item-${i.id}`}>ویرایش</Link>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={6}>جمع</td>
                <td><Money value={run.totalGross} /></td>
                <td><Money value={run.items.reduce((s, i) => s + i.insuranceEmployee, 0n)} /></td>
                <td><Money value={run.totalTax} /></td>
                <td><Money value={run.items.reduce((s, i) => s + i.loanDeduction + i.advanceDeduction, 0n)} /></td>
                <td><Money value={run.items.reduce((s, i) => s + i.otherDeduction, 0n)} /></td>
                <td><Money value={run.totalNet} /></td>
                <td><Money value={totalSeverance} /></td>
                <td className="no-print" />
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      {editable && (
        <div className="no-print mt-4 space-y-3">
          <h2 className="text-sm font-semibold text-slate-700">ویرایش کارکرد و کسورات هر نفر</h2>
          {run.items.map((i) => (
            <Card key={i.id} title={<span id={`item-${i.id}`}>{i.employee.firstName} {i.employee.lastName} — <span className="num">{toFaDigits(i.employee.code)}</span></span>}>
              <ActionForm action={updateItemAction.bind(null, i.id)} submitLabel="محاسبهٔ دوباره" size="sm">
                <div className="grid gap-2 md:grid-cols-6">
                  <div><label className="label">کارکرد (روز)</label><input name="workingDays" dir="ltr" className="input num" defaultValue={Number(i.workingDays)} /></div>
                  <div><label className="label">غیبت بدون حقوق</label><input name="absenceDays" dir="ltr" className="input num" defaultValue={Number(i.absenceDays)} /></div>
                  <div><label className="label">اضافه‌کار (ساعت)</label><input name="overtimeHours" dir="ltr" className="input num" defaultValue={Number(i.overtimeHours)} /></div>
                  <div><label className="label">تعطیل‌کاری (ساعت)</label><input name="holidayHours" dir="ltr" className="input num" defaultValue={Number(i.holidayHours)} /></div>
                  <div><label className="label">شب‌کاری (ساعت)</label><input name="nightHours" dir="ltr" className="input num" defaultValue={Number(i.nightHours)} /></div>
                  <div><label className="label">مأموریت (روز)</label><input name="missionDays" dir="ltr" className="input num" defaultValue={Number(i.missionDays)} /></div>
                  <div><label className="label">پاداش</label><input name="bonus" dir="ltr" className="input num" defaultValue={i.bonus.toString()} /></div>
                  <div><label className="label">قسط وام</label><input name="loanDeduction" dir="ltr" className="input num" defaultValue={i.loanDeduction.toString()} /></div>
                  <div><label className="label">مساعده</label><input name="advanceDeduction" dir="ltr" className="input num" defaultValue={i.advanceDeduction.toString()} /></div>
                  <div><label className="label">سایر کسور</label><input name="otherDeduction" dir="ltr" className="input num" defaultValue={i.otherDeduction.toString()} /></div>
                  <div className="md:col-span-2"><label className="label">توضیح</label><input name="note" className="input" defaultValue={i.note ?? ''} /></div>
                </div>
              </ActionForm>
              <div className="mt-2 border-t border-line pt-2">
                <ActionForm inline action={removeItemAction.bind(null, i.id)} submitLabel="حذف از این لیست" variant="ghost" size="sm" confirm="این نفر از لیست حقوق این ماه حذف شود؟" />
              </div>
            </Card>
          ))}
          <ActionForm inline action={deleteRunAction.bind(null, run.id)} submitLabel="حذف کل لیست" variant="danger" size="sm" confirm="کل لیست حقوق این ماه حذف شود؟" />
        </div>
      )}

      {run.voucher?.reversedBy && (
        <p className="mt-4 text-sm text-red-700">
          سند این لیست با <Link className="underline" href={`/vouchers/${run.voucher.reversedBy.id}`}>سند شمارهٔ {toFaDigits(run.voucher.reversedBy.number ?? 0)}</Link> برگشت خورده است.
        </p>
      )}
      {run.payDate && <p className="mt-3 text-xs text-muted">تاریخ سند: {formatJ(run.payDate)}</p>}
    </>
  );
}
