import prisma from '@/lib/prisma';
import { can } from '@/lib/auth';
import { formatJ, toFaDigits } from '@/lib/jalali';
import { pageContext } from '@/lib/page';
import { suggestNextYear } from '@/modules/fiscal/fiscal';
import { Badge, Card, Empty, PageHeader } from '@/components/ui';
import { ActionForm } from '@/components/action-form';
import { closeFiscalYearAction, deleteFiscalYearAction, saveFiscalYearAction, setPeriodStatusAction } from '../actions';
import { renumberAction } from '../../vouchers/actions';

export const metadata = { title: 'سال و دوره مالی' };

const PERIOD_TONE = { OPEN: 'green', LOCKED: 'amber', CLOSED: 'gray' } as const;
const PERIOD_LABEL = { OPEN: 'باز', LOCKED: 'قفل', CLOSED: 'بسته' } as const;

export default async function FiscalYearsPage() {
  const { user, entity } = await pageContext();
  if (!entity) return <Empty>شرکتی تعریف نشده است.</Empty>;
  const editable = can(user, 'settings.accounting');
  const years = await prisma.fiscalYear.findMany({
    where: { entityId: entity.id },
    orderBy: { startDate: 'desc' },
    include: {
      periods: { orderBy: { no: 'asc' } },
      _count: { select: { vouchers: true } },
    },
  });
  const pendingByYear = new Map(
    (await prisma.voucher.groupBy({ by: ['fiscalYearId'], where: { entityId: entity.id, status: { not: 'POSTED' } }, _count: true })).map((g) => [g.fiscalYearId, g._count]),
  );
  const suggestion = await suggestNextYear(prisma, entity.id);

  return (
    <>
      <PageHeader
        title="سال و دوره‌های مالی"
        subtitle={`${entity.name} — شروع و پایان سال مالی از همین‌جا قابل تغییر است (تا وقتی در آن سال سندی ثبت نشده). پیش‌فرض شروع سال در تنظیمات شرکت تعیین می‌شود.`}
      />
      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          {years.length === 0 && <Empty>سال مالی تعریف نشده است.</Empty>}
          {years.map((fy) => {
            const pending = pendingByYear.get(fy.id) ?? 0;
            const locked = fy._count.vouchers > 0;
            return (
              <Card
                key={fy.id}
                title={
                  <span className="flex items-center gap-2">
                    سال مالی {fy.title}
                    <Badge tone={fy.status === 'OPEN' ? 'green' : 'gray'}>{fy.status === 'OPEN' ? 'باز' : 'بسته'}</Badge>
                    <span className="text-xs font-normal text-muted">
                      {formatJ(fy.startDate)} تا {formatJ(fy.endDate)} — {toFaDigits(fy._count.vouchers)} سند{pending ? ` (${toFaDigits(pending)} قطعی‌نشده)` : ''}
                    </span>
                  </span>
                }
              >
                {editable && fy.status === 'OPEN' && (
                  <details className="mb-4">
                    <summary className="cursor-pointer text-sm text-brand-700">ویرایش سال مالی</summary>
                    <ActionForm action={saveFiscalYearAction} submitLabel="ذخیره" size="sm" className="mt-3">
                      <input type="hidden" name="id" value={fy.id} />
                      <div className="grid gap-2 sm:grid-cols-3">
                        <div><label className="label">عنوان</label><input name="title" className="input" defaultValue={fy.title} /></div>
                        <div><label className="label">شروع</label><input name="start" dir="ltr" className="input" defaultValue={formatJ(fy.startDate, false)} disabled={locked} /></div>
                        <div><label className="label">پایان</label><input name="end" dir="ltr" className="input" defaultValue={formatJ(fy.endDate, false)} disabled={locked} /></div>
                      </div>
                      {locked && (
                        <>
                          <input type="hidden" name="start" value={formatJ(fy.startDate, false)} />
                          <input type="hidden" name="end" value={formatJ(fy.endDate, false)} />
                          <p className="text-xs text-muted">در این سال سند ثبت شده؛ فقط عنوان قابل تغییر است.</p>
                        </>
                      )}
                    </ActionForm>
                  </details>
                )}
                <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {fy.periods.map((p) => (
                    <div key={p.id} className="flex items-center justify-between rounded-lg border border-line px-3 py-2">
                      <div>
                        <div className="text-sm font-medium">{p.title}</div>
                        <div className="text-[11px] text-muted">{formatJ(p.startDate)} – {formatJ(p.endDate)}</div>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <Badge tone={PERIOD_TONE[p.status]}>{PERIOD_LABEL[p.status]}</Badge>
                        {can(user, 'period.lock') && p.status !== 'CLOSED' && (
                          <ActionForm
                            inline
                            action={setPeriodStatusAction.bind(null, p.id, p.status === 'OPEN' ? 'LOCKED' : 'OPEN')}
                            submitLabel={p.status === 'OPEN' ? 'قفل' : 'باز کردن'}
                            variant="ghost"
                            size="sm"
                          />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                {fy.status === 'OPEN' && (
                  <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-3">
                    {can(user, 'voucher.post') && (
                      <ActionForm inline action={renumberAction.bind(null, fy.id)} submitLabel="مرتب‌سازی شمارهٔ اسناد بر اساس تاریخ" variant="secondary" size="sm" confirm="شمارهٔ همهٔ اسناد قطعی این سال بر اساس تاریخ بازنویسی می‌شود. ادامه؟" />
                    )}
                    {can(user, 'year.close') && (
                      <ActionForm
                        inline
                        action={closeFiscalYearAction.bind(null, fy.id)}
                        submitLabel="بستن سال مالی"
                        variant="danger"
                        size="sm"
                        confirm={`بستن سال ${fy.title}: حساب‌های موقت به سود انباشته بسته می‌شوند، سند اختتامیه و افتتاحیهٔ سال بعد صادر می‌شود و دیگر در این سال نمی‌توان سند ثبت کرد. سال بعد باید از قبل تعریف شده باشد. ادامه؟`}
                      />
                    )}
                    {editable && fy._count.vouchers === 0 && (
                      <ActionForm inline action={deleteFiscalYearAction.bind(null, fy.id)} submitLabel="حذف سال" variant="ghost" size="sm" confirm="سال مالی حذف شود؟" />
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
        {editable && (
          <Card title="تعریف سال مالی جدید">
            <ActionForm action={saveFiscalYearAction} submitLabel="ایجاد سال مالی">
              <input type="hidden" name="entityId" value={entity.id} />
              <div><label className="label">عنوان</label><input name="title" className="input" defaultValue={suggestion.title} /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="label">تاریخ شروع</label><input name="start" dir="ltr" className="input" defaultValue={formatJ(suggestion.startDate, false)} /></div>
                <div><label className="label">تاریخ پایان</label><input name="end" dir="ltr" className="input" defaultValue={formatJ(suggestion.endDate, false)} /></div>
              </div>
              <p className="text-xs text-muted">دوره‌ها به صورت ماه‌های شمسی خودکار ساخته می‌شوند. سال مالی غیرتقویمی (مثلاً از ۱ تیر) و سال کوتاه/بلند اول (تا ۱۸ ماه) پشتیبانی می‌شود.</p>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
