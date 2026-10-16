import Link from 'next/link';
import { notFound } from 'next/navigation';
import prisma from '@/lib/prisma';
import { assertEntityAccess, can } from '@/lib/auth';
import { formatJ, toFaDigits, todayUtc } from '@/lib/jalali';
import { pageContext } from '@/lib/page';
import { amountToWords } from '@/lib/num2words';
import { INVOICE_TYPE_LABEL, isReceivableSide } from '@/modules/sales/invoices';
import { Badge, Card, Empty, LinkButton, Money, PageHeader } from '@/components/ui';
import { ActionForm } from '@/components/action-form';
import { JDateInput } from '@/components/jdate-input';
import { PrintButton } from '@/components/print-button';
import { loadInvoiceFormData } from '../form-data';
import { InvoiceForm } from '../invoice-form';
import { cancelInvoiceAction, deleteInvoiceAction, postInvoiceAction, settleInvoiceAction, unsettleAction } from '../actions';

export const metadata = { title: 'فاکتور' };

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, fiscalYear } = await pageContext();
  const inv = await prisma.invoice.findUnique({
    where: { id },
    include: {
      entity: true,
      party: { include: { dimensionValue: true } },
      createdBy: { select: { name: true } },
      lines: { orderBy: { lineNo: 'asc' }, include: { account: true } },
      settlements: { orderBy: { date: 'asc' }, include: { treasuryTxn: true, createdBy: { select: { name: true } } } },
      voucher: { include: { reversedBy: true } },
    },
  });
  if (!inv) notFound();
  assertEntityAccess(user, inv.entityId);

  const remaining = inv.total - inv.settledAmount;
  const editable = inv.status === 'DRAFT' && can(user, 'voucher.edit');
  const receivable = isReceivableSide(inv.type);

  if (editable) {
    const data = await loadInvoiceFormData(inv.entityId, inv.type);
    return (
      <>
        <PageHeader title={`ویرایش ${INVOICE_TYPE_LABEL[inv.type]} شمارهٔ ${toFaDigits(inv.number)}`} subtitle="این فاکتور هنوز قطعی نشده و در دفاتر اثری ندارد." />
        <InvoiceForm
          entityId={inv.entityId}
          type={inv.type}
          invoiceId={inv.id}
          defaultDate={formatJ(inv.date, false)}
          defaultTaxRate="10"
          canPost={can(user, 'voucher.post')}
          initial={{
            date: formatJ(inv.date, false),
            dueDate: inv.dueDate ? formatJ(inv.dueDate, false) : '',
            partyId: inv.partyId,
            businessDimId: inv.businessDimId ?? '',
            projectDimId: inv.projectDimId ?? '',
            reference: inv.reference ?? '',
            description: inv.description ?? '',
            lines: inv.lines.map((l) => ({
              key: l.id,
              title: l.title,
              accountId: l.accountId,
              quantity: l.quantity.toString(),
              unitPrice: l.unitPrice.toString(),
              discount: l.discount.toString(),
              taxRate: l.taxRate.toString(),
              businessDimId: l.businessDimId ?? '',
              costCenterDimId: l.costCenterDimId ?? '',
              projectDimId: l.projectDimId ?? '',
              description: l.description ?? '',
            })),
          }}
          {...data}
        />
        <div className="mt-4">
          <ActionForm inline action={deleteInvoiceAction.bind(null, inv.id)} submitLabel="حذف پیش‌نویس" variant="danger" size="sm" confirm="حذف شود؟" />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={`${INVOICE_TYPE_LABEL[inv.type]} شمارهٔ ${toFaDigits(inv.number)}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={inv.status === 'POSTED' ? (remaining === 0n ? 'green' : 'blue') : inv.status === 'DRAFT' ? 'amber' : 'gray'}>
              {inv.status === 'POSTED' ? (remaining === 0n ? 'تسویه‌شده' : 'قطعی') : inv.status === 'DRAFT' ? 'پیش‌نویس' : 'ابطال‌شده'}
            </Badge>
            <span>{formatJ(inv.date)}</span>
            <span>{inv.party.dimensionValue.name}</span>
          </span>
        }
        actions={
          <>
            {inv.status === 'DRAFT' && can(user, 'voucher.post') && (
              <ActionForm inline action={postInvoiceAction.bind(null, inv.id)} submitLabel="قطعی کردن" variant="success" confirm="سند حسابداری صادر شود؟" />
            )}
            {inv.voucherId && <LinkButton href={`/vouchers/${inv.voucherId}`}>سند حسابداری</LinkButton>}
            {inv.status === 'POSTED' && remaining > 0n && can(user, 'voucher.edit') && (
              <LinkButton href={`/treasury/new?type=${receivable ? 'RECEIPT' : 'PAYMENT'}`} variant="primary">
                ثبت {receivable ? 'دریافت' : 'پرداخت'}
              </LinkButton>
            )}
            <PrintButton label="چاپ فاکتور" />
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <Card>
            <div className="mb-4 hidden text-center print:block">
              <div className="text-lg font-bold">{inv.entity.legalName ?? inv.entity.name}</div>
              <div>{INVOICE_TYPE_LABEL[inv.type]} — شمارهٔ {toFaDigits(inv.number)}</div>
            </div>
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
              <div><dt className="text-muted">طرف حساب</dt><dd className="font-medium">{inv.party.dimensionValue.name}</dd></div>
              <div><dt className="text-muted">کد/شناسهٔ ملی</dt><dd className="num">{inv.party.nationalCode ? toFaDigits(inv.party.nationalCode) : '—'}</dd></div>
              <div><dt className="text-muted">تاریخ</dt><dd>{formatJ(inv.date)}</dd></div>
              <div><dt className="text-muted">سررسید</dt><dd>{inv.dueDate ? formatJ(inv.dueDate) : '—'}</dd></div>
              <div><dt className="text-muted">ارجاع</dt><dd>{inv.reference ?? '—'}</dd></div>
              <div className="sm:col-span-3"><dt className="text-muted">شرح</dt><dd>{inv.description ?? '—'}</dd></div>
            </dl>
          </Card>

          <Card bodyClass="p-0">
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr><th>#</th><th>شرح</th><th>حساب</th><th>تعداد</th><th>مبلغ واحد</th><th>تخفیف</th><th>مالیات</th><th>جمع</th></tr>
                </thead>
                <tbody>
                  {inv.lines.map((l) => (
                    <tr key={l.id}>
                      <td className="text-muted">{toFaDigits(l.lineNo)}</td>
                      <td>{l.title}</td>
                      <td className="text-xs"><span className="num">{l.account.code}</span> {l.account.name}</td>
                      <td className="num">{toFaDigits(l.quantity.toString())}</td>
                      <td><Money value={l.unitPrice} /></td>
                      <td><Money value={l.discount} /></td>
                      <td><Money value={l.taxAmount} /></td>
                      <td className="font-semibold"><Money value={l.amount + l.taxAmount} /></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr><td colSpan={5}>جمع</td><td><Money value={inv.discount} /></td><td><Money value={inv.taxAmount} /></td><td><Money value={inv.total} /></td></tr>
                </tfoot>
              </table>
            </div>
            <div className="border-t border-line px-4 py-3 text-sm">
              <span className="text-muted">مبلغ کل به حروف: </span>{amountToWords(inv.total)}
            </div>
          </Card>

          <Card title="تطبیق‌های ثبت‌شده" bodyClass="p-0">
            {inv.settlements.length === 0 ? (
              <div className="p-4 text-sm text-muted">هنوز دریافت/پرداختی به این فاکتور وصل نشده است.</div>
            ) : (
              <table className="table">
                <thead><tr><th>تاریخ</th><th>مبلغ</th><th>منبع</th><th>توضیح</th><th>کاربر</th><th /></tr></thead>
                <tbody>
                  {inv.settlements.map((s) => (
                    <tr key={s.id}>
                      <td>{formatJ(s.date)}</td>
                      <td><Money value={s.amount} /></td>
                      <td className="text-xs">
                        {s.treasuryTxn ? <Link className="text-brand-700 hover:underline" href={`/treasury/${s.treasuryTxn.id}`}>سند خزانه {toFaDigits(s.treasuryTxn.number)}</Link> : 'دستی'}
                      </td>
                      <td className="text-xs">{s.note}</td>
                      <td className="text-xs text-muted">{s.createdBy.name}</td>
                      <td className="no-print">
                        {can(user, 'voucher.edit') && <ActionForm inline action={unsettleAction.bind(null, s.id)} submitLabel="حذف" variant="ghost" size="sm" confirm="تطبیق حذف شود؟" />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>

        <div className="space-y-4 no-print">
          <Card title="وضعیت مالی فاکتور">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt>مبلغ کل</dt><dd><Money value={inv.total} /></dd></div>
              <div className="flex justify-between"><dt>تسویه‌شده</dt><dd><Money value={inv.settledAmount} /></dd></div>
              <div className="flex justify-between border-t border-line pt-2 font-bold"><dt>مانده</dt><dd><Money value={remaining} /></dd></div>
            </dl>
          </Card>

          {inv.status === 'POSTED' && remaining > 0n && can(user, 'voucher.edit') && (
            <Card title="ثبت تطبیق دستی">
              <ActionForm action={settleInvoiceAction.bind(null, inv.id)} submitLabel="ثبت تطبیق" size="sm">
                <p className="text-xs text-muted">اگر دریافت/پرداخت را در بخش خزانه ثبت کرده‌اید و فاکتور را آنجا انتخاب کرده‌اید، تطبیق خودکار ثبت می‌شود. این فرم برای موارد دستی است.</p>
                <div><label className="label">مبلغ</label><input name="amount" dir="ltr" className="input num" defaultValue={remaining.toString()} /></div>
                <div><label className="label">تاریخ</label><JDateInput name="date" defaultValue={formatJ(todayUtc(), false)} /></div>
                <div><label className="label">توضیح</label><input name="note" className="input" /></div>
              </ActionForm>
            </Card>
          )}

          {inv.status === 'POSTED' && can(user, 'voucher.post') && fiscalYear?.status === 'OPEN' && (
            <Card title="ابطال فاکتور">
              <ActionForm action={cancelInvoiceAction.bind(null, inv.id)} submitLabel="ابطال با سند برگشت" variant="danger" confirm="سند این فاکتور برگشت می‌خورد و فاکتور ابطال می‌شود. ادامه؟">
                <p className="text-xs text-muted">اگر برای فاکتور تطبیق ثبت شده باشد، ابتدا باید تطبیق‌ها حذف شوند.</p>
                <div><label className="label">تاریخ ابطال</label><JDateInput name="date" defaultValue={formatJ(todayUtc(), false)} /></div>
              </ActionForm>
            </Card>
          )}

          {inv.voucher?.reversedBy && (
            <Card title="برگشت">
              <p className="text-sm">سند این فاکتور با <Link className="text-brand-700 hover:underline" href={`/vouchers/${inv.voucher.reversedBy.id}`}>سند {toFaDigits(inv.voucher.reversedBy.number ?? 0)}</Link> برگشت خورده است.</p>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
