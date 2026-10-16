'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import type { InvoiceType } from '@prisma/client';
import { SearchSelect, type Option } from '@/components/search-select';
import { JDateInput } from '@/components/jdate-input';
import { buttonClass } from '@/components/ui';
import { formatMoney } from '@/lib/money';
import { toLatinDigits } from '@/lib/jalali';
import { cn } from '@/lib/utils';
import { saveInvoiceAction, type InvoicePayload } from './actions';

type Opt = { id: string; name: string; hint?: string };
type Row = InvoicePayload['lines'][number] & { key: string };

const digits = (v: string) => toLatinDigits(v).replace(/\D/g, '').replace(/^0+(?=\d)/, '');
const group = (v: string) => (v ? v.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '');

let seq = 0;
const emptyRow = (taxRate: string): Row => ({
  key: `r${Date.now()}-${seq++}`,
  title: '',
  accountId: '',
  quantity: '1',
  unitPrice: '',
  discount: '',
  taxRate,
  businessDimId: '',
  costCenterDimId: '',
  projectDimId: '',
  description: '',
});

export function InvoiceForm({
  entityId,
  type,
  invoiceId,
  initial,
  parties,
  accounts,
  businesses,
  costCenters,
  projects,
  defaultDate,
  defaultTaxRate,
  canPost,
}: {
  entityId: string;
  type: InvoiceType;
  invoiceId?: string | null;
  initial?: { date: string; dueDate: string; partyId: string; businessDimId: string; projectDimId: string; reference: string; description: string; lines: Row[] } | null;
  parties: Opt[];
  accounts: Opt[];
  businesses: Opt[];
  costCenters: Opt[];
  projects: Opt[];
  defaultDate: string;
  defaultTaxRate: string;
  canPost: boolean;
}) {
  const router = useRouter();
  const [date, setDate] = useState(initial?.date ?? defaultDate);
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? '');
  const [partyId, setParty] = useState(initial?.partyId ?? '');
  const [businessDimId, setBusiness] = useState(initial?.businessDimId ?? '');
  const [projectDimId, setProject] = useState(initial?.projectDimId ?? '');
  const [reference, setReference] = useState(initial?.reference ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [rows, setRows] = useState<Row[]>(initial?.lines?.length ? initial.lines : [emptyRow(defaultTaxRate)]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const partyOpts: Option[] = useMemo(() => parties.map((p) => ({ value: p.id, label: p.name, hint: p.hint })), [parties]);
  const accountOpts: Option[] = useMemo(() => accounts.map((a) => ({ value: a.id, label: a.name, hint: a.hint })), [accounts]);

  const calc = rows.map((r) => {
    const qty = Number(toLatinDigits(r.quantity || '0').replace(/[^\d.]/g, '')) || 0;
    const unit = BigInt(r.unitPrice || '0');
    const gross = BigInt(Math.round(qty * Number(unit)));
    const discount = BigInt(r.discount || '0');
    const net = gross - discount > 0n ? gross - discount : 0n;
    const rate = Number(toLatinDigits(r.taxRate || '0').replace(/[^\d.]/g, '')) || 0;
    const tax = (net * BigInt(Math.round(rate * 100))) / 10000n;
    return { gross, discount, net, tax, total: net + tax };
  });
  const totals = calc.reduce(
    (s, c) => ({ gross: s.gross + c.gross, discount: s.discount + c.discount, net: s.net + c.net, tax: s.tax + c.tax, total: s.total + c.total }),
    { gross: 0n, discount: 0n, net: 0n, tax: 0n, total: 0n },
  );

  const upd = (key: string, patch: Partial<Row>) => setRows((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  const save = (post: boolean) => {
    setError(null);
    start(async () => {
      const r = await saveInvoiceAction({
        id: invoiceId ?? null,
        entityId,
        type,
        date,
        dueDate,
        partyId,
        businessDimId,
        projectDimId,
        reference,
        description,
        post,
        lines: rows.map(({ key: _k, ...l }) => l),
      });
      if (!r.ok) setError(r.error);
      else if (r.redirect) {
        router.push(r.redirect);
        router.refresh();
      }
    });
  };

  const isSales = type === 'SALES' || type === 'SALES_RETURN';

  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-xl border border-line bg-white p-4 md:grid-cols-6">
        <div>
          <label className="label">تاریخ *</label>
          <JDateInput value={date} onChange={setDate} required />
        </div>
        <div>
          <label className="label">سررسید</label>
          <JDateInput value={dueDate} onChange={setDueDate} />
        </div>
        <div className="md:col-span-2">
          <label className="label">{isSales ? 'مشتری *' : 'تأمین‌کننده *'}</label>
          <SearchSelect options={partyOpts} value={partyId} onChange={setParty} placeholder="نام طرف حساب…" />
        </div>
        <div>
          <label className="label">کسب‌وکار</label>
          <select className="input" value={businessDimId} onChange={(e) => setBusiness(e.target.value)}>
            <option value="">—</option>
            {businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">پروژه</label>
          <select className="input" value={projectDimId} onChange={(e) => setProject(e.target.value)}>
            <option value="">—</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="label">شمارهٔ فاکتور طرف مقابل</label>
          <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} />
        </div>
        <div className="md:col-span-4">
          <label className="label">شرح</label>
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-sm">
        <table className="table min-w-[1200px]">
          <thead>
            <tr>
              <th className="w-8">#</th>
              <th className="w-56">شرح کالا / خدمت</th>
              <th className="w-56">{isSales ? 'حساب درآمد' : 'حساب هزینه یا دارایی'}</th>
              <th className="w-20">تعداد</th>
              <th className="w-36">مبلغ واحد</th>
              <th className="w-32">تخفیف</th>
              <th className="w-20">مالیات٪</th>
              <th className="w-36">مالیات</th>
              <th className="w-40">جمع ردیف</th>
              <th className="w-32">مرکز هزینه</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key}>
                <td className="pt-3 text-center text-xs text-muted">{(i + 1).toLocaleString('fa-IR')}</td>
                <td><input className="input" value={r.title} onChange={(e) => upd(r.key, { title: e.target.value })} /></td>
                <td><SearchSelect options={accountOpts} value={r.accountId} onChange={(v) => upd(r.key, { accountId: v })} placeholder="کد یا نام حساب…" /></td>
                <td><input dir="ltr" className="input num" value={r.quantity} onChange={(e) => upd(r.key, { quantity: toLatinDigits(e.target.value).replace(/[^\d.]/g, '') })} /></td>
                <td><input dir="ltr" className="input num" value={group(r.unitPrice)} onChange={(e) => upd(r.key, { unitPrice: digits(e.target.value) })} /></td>
                <td><input dir="ltr" className="input num" value={group(r.discount)} onChange={(e) => upd(r.key, { discount: digits(e.target.value) })} /></td>
                <td><input dir="ltr" className="input num" value={r.taxRate} onChange={(e) => upd(r.key, { taxRate: toLatinDigits(e.target.value).replace(/[^\d.]/g, '') })} /></td>
                <td className="num text-xs">{formatMoney(calc[i].tax, { zero: '۰' })}</td>
                <td className="num font-semibold">{formatMoney(calc[i].total, { zero: '۰' })}</td>
                <td>
                  <select className="input" value={r.costCenterDimId} onChange={(e) => upd(r.key, { costCenterDimId: e.target.value })}>
                    <option value="">—</option>
                    {costCenters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </td>
                <td>
                  <button type="button" className="rounded p-1.5 text-red-500 hover:bg-red-50" onClick={() => setRows((xs) => (xs.length > 1 ? xs.filter((x) => x.key !== r.key) : xs))}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4}>
                <button type="button" className={buttonClass('secondary', 'sm')} onClick={() => setRows((xs) => [...xs, emptyRow(defaultTaxRate)])}>
                  <Plus className="h-4 w-4" /> ردیف جدید
                </button>
              </td>
              <td className="num">{formatMoney(totals.gross, { zero: '۰' })}</td>
              <td className="num">{formatMoney(totals.discount, { zero: '۰' })}</td>
              <td />
              <td className="num">{formatMoney(totals.tax, { zero: '۰' })}</td>
              <td className="num text-base">{formatMoney(totals.total, { zero: '۰' })}</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-white p-4">
        <div className="text-sm">
          <span className="text-muted">جمع کل فاکتور: </span>
          <span className="num text-lg font-bold">{formatMoney(totals.total, { zero: '۰' })}</span>
          <span className="mr-1 text-xs text-muted">ریال (شامل {formatMoney(totals.tax, { zero: '۰' })} مالیات)</span>
        </div>
        <div className={cn('flex flex-wrap gap-2')}>
          <button type="button" disabled={pending} className={buttonClass('primary')} onClick={() => save(false)}>
            {pending ? 'در حال ذخیره…' : 'ذخیرهٔ پیش‌نویس'}
          </button>
          {canPost && (
            <button type="button" disabled={pending || totals.total === 0n || !partyId} className={buttonClass('success')} onClick={() => save(true)}>
              ذخیره و قطعی کردن
            </button>
          )}
          <button type="button" className={buttonClass('ghost')} onClick={() => router.back()}>انصراف</button>
        </div>
      </div>

      {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
    </div>
  );
}
