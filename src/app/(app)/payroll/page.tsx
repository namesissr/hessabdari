import Link from 'next/link';
import prisma from '@/lib/prisma';
import { can } from '@/lib/auth';
import { JALALI_MONTHS, formatJ, toFaDigits, todayUtc } from '@/lib/jalali';
import { pageContext } from '@/lib/page';
import { suggestNextMonth } from '@/modules/hr/payroll';
import { Badge, Card, Empty, LinkButton, Money, PageHeader, Stat } from '@/components/ui';
import { ActionForm } from '@/components/action-form';
import { JDateInput } from '@/components/jdate-input';
import { createRunAction } from './actions';

export const metadata = { title: 'لیست حقوق' };

export default async function PayrollPage() {
  const { user, entity } = await pageContext();
  if (!entity) return <Empty>ابتدا شرکت را تعریف کنید.</Empty>;
  const editable = can(user, 'voucher.edit');

  const runs = await prisma.payrollRun.findMany({
    where: { entityId: entity.id },
    orderBy: [{ jy: 'desc' }, { jm: 'desc' }],
    take: 36,
    include: { _count: { select: { items: true } }, voucher: { include: { reversedBy: true } } },
  });
  const next = await suggestNextMonth(prisma, entity.id, todayUtc());
  const employees = await prisma.employee.count({ where: { entityId: entity.id, status: 'ACTIVE' } });
  const ytd = runs.filter((r) => r.jy === next.jy && r.status === 'POSTED');
  const ytdNet = ytd.reduce((s, r) => s + r.totalNet, 0n);
  const ytdCost = ytd.reduce((s, r) => s + r.totalEmployerCost, 0n);

  return (
    <>
      <PageHeader
        title="لیست حقوق ماهانه"
        subtitle={`${entity.name} — ${toFaDigits(employees)} کارمند شاغل`}
        actions={<LinkButton href="/settings/payroll">نرخ‌ها و تنظیمات حقوق</LinkButton>}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat label={`خالص پرداختی سال ${toFaDigits(next.jy)}`} value={ytdNet} hint={`${toFaDigits(ytd.length)} ماه قطعی‌شده`} />
        <Stat label="هزینهٔ کامل کارفرما (با بیمه و سنوات)" value={ytdCost} />
        <Stat label="کارکنان شاغل" value={BigInt(employees)} hint="در لیست حقوق ماه بعد می‌آیند" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <Card bodyClass="p-0">
          {runs.length === 0 ? (
            <div className="p-4"><Empty>هنوز لیست حقوقی ساخته نشده است.</Empty></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr><th>ماه</th><th>نفرات</th><th>ناخالص</th><th>بیمه</th><th>مالیات</th><th>خالص پرداختی</th><th>هزینهٔ کارفرما</th><th>وضعیت</th><th>سند</th></tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id}>
                      <td><Link className="font-medium text-brand-700 hover:underline" href={`/payroll/${r.id}`}>{r.title}</Link></td>
                      <td>{toFaDigits(r._count.items)}</td>
                      <td><Money value={r.totalGross} /></td>
                      <td><Money value={r.totalInsurance} /></td>
                      <td><Money value={r.totalTax} /></td>
                      <td className="font-semibold"><Money value={r.totalNet} /></td>
                      <td><Money value={r.totalEmployerCost} /></td>
                      <td>
                        {r.voucher?.reversedBy ? <Badge tone="red">برگشت‌خورده</Badge> : <Badge tone={r.status === 'POSTED' ? 'green' : 'amber'}>{r.status === 'POSTED' ? 'قطعی' : 'پیش‌نویس'}</Badge>}
                      </td>
                      <td className="text-xs">{r.voucherId ? <Link className="text-brand-700 hover:underline" href={`/vouchers/${r.voucherId}`}>سند</Link> : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {editable && (
          <Card title="ساخت لیست حقوق ماه">
            <ActionForm action={createRunAction} submitLabel="ساخت لیست" variant="primary">
              <input type="hidden" name="entityId" value={entity.id} />
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label">سال</label>
                  <input name="jy" type="number" className="input num" defaultValue={next.jy} />
                </div>
                <div>
                  <label className="label">ماه</label>
                  <select name="jm" className="input" defaultValue={next.jm}>
                    {JALALI_MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="label">تاریخ پرداخت (برای سند)</label>
                <JDateInput name="payDate" />
                <p className="mt-1 text-xs text-muted">خالی = آخرین روز همان ماه</p>
              </div>
              <div><label className="label">توضیح</label><input name="note" className="input" /></div>
              <p className="text-xs text-muted">همهٔ کارکنان شاغل با حقوق و مزایای حکم جاری و اقساط وامشان وارد لیست می‌شوند؛ بعد می‌توانید کارکرد و اضافه‌کار هر نفر را اصلاح کنید.</p>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
