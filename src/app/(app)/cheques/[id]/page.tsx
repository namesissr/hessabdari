import Link from 'next/link';
import { notFound } from 'next/navigation';
import prisma from '@/lib/prisma';
import { assertEntityAccess, can } from '@/lib/auth';
import { formatJ, toFaDigits, todayUtc } from '@/lib/jalali';
import { pageContext } from '@/lib/page';
import { amountToWords } from '@/lib/num2words';
import { CHEQUE_EVENT_LABEL, CHEQUE_STATUS_LABEL, allowedEvents } from '@/modules/treasury/cheques';
import { Badge, Card, Empty, LinkButton, Money, PageHeader } from '@/components/ui';
import { ActionForm } from '@/components/action-form';
import { JDateInput } from '@/components/jdate-input';
import { chequeEventAction, updateChequeNotesAction } from '../actions';

export const metadata = { title: 'پروندهٔ چک' };

const NEEDS_BANK = ['DEPOSIT', 'CLEAR', 'PAY'];
const NEEDS_PARTY = ['ENDORSE'];

export default async function ChequePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, entity } = await pageContext();
  const cheque = await prisma.cheque.findUnique({
    where: { id },
    include: {
      party: { include: { dimensionValue: true } },
      bankAccount: { include: { dimensionValue: true } },
      chequeBook: true,
      createdBy: { select: { name: true } },
      events: { orderBy: { createdAt: 'asc' }, include: { bankAccount: { include: { dimensionValue: true } }, party: { include: { dimensionValue: true } }, createdBy: { select: { name: true } } } },
    },
  });
  if (!cheque) notFound();
  assertEntityAccess(user, cheque.entityId);
  if (!entity) return <Empty>شرکتی تعریف نشده است.</Empty>;

  const [banks, parties, businesses] = await Promise.all([
    prisma.bankAccount.findMany({ where: { entityId: cheque.entityId, active: true }, include: { dimensionValue: true }, orderBy: { dimensionValue: { code: 'asc' } } }),
    prisma.party.findMany({ where: { active: true }, include: { dimensionValue: true }, orderBy: { dimensionValue: { name: 'asc' } } }),
    prisma.dimensionValue.findMany({ where: { type: { code: 'BUSINESS' }, active: true }, orderBy: { code: 'asc' } }),
  ]);
  const actions = can(user, 'voucher.post') ? allowedEvents(cheque.direction, cheque.status) : [];
  const isIssued = cheque.direction === 'ISSUED';

  return (
    <>
      <PageHeader
        title={`چک ${isIssued ? 'پرداختی' : 'دریافتی'} — سریال ${cheque.serialNo}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={cheque.status === 'BOUNCED' ? 'red' : cheque.status === 'CLEARED' || cheque.status === 'PAID' ? 'green' : 'blue'}>{CHEQUE_STATUS_LABEL[cheque.status]}</Badge>
            {cheque.isGuarantee && <Badge tone="violet">تضمینی</Badge>}
            <span>سررسید {formatJ(cheque.dueDate)}</span>
            {cheque.location && <span className="text-xs">محل: {cheque.location}</span>}
          </span>
        }
        actions={
          <>
            {isIssued && <LinkButton href={`/print/cheque/${cheque.id}`} variant="primary">چاپ چک</LinkButton>}
            <LinkButton href="/cheques">فهرست چک‌ها</LinkButton>
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <Card title="مشخصات چک">
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
              <div><dt className="text-muted">مبلغ</dt><dd className="font-bold"><Money value={cheque.amount} /> ریال</dd></div>
              <div className="sm:col-span-2"><dt className="text-muted">به حروف</dt><dd>{amountToWords(cheque.amount)}</dd></div>
              <div><dt className="text-muted">{isIssued ? 'در وجه' : 'دریافت از'}</dt><dd>{cheque.party?.dimensionValue.name ?? cheque.counterpartyName ?? '—'}</dd></div>
              <div><dt className="text-muted">شناسهٔ صیاد</dt><dd className="num">{cheque.sayadId ? toFaDigits(cheque.sayadId) : '—'}</dd></div>
              <div><dt className="text-muted">تاریخ صدور</dt><dd>{cheque.issueDate ? formatJ(cheque.issueDate) : '—'}</dd></div>
              <div><dt className="text-muted">بانک</dt><dd>{cheque.bankAccount?.dimensionValue.name ?? cheque.bankName ?? '—'}</dd></div>
              <div><dt className="text-muted">شعبه / حساب</dt><dd className="text-xs">{cheque.branch ?? '—'} / {cheque.accountNo ?? '—'}</dd></div>
              <div><dt className="text-muted">صاحب حساب</dt><dd>{cheque.drawerName ?? '—'}</dd></div>
              <div className="sm:col-span-3"><dt className="text-muted">بابت</dt><dd>{cheque.description ?? '—'}</dd></div>
              <div><dt className="text-muted">ثبت‌کننده</dt><dd className="text-xs">{cheque.createdBy.name} — {formatJ(cheque.createdAt)}</dd></div>
              {isIssued && <div><dt className="text-muted">چاپ</dt><dd className="text-xs">{cheque.printCount ? `${toFaDigits(cheque.printCount)} بار — آخرین ${cheque.printedAt ? formatJ(cheque.printedAt) : ''}` : 'چاپ نشده'}</dd></div>}
            </dl>
          </Card>

          <Card title="تاریخچه و اسناد" bodyClass="p-0">
            <table className="table">
              <thead>
                <tr><th>تاریخ</th><th>رویداد</th><th>توضیح</th><th>کارمزد</th><th>سند</th><th>کاربر</th></tr>
              </thead>
              <tbody>
                {cheque.events.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap">{formatJ(e.date)}</td>
                    <td><Badge tone={e.type === 'BOUNCE' ? 'red' : 'gray'}>{CHEQUE_EVENT_LABEL[e.type]}</Badge></td>
                    <td className="text-xs">
                      {e.description}
                      {e.bankAccount && <div className="text-muted">بانک: {e.bankAccount.dimensionValue.name}</div>}
                      {e.party && <div className="text-muted">طرف حساب: {e.party.dimensionValue.name}</div>}
                    </td>
                    <td>{e.feeAmount > 0n ? <Money value={e.feeAmount} /> : '—'}</td>
                    <td className="text-xs">{e.voucherId ? <Link className="text-brand-700 hover:underline" href={`/vouchers/${e.voucherId}`}>مشاهدهٔ سند</Link> : '—'}</td>
                    <td className="text-xs text-muted">{e.createdBy.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>

        <div className="space-y-4">
          {actions.length > 0 ? (
            <Card title="عملیات روی چک">
              <div className="space-y-4">
                {actions.map((type) => (
                  <details key={type} className="rounded-lg border border-line p-3">
                    <summary className="cursor-pointer text-sm font-medium">{CHEQUE_EVENT_LABEL[type]}</summary>
                    <ActionForm action={chequeEventAction.bind(null, cheque.id)} submitLabel="ثبت" size="sm" className="mt-3" confirm={`«${CHEQUE_EVENT_LABEL[type]}» ثبت شود؟ سند حسابداری مربوط صادر می‌شود.`}>
                      <input type="hidden" name="type" value={type} />
                      <div>
                        <label className="label">تاریخ</label>
                        <JDateInput name="date" defaultValue={formatJ(type === 'CLEAR' || type === 'PAY' ? (todayUtc() > cheque.dueDate ? todayUtc() : cheque.dueDate) : todayUtc(), false)} required />
                      </div>
                      {NEEDS_BANK.includes(type) && (
                        <div>
                          <label className="label">حساب بانکی</label>
                          <select name="bankAccountId" className="input" required defaultValue={cheque.bankAccountId ?? ''}>
                            <option value="">— انتخاب کنید —</option>
                            {banks.map((b) => <option key={b.id} value={b.id}>{b.dimensionValue.name}</option>)}
                          </select>
                        </div>
                      )}
                      {NEEDS_PARTY.includes(type) && (
                        <div>
                          <label className="label">واگذاری به</label>
                          <select name="partyId" className="input" required>
                            <option value="">— انتخاب کنید —</option>
                            {parties.map((p) => <option key={p.id} value={p.id}>{p.dimensionValue.name}</option>)}
                          </select>
                        </div>
                      )}
                      {['CLEAR', 'PAY', 'BOUNCE'].includes(type) && (
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="label">کارمزد بانکی (ریال)</label>
                            <input name="feeAmount" dir="ltr" inputMode="numeric" className="input num" defaultValue="0" />
                          </div>
                          <div>
                            <label className="label">کسب‌وکار کارمزد</label>
                            <select name="businessDimId" className="input" defaultValue={cheque.businessDimId ?? ''}>
                              <option value="">—</option>
                              {businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                            </select>
                          </div>
                        </div>
                      )}
                      <div>
                        <label className="label">توضیح</label>
                        <input name="description" className="input" />
                      </div>
                    </ActionForm>
                  </details>
                ))}
              </div>
            </Card>
          ) : (
            <Card title="عملیات روی چک"><p className="text-sm text-muted">در وضعیت فعلی عملیاتی باقی نمانده است.</p></Card>
          )}

          {can(user, 'voucher.edit') && (
            <Card title="اصلاح اطلاعات توصیفی">
              <ActionForm action={updateChequeNotesAction.bind(null, cheque.id)} submitLabel="ذخیره" size="sm">
                <div><label className="label">بابت</label><input name="description" className="input" defaultValue={cheque.description ?? ''} /></div>
                <div><label className="label">نام روی چک</label><input name="counterpartyName" className="input" defaultValue={cheque.counterpartyName ?? ''} /></div>
                <div><label className="label">صاحب حساب</label><input name="drawerName" className="input" defaultValue={cheque.drawerName ?? ''} /></div>
                <div><label className="label">شناسهٔ صیاد</label><input name="sayadId" dir="ltr" className="input" defaultValue={cheque.sayadId ?? ''} /></div>
                <div><label className="label">محل نگهداری</label><input name="location" className="input" defaultValue={cheque.location ?? ''} /></div>
                <p className="text-xs text-muted">مبلغ، تاریخ سررسید و طرف حساب بعد از صدور سند قابل تغییر نیستند؛ در صورت اشتباه، چک را ابطال و دوباره ثبت کنید.</p>
              </ActionForm>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
