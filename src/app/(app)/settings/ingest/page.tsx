import Link from 'next/link';
import prisma from '@/lib/prisma';
import { can } from '@/lib/auth';
import { formatJ, toFaDigits } from '@/lib/jalali';
import { one, pageContext, type SP } from '@/lib/page';
import { EVENT_TYPES } from '@/modules/ingest/engine';
import { Badge, Card, Empty, Money, PageHeader } from '@/components/ui';
import { ActionForm } from '@/components/action-form';
import { cn } from '@/lib/utils';
import { ignoreEventAction, retryEventAction, rotateSecretAction, saveSourceAction } from './actions';

export const metadata = { title: 'اتصال سایت‌ها' };

const STATUS_LABEL = { PENDING: 'در انتظار', POSTED: 'سند خورده', FAILED: 'خطا', IGNORED: 'نادیده' } as const;
const STATUS_TONE = { PENDING: 'amber', POSTED: 'green', FAILED: 'red', IGNORED: 'gray' } as const;

export default async function IngestPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { user, entity, entities } = await pageContext();
  if (!entity) return <Empty>ابتدا شرکت را تعریف کنید.</Empty>;
  if (!can(user, 'settings.accounting')) return <Empty>دسترسی ندارید.</Empty>;

  const [sources, businesses, banks] = await Promise.all([
    prisma.ingestSource.findMany({ orderBy: { code: 'asc' }, include: { _count: { select: { events: true } } } }),
    prisma.dimensionValue.findMany({ where: { type: { code: 'BUSINESS' }, active: true }, orderBy: { code: 'asc' } }),
    prisma.bankAccount.findMany({ where: { entityId: entity.id, active: true }, include: { dimensionValue: true } }),
  ]);
  const selected = sources.find((s) => s.id === one(sp.id)) ?? null;
  const statusFilter = one(sp.status);
  const events = await prisma.ingestEvent.findMany({
    where: { ...(selected ? { sourceId: selected.id } : {}), ...(statusFilter ? { status: statusFilter as never } : {}) },
    orderBy: { receivedAt: 'desc' },
    take: 80,
    include: { source: true },
  });
  const failedCount = await prisma.ingestEvent.count({ where: { status: 'FAILED' } });
  const config = (selected?.config ?? {}) as { bankAccountCode?: string; revenueAccountCode?: string; expenseAccountCode?: string };

  return (
    <>
      <PageHeader
        title="اتصال خودکار سایت‌ها"
        subtitle="هر سایت با کلید اختصاصی خودش رویدادهای مالی را می‌فرستد و سیستم خودکار سند می‌زند. ارسال دوبارهٔ یک رویداد سند تکراری نمی‌سازد."
      />

      {failedCount > 0 && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {toFaDigits(failedCount)} رویداد با خطا مانده است. بعد از رفع علت، دکمهٔ «تلاش دوباره» را بزنید.
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
        <div className="space-y-4">
          <Card title="منابع (سایت‌ها)" bodyClass="p-2">
            {sources.length === 0 && <div className="p-3 text-sm text-muted">هنوز منبعی تعریف نشده است.</div>}
            <ul>
              {sources.map((s) => (
                <li key={s.id}>
                  <Link href={`?id=${s.id}`} className={cn('flex items-center justify-between rounded-lg px-3 py-2 text-sm', s.id === selected?.id ? 'bg-brand-600 text-white' : 'hover:bg-slate-100')}>
                    <span>{s.name} <span className="num text-xs opacity-70">{s.code}</span></span>
                    <span className="text-xs opacity-70">{toFaDigits(s._count.events)}</span>
                  </Link>
                </li>
              ))}
            </ul>
            {selected && <div className="px-3 pt-2"><Link href="/settings/ingest" className="text-xs text-brand-700">+ منبع جدید</Link></div>}
          </Card>

          <Card title={selected ? `تنظیمات ${selected.name}` : 'منبع جدید'}>
            <ActionForm action={saveSourceAction} submitLabel={selected ? 'ذخیره' : 'ساخت منبع و تولید کلید'} key={selected?.id ?? 'new'}>
              {selected && <input type="hidden" name="id" value={selected.id} />}
              <input type="hidden" name="entityId" value={selected?.entityId ?? entity.id} />
              <div className="grid grid-cols-[120px_1fr] gap-2">
                <div>
                  <label className="label">کد</label>
                  <input name="code" dir="ltr" className="input" defaultValue={selected?.code} placeholder="ARZINOO" disabled={!!selected} required={!selected} />
                </div>
                <div>
                  <label className="label">نام</label>
                  <input name="name" className="input" defaultValue={selected?.name} placeholder="ارزینو" required />
                </div>
              </div>
              <div>
                <label className="label">کسب‌وکار مربوط *</label>
                <select name="businessDimId" className="input" defaultValue={selected?.businessDimId ?? ''} required>
                  <option value="">— انتخاب کنید —</option>
                  {businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">حساب بانکی تسویهٔ درگاه</label>
                <select name="bankAccountCode" className="input" defaultValue={config.bankAccountCode ?? ''}>
                  <option value="">—</option>
                  {banks.map((b) => <option key={b.id} value={b.dimensionValue.code}>{b.dimensionValue.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label">کد حساب درآمد</label>
                  <input name="revenueAccountCode" dir="ltr" className="input" defaultValue={config.revenueAccountCode ?? ''} placeholder="6101" />
                </div>
                <div>
                  <label className="label">کد حساب هزینهٔ پیش‌فرض</label>
                  <input name="expenseAccountCode" dir="ltr" className="input" defaultValue={config.expenseAccountCode ?? ''} placeholder="7101" />
                </div>
              </div>
              <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="active" defaultChecked={selected ? selected.active : true} /> فعال</label>
            </ActionForm>
            {selected && (
              <div className="mt-3 border-t border-line pt-3">
                <ActionForm inline action={rotateSecretAction.bind(null, selected.id)} submitLabel="تولید کلید جدید" variant="danger" size="sm" confirm="کلید قبلی از کار می‌افتد و باید در سایت به‌روز شود. ادامه؟" />
              </div>
            )}
          </Card>

          {selected && (
            <Card title="نمونهٔ ارسال از سایت">
              <pre dir="ltr" className="overflow-x-auto rounded-lg bg-slate-900 p-3 text-left text-[11px] leading-5 text-slate-100">{`POST https://hessabdari.arzinoo.com/api/ingest/events
X-Source-Key: <کلید این منبع>
Content-Type: application/json

{
  "type": "order.paid",
  "externalId": "${selected.code.toLowerCase()}-98231",
  "occurredAt": "2026-10-16T09:12:00Z",
  "amount": 12000000,
  "tax": 1200000,
  "description": "سفارش ۹۸۲۳۱"
}`}</pre>
              <ul className="mt-3 space-y-1 text-xs text-slate-600">
                {Object.entries(EVENT_TYPES).map(([k, v]) => (
                  <li key={k}><span className="num font-semibold">{k}</span> — {v}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted">
                می‌توانید آرایه‌ای از رویدادها را هم در یک درخواست بفرستید (حداکثر ۱۰۰). برای بررسی اتصال، همان آدرس را با GET صدا بزنید.
              </p>
            </Card>
          )}
        </div>

        <Card
          title={
            <form className="flex items-center gap-2">
              {selected && <input type="hidden" name="id" value={selected.id} />}
              <span>رویدادها</span>
              <select name="status" defaultValue={statusFilter} className="input w-36 py-1 text-xs">
                <option value="">همه</option>
                {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <button className="rounded-lg bg-slate-800 px-3 py-1 text-xs text-white">فیلتر</button>
            </form>
          }
          bodyClass="p-0"
        >
          {events.length === 0 ? (
            <div className="p-4"><Empty>رویدادی دریافت نشده است.</Empty></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr><th>زمان</th><th>منبع</th><th>نوع</th><th>شناسهٔ خارجی</th><th>مبلغ</th><th>وضعیت</th><th>سند / خطا</th><th /></tr>
                </thead>
                <tbody>
                  {events.map((e) => (
                    <tr key={e.id} className={cn(e.status === 'FAILED' && 'bg-red-50')}>
                      <td className="whitespace-nowrap text-xs">{formatJ(e.receivedAt)} {e.receivedAt.toISOString().slice(11, 16)}</td>
                      <td className="text-xs">{e.source.name}</td>
                      <td className="num text-xs">{e.type}</td>
                      <td className="num text-xs">{e.externalId}</td>
                      <td>{e.amount ? <Money value={e.amount} /> : '—'}</td>
                      <td><Badge tone={STATUS_TONE[e.status]}>{STATUS_LABEL[e.status]}</Badge></td>
                      <td className="max-w-xs truncate text-xs">
                        {e.voucherId ? <Link className="text-brand-700 hover:underline" href={`/vouchers/${e.voucherId}`}>مشاهدهٔ سند</Link> : <span className="text-red-700">{e.error}</span>}
                      </td>
                      <td className="whitespace-nowrap">
                        {e.status !== 'POSTED' && can(user, 'voucher.post') && (
                          <>
                            <ActionForm inline action={retryEventAction.bind(null, e.id)} submitLabel="تلاش دوباره" variant="ghost" size="sm" />
                            {e.status !== 'IGNORED' && (
                              <ActionForm inline action={ignoreEventAction.bind(null, e.id)} submitLabel="نادیده" variant="ghost" size="sm" confirm="این رویداد نادیده گرفته شود؟">
                                <input type="hidden" name="note" value="نادیده گرفته شد توسط کاربر" />
                              </ActionForm>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
      {entities.length > 1 && <p className="mt-3 text-xs text-muted">هر منبع به یک شرکت و یک کسب‌وکار وصل است؛ برای شرکت دیگر، منبع جداگانه بسازید.</p>}
    </>
  );
}
