import Link from 'next/link';
import { notFound } from 'next/navigation';
import prisma from '@/lib/prisma';
import { assertEntityAccess, can } from '@/lib/auth';
import { formatJ, toFaDigits, todayUtc } from '@/lib/jalali';
import { pageContext } from '@/lib/page';
import { METHOD_LABEL, TREASURY_TYPE_LABEL } from '@/modules/treasury/treasury';
import { Badge, Card, Empty, LinkButton, Money, PageHeader } from '@/components/ui';
import { ActionForm } from '@/components/action-form';
import { JDateInput } from '@/components/jdate-input';
import { PrintButton } from '@/components/print-button';
import { loadTreasuryFormData } from '../form-data';
import { TreasuryForm } from '../treasury-form';
import { deleteTreasuryAction, postTreasuryAction, reverseTreasuryAction } from '../actions';

export const metadata = { title: 'سند خزانه' };

export default async function TreasuryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, fiscalYear } = await pageContext();
  const txn = await prisma.treasuryTxn.findUnique({
    where: { id },
    include: {
      entity: true,
      party: { include: { dimensionValue: true } },
      createdBy: { select: { name: true } },
      voucher: { include: { reversedBy: true } },
      items: { include: { bankAccount: { include: { dimensionValue: true } }, toBankAccount: { include: { dimensionValue: true } }, cheque: true } },
      allocations: { include: { account: true, party: { include: { dimensionValue: true } } } },
    },
  });
  if (!txn) notFound();
  assertEntityAccess(user, txn.entityId);

  const dimIds = [...new Set(txn.allocations.flatMap((a) => [a.businessDimId, a.costCenterDimId, a.projectDimId]).filter(Boolean) as string[])];
  const dimNames = new Map((await prisma.dimensionValue.findMany({ where: { id: { in: dimIds } } })).map((d) => [d.id, d.name]));
  const reversed = !!txn.voucher?.reversedBy;
  const editable = txn.status === 'DRAFT' && can(user, 'voucher.edit');

  if (editable) {
    const data = await loadTreasuryFormData(txn.entityId);
    return (
      <>
        <PageHeader title={`ویرایش ${TREASURY_TYPE_LABEL[txn.type]} شمارهٔ ${toFaDigits(txn.number)}`} subtitle="این سند هنوز قطعی نشده و در دفاتر اثری ندارد." />
        <TreasuryForm
          entityId={txn.entityId}
          type={txn.type}
          txnId={txn.id}
          canPost={can(user, 'voucher.post')}
          defaultDate={formatJ(txn.date, false)}
          initial={{
            date: formatJ(txn.date, false),
            partyId: txn.partyId ?? '',
            description: txn.description ?? '',
            businessDimId: txn.businessDimId ?? '',
            projectDimId: txn.projectDimId ?? '',
            items: txn.items.map((i) => ({
              key: i.id,
              method: i.method,
              bankAccountId: i.bankAccountId ?? '',
              toBankAccountId: i.toBankAccountId ?? '',
              chequeId: i.chequeId ?? '',
              amount: i.amount.toString(),
              feeAmount: i.feeAmount.toString(),
              reference: i.reference ?? '',
              cheque: (i.meta as { cheque?: Record<string, string> } | null)?.cheque
                ? {
                    serialNo: String((i.meta as { cheque: Record<string, string> }).cheque.serialNo ?? ''),
                    sayadId: String((i.meta as { cheque: Record<string, string> }).cheque.sayadId ?? ''),
                    dueDate: (i.meta as { cheque: Record<string, string> }).cheque.dueDate ? formatJ(new Date((i.meta as { cheque: Record<string, string> }).cheque.dueDate), false) : '',
                    bankName: String((i.meta as { cheque: Record<string, string> }).cheque.bankName ?? ''),
                    branch: String((i.meta as { cheque: Record<string, string> }).cheque.branch ?? ''),
                    accountNo: String((i.meta as { cheque: Record<string, string> }).cheque.accountNo ?? ''),
                    drawerName: String((i.meta as { cheque: Record<string, string> }).cheque.drawerName ?? ''),
                    bankAccountId: String((i.meta as { cheque: Record<string, string> }).cheque.bankAccountId ?? ''),
                    chequeBookId: String((i.meta as { cheque: Record<string, string> }).cheque.chequeBookId ?? ''),
                    isGuarantee: Boolean((i.meta as { cheque: Record<string, unknown> }).cheque.isGuarantee),
                  }
                : null,
            })),
            allocations: txn.allocations.map((a) => ({
              key: a.id,
              accountId: a.accountId,
              partyId: a.partyId ?? '',
              businessDimId: a.businessDimId ?? '',
              costCenterDimId: a.costCenterDimId ?? '',
              projectDimId: a.projectDimId ?? '',
              invoiceId: a.invoiceId ?? '',
              amount: a.amount.toString(),
              description: a.description ?? '',
            })),
          }}
          {...data}
        />
        <div className="mt-4">
          <ActionForm inline action={deleteTreasuryAction.bind(null, txn.id)} submitLabel="حذف پیش‌نویس" variant="danger" size="sm" confirm="این پیش‌نویس حذف شود؟" />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={`${TREASURY_TYPE_LABEL[txn.type]} شمارهٔ ${toFaDigits(txn.number)}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {reversed ? <Badge tone="red">برگشت‌خورده</Badge> : <Badge tone={txn.status === 'POSTED' ? 'green' : 'amber'}>{txn.status === 'POSTED' ? 'قطعی' : 'پیش‌نویس'}</Badge>}
            <span>{formatJ(txn.date)}</span>
            <span>{txn.entity.name}</span>
          </span>
        }
        actions={
          <>
            {txn.status === 'DRAFT' && can(user, 'voucher.post') && (
              <ActionForm inline action={postTreasuryAction.bind(null, txn.id)} submitLabel="قطعی کردن" variant="success" confirm="سند حسابداری صادر و قطعی شود؟" />
            )}
            {txn.voucherId && <LinkButton href={`/vouchers/${txn.voucherId}`}>سند حسابداری</LinkButton>}
            <PrintButton label="چاپ رسید" />
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <Card title="اطلاعات سند">
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
              <div><dt className="text-muted">طرف حساب</dt><dd>{txn.party?.dimensionValue.name ?? '—'}</dd></div>
              <div><dt className="text-muted">مبلغ کل</dt><dd className="font-bold"><Money value={txn.totalAmount} /> ریال</dd></div>
              <div><dt className="text-muted">ثبت‌کننده</dt><dd className="text-xs">{txn.createdBy.name}</dd></div>
              <div className="sm:col-span-3"><dt className="text-muted">شرح</dt><dd>{txn.description ?? '—'}</dd></div>
            </dl>
          </Card>

          <Card title={txn.type === 'TRANSFER' ? 'انتقال' : txn.type === 'RECEIPT' ? 'دریافت از طریق' : 'پرداخت از طریق'} bodyClass="p-0">
            <table className="table">
              <thead>
                <tr><th>روش</th><th>حساب</th><th>مبلغ</th><th>کارمزد</th><th>پیگیری / چک</th></tr>
              </thead>
              <tbody>
                {txn.items.map((i) => (
                  <tr key={i.id}>
                    <td>{METHOD_LABEL[i.method]}</td>
                    <td className="text-xs">
                      {i.bankAccount?.dimensionValue.name ?? '—'}
                      {i.toBankAccount && <span> ← {i.toBankAccount.dimensionValue.name}</span>}
                    </td>
                    <td><Money value={i.amount} /></td>
                    <td>{i.feeAmount > 0n ? <Money value={i.feeAmount} /> : '—'}</td>
                    <td className="text-xs">
                      {i.reference}
                      {i.cheque && (
                        <Link className="text-brand-700 hover:underline" href={`/cheques/${i.cheque.id}`}>
                          چک {i.cheque.serialNo} — سررسید {formatJ(i.cheque.dueDate)}
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {txn.allocations.length > 0 && (
            <Card title="بابت" bodyClass="p-0">
              <table className="table">
                <thead>
                  <tr><th>حساب</th><th>طرف حساب</th><th>کسب‌وکار / مرکز هزینه</th><th>مبلغ</th><th>شرح</th></tr>
                </thead>
                <tbody>
                  {txn.allocations.map((a) => (
                    <tr key={a.id}>
                      <td><span className="num ml-1 text-xs text-muted">{a.account.code}</span>{a.account.name}</td>
                      <td className="text-xs">{a.party?.dimensionValue.name ?? '—'}</td>
                      <td className="text-xs">{[a.businessDimId, a.costCenterDimId, a.projectDimId].filter(Boolean).map((d) => dimNames.get(d as string)).join(' / ') || '—'}</td>
                      <td><Money value={a.amount} /></td>
                      <td className="text-xs">{a.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          {txn.status === 'POSTED' && !reversed && can(user, 'voucher.post') && fiscalYear?.status === 'OPEN' && (
            <Card title="برگشت سند" className="no-print">
              <ActionForm action={reverseTreasuryAction.bind(null, txn.id)} submitLabel="صدور سند برگشت" variant="danger" confirm="سند حسابداری این دریافت/پرداخت برگشت می‌خورد. ادامه؟">
                <p className="text-xs text-muted">سند قطعی حذف نمی‌شود؛ با سند برگشت اثر آن در دفاتر خنثی می‌شود. اگر این سند چک داشته باشد، ابتدا باید وضعیت چک اصلاح شود.</p>
                <div>
                  <label className="label">تاریخ برگشت</label>
                  <JDateInput name="date" defaultValue={formatJ(todayUtc(), false)} />
                </div>
              </ActionForm>
            </Card>
          )}
          {reversed && txn.voucher?.reversedBy && (
            <Card title="برگشت">
              <p className="text-sm">
                این سند با <Link className="text-brand-700 hover:underline" href={`/vouchers/${txn.voucher.reversedBy.id}`}>سند شمارهٔ {toFaDigits(txn.voucher.reversedBy.number ?? 0)}</Link> برگشت خورده است.
              </p>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
