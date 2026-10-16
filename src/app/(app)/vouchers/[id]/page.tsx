import Link from 'next/link';
import { notFound } from 'next/navigation';
import prisma from '@/lib/prisma';
import { assertEntityAccess, can } from '@/lib/auth';
import { formatJ, toFaDigits, todayUtc } from '@/lib/jalali';
import { one, pageContext, type SP } from '@/lib/page';
import { loadSets } from '@/modules/dimensions/sets';
import { Badge, Card, LinkButton, Money, PageHeader, STATUS_LABEL, TYPE_LABEL } from '@/components/ui';
import { ActionForm } from '@/components/action-form';
import { JDateInput } from '@/components/jdate-input';
import { PrintButton } from '@/components/print-button';
import { loadEditorData } from '../editor-data';
import { VoucherEditor } from '../voucher-editor';
import { deleteAction, postAction, reverseAction, reviewAction } from '../actions';
import { templateFromVoucherAction } from '../../templates/actions';

export const metadata = { title: 'سند حسابداری' };

export default async function VoucherPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { id } = await params;
  const sp = await searchParams;
  const { user } = await pageContext();
  const v = await prisma.voucher.findUnique({
    where: { id },
    include: {
      entity: true,
      fiscalYear: true,
      period: true,
      lines: { orderBy: { lineNo: 'asc' }, include: { account: true, dimensionSet: { include: { items: true } } } },
      createdBy: { select: { name: true } },
      reviewedBy: { select: { name: true } },
      postedBy: { select: { name: true } },
      reversalOf: { select: { id: true, number: true } },
      reversedBy: { select: { id: true, number: true } },
    },
  });
  if (!v) notFound();
  assertEntityAccess(user, v.entityId);

  const editable = v.status !== 'POSTED' && !v.sourceModule && can(user, 'voucher.edit') && v.fiscalYear.status === 'OPEN';
  const err = one(sp.err);
  const st = STATUS_LABEL[v.status];
  const title = v.number ? `سند شمارهٔ ${toFaDigits(v.number)}` : `یادداشت موقت ${toFaDigits(v.draftNo)}`;

  const actions = (
    <>
      {v.status !== 'POSTED' && can(user, 'voucher.edit') && (
        <ActionForm inline action={reviewAction.bind(null, v.id, v.status === 'DRAFT')} submitLabel={v.status === 'DRAFT' ? 'علامت بررسی‌شده' : 'برگشت به یادداشت'} variant="secondary" />
      )}
      {v.status !== 'POSTED' && can(user, 'voucher.post') && (
        <ActionForm inline action={postAction.bind(null, v.id)} submitLabel="قطعی کردن" variant="success" confirm="سند قطعی دیگر قابل ویرایش یا حذف نیست. ادامه می‌دهید؟" />
      )}
      {v.status !== 'POSTED' && can(user, 'voucher.edit') && (
        <ActionForm inline action={deleteAction.bind(null, v.id)} submitLabel="حذف یادداشت" variant="danger" confirm="یادداشت حذف شود؟" />
      )}
      <LinkButton href={`/vouchers/new?copy=${v.id}`}>کپی به سند جدید</LinkButton>
      <PrintButton />
    </>
  );

  if (editable) {
    const data = await loadEditorData(v.entityId);
    return (
      <>
        <PageHeader title={title} subtitle={<><Badge tone={st.tone}>{st.label}</Badge> <span className="mr-2">{v.entity.name}</span></>} actions={actions} />
        {err && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">قطعی نشد: {err}</div>}
        <VoucherEditor
          entityId={v.entityId}
          voucherId={v.id}
          initial={{
            date: formatJ(v.date, false),
            type: v.type,
            description: v.description ?? '',
            lines: v.lines.map((l) => ({
              key: l.id,
              accountId: l.accountId,
              debit: l.debit > 0n ? l.debit.toString() : '',
              credit: l.credit > 0n ? l.credit.toString() : '',
              description: l.description ?? '',
              dims: Object.fromEntries(l.dimensionSet.items.map((it) => [it.typeId, it.valueId])),
            })),
          }}
          accounts={data.accounts}
          types={data.types}
          values={data.values}
          canPost={can(user, 'voucher.post')}
        />
      </>
    );
  }

  const sets = await loadSets(prisma, v.lines.map((l) => l.dimensionSetId));
  let debit = 0n, credit = 0n;
  v.lines.forEach((l) => { debit += l.debit; credit += l.credit; });

  return (
    <>
      <PageHeader title={title} subtitle={<><Badge tone={st.tone}>{st.label}</Badge> <span className="mr-2">{v.entity.name}</span></>} actions={actions} />
      {err && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>}
      <Card className="mb-4">
        <div className="hidden print:block mb-3 text-center">
          <div className="text-lg font-bold">{v.entity.legalName ?? v.entity.name}</div>
          <div>سند حسابداری</div>
        </div>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-muted">شمارهٔ سند</dt><dd className="font-semibold">{v.number ? toFaDigits(v.number) : '—'}</dd></div>
          <div><dt className="text-muted">شمارهٔ موقت / روزانه</dt><dd>{toFaDigits(v.draftNo)} / {v.dailyNo ? toFaDigits(v.dailyNo) : '—'}</dd></div>
          <div><dt className="text-muted">تاریخ</dt><dd>{formatJ(v.date)} <span className="text-xs text-muted">({v.period.title})</span></dd></div>
          <div><dt className="text-muted">نوع</dt><dd>{TYPE_LABEL[v.type]}{v.sourceModule && <span className="text-xs text-muted"> — صادره از {v.sourceModule}</span>}</dd></div>
          <div className="sm:col-span-2 lg:col-span-4"><dt className="text-muted">شرح</dt><dd>{v.description || '—'}</dd></div>
          {v.reversalOf && <div><dt className="text-muted">برگشت سند</dt><dd><Link className="text-brand-700" href={`/vouchers/${v.reversalOf.id}`}>شمارهٔ {toFaDigits(v.reversalOf.number ?? 0)}</Link></dd></div>}
          {v.reversedBy && <div><dt className="text-muted">برگشت‌خورده با</dt><dd><Link className="text-brand-700" href={`/vouchers/${v.reversedBy.id}`}>سند {toFaDigits(v.reversedBy.number ?? 0)}</Link></dd></div>}
        </dl>
      </Card>
      <Card bodyClass="p-0" className="mb-4">
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>ردیف</th>
                <th>کد</th>
                <th>حساب</th>
                <th>تفصیلی‌ها</th>
                <th>شرح</th>
                <th>بدهکار</th>
                <th>بستانکار</th>
              </tr>
            </thead>
            <tbody>
              {v.lines.map((l) => (
                <tr key={l.id}>
                  <td className="text-muted">{toFaDigits(l.lineNo)}</td>
                  <td className="num">{l.account.code}</td>
                  <td>{l.account.name}</td>
                  <td className="text-xs">
                    {(sets.get(l.dimensionSetId) ?? []).map((d) => (
                      <span key={d.typeId} className="ml-1.5 inline-block rounded bg-slate-100 px-1.5 py-0.5">
                        <span className="text-muted">{d.typeName}: </span>{d.valueName}
                      </span>
                    ))}
                  </td>
                  <td className="text-sm">{l.description}</td>
                  <td><Money value={l.debit} /></td>
                  <td><Money value={l.credit} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5}>جمع</td>
                <td><Money value={debit} /></td>
                <td><Money value={credit} /></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="گردش سند">
          <ul className="space-y-1 text-sm">
            <li>ثبت: {v.createdBy.name} — {formatJ(v.createdAt)}</li>
            {v.reviewedBy && <li>بررسی: {v.reviewedBy.name}</li>}
            {v.postedBy && v.postedAt && <li>قطعی: {v.postedBy.name} — {formatJ(v.postedAt)}</li>}
          </ul>
        </Card>
        {can(user, 'voucher.edit') && (
          <Card title="ذخیره به عنوان قالب" className="no-print">
            <ActionForm action={templateFromVoucherAction.bind(null, v.id)} submitLabel="ساخت قالب از این سند" variant="secondary" size="sm">
              <p className="text-xs text-muted">ردیف‌ها، حساب‌ها و تفصیلی‌های همین سند به‌عنوان قالب ذخیره می‌شوند تا ماه‌های بعد با یک کلیک ثبت شود.</p>
              <div><label className="label">نام قالب</label><input name="name" className="input" defaultValue={v.description ?? ''} /></div>
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-1.5"><input type="checkbox" name="keepAmounts" defaultChecked /> مبالغ هم ذخیره شوند</label>
                <label className="flex items-center gap-1.5"><input type="checkbox" name="monthly" /> ثبت ماهانه</label>
              </div>
            </ActionForm>
          </Card>
        )}
        {v.status === 'POSTED' && !v.reversedBy && !['REVERSAL', 'OPENING', 'PL_CLOSING', 'CLOSING'].includes(v.type) && can(user, 'voucher.post') && v.fiscalYear.status === 'OPEN' && (
          <Card title="صدور سند برگشت" className="no-print">
            <ActionForm action={reverseAction.bind(null, v.id)} submitLabel="صدور و قطعی کردن سند برگشت" variant="danger" confirm="سند برگشت با ردیف‌های معکوس صادر و قطعی می‌شود. ادامه؟">
              <p className="text-xs text-muted">سند قطعی حذف یا ویرایش نمی‌شود؛ برای اصلاح، سند برگشت صادر و سپس سند صحیح ثبت کنید.</p>
              <div className="grid gap-3 sm:grid-cols-[150px_1fr]">
                <div>
                  <label className="label">تاریخ برگشت</label>
                  <JDateInput name="date" defaultValue={formatJ(todayUtc() > v.fiscalYear.endDate ? v.fiscalYear.endDate : todayUtc() < v.date ? v.date : todayUtc(), false)} />
                </div>
                <div>
                  <label className="label">شرح (اختیاری)</label>
                  <input name="description" className="input" />
                </div>
              </div>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
