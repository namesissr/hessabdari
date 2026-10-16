import { notFound } from 'next/navigation';
import prisma from '@/lib/prisma';
import { assertEntityAccess, pageUser } from '@/lib/auth';
import { formatJ, toFaDigits } from '@/lib/jalali';
import { amountToWords } from '@/lib/num2words';
import { Money } from '@/components/ui';
import { PrintButton } from '@/components/print-button';
import { LinkButton } from '@/components/ui';

export const metadata = { title: 'فیش حقوقی' };

export default async function PayslipPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await pageUser();
  const item = await prisma.payrollItem.findUnique({
    where: { id },
    include: { run: { include: { entity: true } }, employee: true },
  });
  if (!item) notFound();
  assertEntityAccess(user, item.run.entityId);
  const e = item.employee;
  const dims = await prisma.dimensionValue.findMany({ where: { id: { in: [e.businessDimId, e.costCenterDimId].filter(Boolean) as string[] } } });
  const dimName = new Map(dims.map((d) => [d.id, d.name]));

  const earnings: [string, bigint][] = [
    ['حقوق پایه (کارکرد)', item.baseAmount],
    ['حق مسکن', item.housingAllowance],
    ['بن خواربار', item.foodAllowance],
    ['حق اولاد', item.childAllowance],
    ['ایاب و ذهاب', item.transportAllowance],
    ['سایر مزایا', item.otherAllowance],
    ['اضافه‌کار', item.overtimeAmount],
    ['تعطیل‌کاری', item.holidayAmount],
    ['شب‌کاری', item.nightAmount],
    ['مأموریت', item.missionAmount],
    ['پاداش', item.bonus],
  ];
  const deductions: [string, bigint][] = [
    ['بیمهٔ سهم کارمند', item.insuranceEmployee],
    ['مالیات حقوق', item.tax],
    ['قسط وام', item.loanDeduction],
    ['مساعده', item.advanceDeduction],
    ['سایر کسور', item.otherDeduction],
  ];

  return (
    <>
      <style>{`@page { size: A5 landscape; margin: 8mm }
        @media print { .no-print { display: none !important } body { background:#fff !important } .sheet { box-shadow:none !important; border:0 !important; margin:0 !important } }`}</style>

      <div className="no-print mx-auto flex max-w-3xl items-center justify-between gap-2 p-4">
        <h1 className="text-lg font-bold">فیش حقوقی {e.firstName} {e.lastName} — {item.run.title}</h1>
        <div className="flex gap-2">
          <LinkButton href={`/payroll/${item.runId}`}>بازگشت به لیست</LinkButton>
          <PrintButton label="چاپ فیش" />
        </div>
      </div>

      <div className="sheet mx-auto mb-8 max-w-3xl border border-line bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-start justify-between border-b border-line pb-3">
          <div>
            <div className="text-lg font-bold">{item.run.entity.legalName ?? item.run.entity.name}</div>
            <div className="text-sm text-muted">فیش حقوقی {item.run.title}</div>
          </div>
          <div className="text-left text-xs text-muted">
            <div>کد پرسنلی: <span className="num">{toFaDigits(e.code)}</span></div>
            {e.nationalCode && <div>کد ملی: <span className="num">{toFaDigits(e.nationalCode)}</span></div>}
            {e.insuranceNo && <div>شمارهٔ بیمه: <span className="num">{toFaDigits(e.insuranceNo)}</span></div>}
          </div>
        </div>

        <dl className="mb-4 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
          <div><dt className="text-muted">نام</dt><dd className="font-medium">{e.firstName} {e.lastName}</dd></div>
          <div><dt className="text-muted">سمت</dt><dd>{e.position ?? '—'}</dd></div>
          <div><dt className="text-muted">واحد</dt><dd>{e.costCenterDimId ? dimName.get(e.costCenterDimId) : e.businessDimId ? dimName.get(e.businessDimId) : '—'}</dd></div>
          <div><dt className="text-muted">تاریخ استخدام</dt><dd>{formatJ(e.hireDate)}</dd></div>
          <div><dt className="text-muted">کارکرد</dt><dd className="num">{toFaDigits(Number(item.workingDays))} روز</dd></div>
          <div><dt className="text-muted">اضافه‌کار</dt><dd className="num">{toFaDigits(Number(item.overtimeHours))} ساعت</dd></div>
          <div><dt className="text-muted">غیبت</dt><dd className="num">{toFaDigits(Number(item.absenceDays))} روز</dd></div>
          <div><dt className="text-muted">مأموریت</dt><dd className="num">{toFaDigits(Number(item.missionDays))} روز</dd></div>
        </dl>

        <div className="grid gap-4 sm:grid-cols-2">
          <table className="table">
            <thead><tr><th colSpan={2}>مزایا (ریال)</th></tr></thead>
            <tbody>
              {earnings.filter(([, v]) => v > 0n).map(([label, v]) => (
                <tr key={label}><td>{label}</td><td><Money value={v} /></td></tr>
              ))}
            </tbody>
            <tfoot><tr><td>جمع ناخالص</td><td><Money value={item.grossEarnings} /></td></tr></tfoot>
          </table>

          <table className="table">
            <thead><tr><th colSpan={2}>کسورات (ریال)</th></tr></thead>
            <tbody>
              {deductions.filter(([, v]) => v > 0n).map(([label, v]) => (
                <tr key={label}><td>{label}</td><td><Money value={v} /></td></tr>
              ))}
              {deductions.every(([, v]) => v === 0n) && <tr><td colSpan={2} className="text-muted">بدون کسورات</td></tr>}
            </tbody>
            <tfoot><tr><td>جمع کسورات</td><td><Money value={item.totalDeductions} /></td></tr></tfoot>
          </table>
        </div>

        <div className="mt-4 rounded-lg bg-slate-50 p-3">
          <div className="flex items-center justify-between text-base font-bold">
            <span>خالص پرداختی</span>
            <span><Money value={item.netPay} /> ریال</span>
          </div>
          <div className="mt-1 text-xs text-muted">به حروف: {amountToWords(item.netPay)}</div>
          {e.iban && <div className="mt-1 text-xs text-muted">واریز به شبا <span className="num" dir="ltr">{e.iban}</span></div>}
        </div>

        <div className="mt-4 grid gap-2 text-xs text-muted sm:grid-cols-3">
          <div>مبنای بیمه: <Money value={item.insuranceBase} /></div>
          <div>بیمهٔ سهم کارفرما: <Money value={item.insuranceEmployer} /></div>
          <div>ذخیرهٔ سنوات این ماه: <Money value={item.severanceAccrual} /></div>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-8 text-center text-xs text-muted">
          <div>امضای کارمند</div>
          <div>امضای کارفرما</div>
        </div>
        {item.note && <p className="mt-3 text-xs text-muted">توضیح: {item.note}</p>}
      </div>
    </>
  );
}
