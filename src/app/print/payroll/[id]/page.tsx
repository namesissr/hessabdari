import Link from 'next/link';
import { notFound } from 'next/navigation';
import prisma from '@/lib/prisma';
import { assertEntityAccess, pageUser } from '@/lib/auth';
import { formatJ, toFaDigits } from '@/lib/jalali';
import { Money, LinkButton } from '@/components/ui';
import { PrintButton } from '@/components/print-button';

export const metadata = { title: 'چاپ لیست حقوق' };

/** لیست حقوق برای چاپ و تحویل به بانک/بیمه */
export default async function PayrollPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await pageUser();
  const run = await prisma.payrollRun.findUnique({
    where: { id },
    include: { entity: true, items: { include: { employee: true }, orderBy: { employee: { code: 'asc' } } } },
  });
  if (!run) notFound();
  assertEntityAccess(user, run.entityId);

  return (
    <>
      <style>{`@page { size: A4 landscape; margin: 8mm }
        @media print { .no-print { display:none !important } body { background:#fff !important } .sheet { box-shadow:none !important; border:0 !important } }`}</style>

      <div className="no-print mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 p-4">
        <h1 className="text-lg font-bold">لیست حقوق {run.title}</h1>
        <div className="flex flex-wrap gap-2">
          <LinkButton href={`/payroll/${run.id}`}>بازگشت</LinkButton>
          <PrintButton label="چاپ لیست" />
        </div>
      </div>

      <div className="sheet mx-auto mb-8 max-w-6xl border border-line bg-white p-5 shadow-sm">
        <div className="mb-3 text-center">
          <div className="text-lg font-bold">{run.entity.legalName ?? run.entity.name}</div>
          <div className="text-sm">لیست حقوق و دستمزد {run.title}</div>
          {run.payDate && <div className="text-xs text-muted">تاریخ پرداخت: {formatJ(run.payDate)}</div>}
        </div>

        <table className="table">
          <thead>
            <tr>
              <th>ردیف</th><th>کد</th><th>نام</th><th>شمارهٔ بیمه</th><th>کارکرد</th><th>ناخالص</th>
              <th>بیمهٔ کارمند</th><th>مالیات</th><th>کسورات</th><th>خالص</th><th>شبا</th>
            </tr>
          </thead>
          <tbody>
            {run.items.map((i, idx) => (
              <tr key={i.id}>
                <td>{toFaDigits(idx + 1)}</td>
                <td className="num">{toFaDigits(i.employee.code)}</td>
                <td>{i.employee.firstName} {i.employee.lastName}</td>
                <td className="num text-xs">{i.employee.insuranceNo ? toFaDigits(i.employee.insuranceNo) : '—'}</td>
                <td className="num">{toFaDigits(Number(i.workingDays))}</td>
                <td><Money value={i.grossEarnings} /></td>
                <td><Money value={i.insuranceEmployee} /></td>
                <td><Money value={i.tax} /></td>
                <td><Money value={i.totalDeductions} /></td>
                <td className="font-semibold"><Money value={i.netPay} /></td>
                <td className="num text-[10px]" dir="ltr">{i.employee.iban ?? i.employee.accountNo ?? '—'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5}>جمع کل ({toFaDigits(run.items.length)} نفر)</td>
              <td><Money value={run.totalGross} /></td>
              <td><Money value={run.items.reduce((s, i) => s + i.insuranceEmployee, 0n)} /></td>
              <td><Money value={run.totalTax} /></td>
              <td><Money value={run.items.reduce((s, i) => s + i.totalDeductions, 0n)} /></td>
              <td><Money value={run.totalNet} /></td>
              <td />
            </tr>
          </tfoot>
        </table>

        <div className="mt-4 grid grid-cols-3 gap-6 text-center text-xs text-muted">
          <div>تهیه‌کننده</div>
          <div>مدیر مالی</div>
          <div>مدیرعامل</div>
        </div>
      </div>

      <div className="no-print mx-auto mb-10 max-w-6xl px-4 text-sm">
        <div className="font-semibold">فیش حقوقی تک‌تک کارکنان:</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {run.items.map((i) => (
            <Link key={i.id} href={`/print/payslip/${i.id}`} className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs hover:bg-slate-50">
              {i.employee.firstName} {i.employee.lastName}
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
