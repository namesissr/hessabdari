'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import type { PayMethod, TreasuryType } from '@prisma/client';
import { SearchSelect, type Option } from '@/components/search-select';
import { JDateInput } from '@/components/jdate-input';
import { buttonClass } from '@/components/ui';
import { formatMoney } from '@/lib/money';
import { toLatinDigits } from '@/lib/jalali';
import { cn } from '@/lib/utils';
import { saveTreasuryAction, type TreasuryPayload } from './actions';

type Opt = { id: string; name: string; hint?: string };
type ChequeOpt = { id: string; label: string; amount: string };
type InvoiceOpt = { id: string; partyId: string; type: string; remaining: string; label: string };

const digits = (v: string) => toLatinDigits(v).replace(/\D/g, '').replace(/^0+(?=\d)/, '');
const group = (v: string) => (v ? v.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '');

function Money({ value, onChange, className }: { value: string; onChange: (v: string) => void; className?: string }) {
  return <input dir="ltr" inputMode="numeric" className={cn('input num', className)} value={group(value)} onChange={(e) => onChange(digits(e.target.value))} />;
}

type ItemRow = TreasuryPayload['items'][number] & { key: string };
type AllocRow = TreasuryPayload['allocations'][number] & { key: string };

let seq = 0;
const key = () => `r${Date.now()}-${seq++}`;
const emptyCheque = () => ({ serialNo: '', sayadId: '', dueDate: '', bankName: '', branch: '', accountNo: '', drawerName: '', bankAccountId: '', chequeBookId: '', isGuarantee: false });
const emptyItem = (method: PayMethod): ItemRow => ({ key: key(), method, bankAccountId: '', toBankAccountId: '', chequeId: '', amount: '', feeAmount: '', reference: '', cheque: emptyCheque() });
const emptyAlloc = (): AllocRow => ({ key: key(), accountId: '', partyId: '', businessDimId: '', costCenterDimId: '', projectDimId: '', invoiceId: '', amount: '', description: '' });

export function TreasuryForm({
  entityId,
  type,
  txnId,
  initial,
  banks,
  parties,
  accounts,
  businesses,
  costCenters,
  projects,
  openCheques,
  invoices,
  chequeBooks,
  canPost,
  defaultDate,
}: {
  entityId: string;
  type: TreasuryType;
  txnId?: string | null;
  initial?: { date: string; partyId: string; description: string; businessDimId: string; projectDimId: string; items: ItemRow[]; allocations: AllocRow[] } | null;
  banks: (Opt & { kind: string })[];
  parties: Opt[];
  accounts: Opt[];
  businesses: Opt[];
  costCenters: Opt[];
  projects: Opt[];
  openCheques: ChequeOpt[];
  invoices: InvoiceOpt[];
  chequeBooks: Opt[];
  canPost: boolean;
  defaultDate: string;
}) {
  const router = useRouter();
  const isTransfer = type === 'TRANSFER';
  const isReceipt = type === 'RECEIPT';
  const [date, setDate] = useState(initial?.date ?? defaultDate);
  const [partyId, setPartyId] = useState(initial?.partyId ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [businessDimId, setBusiness] = useState(initial?.businessDimId ?? '');
  const [projectDimId, setProject] = useState(initial?.projectDimId ?? '');
  const [items, setItems] = useState<ItemRow[]>(initial?.items?.length ? initial.items : [emptyItem(isTransfer ? 'BANK' : 'BANK')]);
  const [allocs, setAllocs] = useState<AllocRow[]>(initial?.allocations?.length ? initial.allocations : isTransfer ? [] : [emptyAlloc()]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const opt = (list: Opt[]): Option[] => list.map((o) => ({ value: o.id, label: o.name, hint: o.hint }));
  const bankOpts = useMemo(() => opt(banks), [banks]);
  const partyOpts = useMemo(() => opt(parties), [parties]);
  const accountOpts = useMemo(() => opt(accounts), [accounts]);
  const invoiceOpts = useMemo(
    () => invoices.filter((i) => (isReceipt ? i.type === "SALES" : i.type === "PURCHASE")).filter((i) => !partyId || i.partyId === partyId),
    [invoices, isReceipt, partyId],
  );
  const chequeOpts = useMemo(() => openCheques.map((c) => ({ value: c.id, label: c.label })), [openCheques]);

  const totalItems = items.reduce((s, i) => s + BigInt(i.amount || '0'), 0n);
  const totalAllocs = allocs.reduce((s, a) => s + BigInt(a.amount || '0'), 0n);
  const diff = totalItems - totalAllocs;

  const methods: { value: PayMethod; label: string }[] = isTransfer
    ? [{ value: 'BANK', label: 'انتقال بانکی' }]
    : [
        { value: 'BANK', label: 'واریز/برداشت بانکی' },
        { value: 'CASH', label: 'نقد / صندوق' },
        { value: 'CARD', label: 'کارت به کارت / کارت‌خوان' },
        { value: 'GATEWAY', label: 'درگاه پرداخت' },
        { value: 'CHEQUE_NEW', label: isReceipt ? 'چک دریافتی (جدید)' : 'چک صادره (جدید)' },
        ...(isReceipt ? [] : [{ value: 'CHEQUE_ENDORSE' as PayMethod, label: 'واگذاری چک دریافتی' }]),
      ];

  const updItem = (k: string, patch: Partial<ItemRow>) => setItems((xs) => xs.map((x) => (x.key === k ? { ...x, ...patch } : x)));
  const updCheque = (k: string, patch: Partial<NonNullable<ItemRow['cheque']>>) =>
    setItems((xs) => xs.map((x) => (x.key === k ? { ...x, cheque: { ...(x.cheque ?? emptyCheque()), ...patch } } : x)));
  const updAlloc = (k: string, patch: Partial<AllocRow>) => setAllocs((xs) => xs.map((x) => (x.key === k ? { ...x, ...patch } : x)));

  const balanceAlloc = (k: string) => {
    const row = allocs.find((a) => a.key === k)!;
    const rest = diff + BigInt(row.amount || '0');
    if (rest > 0n) updAlloc(k, { amount: rest.toString() });
  };

  const save = (post: boolean) => {
    setError(null);
    start(async () => {
      const r = await saveTreasuryAction({
        id: txnId ?? null,
        entityId,
        type,
        date,
        partyId,
        description,
        businessDimId,
        projectDimId,
        post,
        items: items.map(({ key: _k, ...i }) => i),
        allocations: allocs.map(({ key: _k, ...a }) => a),
      });
      if (!r.ok) setError(r.error);
      else if (r.redirect) {
        router.push(r.redirect);
        router.refresh();
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-xl border border-line bg-white p-4 md:grid-cols-5">
        <div>
          <label className="label">تاریخ *</label>
          <JDateInput value={date} onChange={setDate} required />
        </div>
        {!isTransfer && (
          <div>
            <label className="label">طرف حساب {isReceipt ? '(پرداخت‌کننده)' : '(دریافت‌کننده)'}</label>
            <SearchSelect options={partyOpts} value={partyId} onChange={setPartyId} placeholder="نام شخص یا شرکت…" />
          </div>
        )}
        <div className={isTransfer ? 'md:col-span-2' : ''}>
          <label className="label">شرح</label>
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="مثلاً تسویهٔ فاکتور ۱۰۲" />
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
      </div>

      <div className="rounded-xl border border-line bg-white">
        <div className="border-b border-line px-4 py-2.5 text-sm font-semibold">
          {isTransfer ? 'انتقال' : isReceipt ? 'دریافت از طریق' : 'پرداخت از طریق'}
        </div>
        <div className="space-y-3 p-4">
          {items.map((i) => (
            <div key={i.key} className="rounded-lg border border-line p-3">
              <div className="grid gap-3 md:grid-cols-5">
                <div>
                  <label className="label">روش</label>
                  <select className="input" value={i.method} onChange={(e) => updItem(i.key, { method: e.target.value as PayMethod })}>
                    {methods.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
                {(['BANK', 'CASH', 'CARD', 'GATEWAY'] as string[]).includes(i.method) && (
                  <div>
                    <label className="label">{isTransfer ? 'از حساب *' : 'حساب بانکی / صندوق *'}</label>
                    <SearchSelect options={bankOpts} value={i.bankAccountId} onChange={(v) => updItem(i.key, { bankAccountId: v })} />
                  </div>
                )}
                {isTransfer && (
                  <div>
                    <label className="label">به حساب *</label>
                    <SearchSelect options={bankOpts} value={i.toBankAccountId} onChange={(v) => updItem(i.key, { toBankAccountId: v })} />
                  </div>
                )}
                {i.method === 'CHEQUE_ENDORSE' && (
                  <div className="md:col-span-2">
                    <label className="label">چک دریافتی *</label>
                    <SearchSelect options={chequeOpts} value={i.chequeId} onChange={(v) => updItem(i.key, { chequeId: v, amount: openCheques.find((c) => c.id === v)?.amount ?? i.amount })} />
                  </div>
                )}
                <div>
                  <label className="label">مبلغ (ریال) *</label>
                  <Money value={i.amount} onChange={(v) => updItem(i.key, { amount: v })} />
                </div>
                <div>
                  <label className="label">کارمزد بانکی</label>
                  <Money value={i.feeAmount} onChange={(v) => updItem(i.key, { feeAmount: v })} />
                </div>
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <label className="label">شمارهٔ پیگیری / توضیح</label>
                    <input className="input" value={i.reference} onChange={(e) => updItem(i.key, { reference: e.target.value })} />
                  </div>
                  <button type="button" className="mb-1 rounded p-2 text-red-500 hover:bg-red-50" onClick={() => setItems((xs) => (xs.length > 1 ? xs.filter((x) => x.key !== i.key) : xs))}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {i.method === 'CHEQUE_NEW' && (
                <div className="mt-3 grid gap-3 rounded-lg bg-slate-50 p-3 md:grid-cols-4">
                  <div>
                    <label className="label">شمارهٔ چک *</label>
                    <input dir="ltr" className="input" value={i.cheque?.serialNo ?? ''} onChange={(e) => updCheque(i.key, { serialNo: e.target.value })} />
                  </div>
                  <div>
                    <label className="label">سررسید *</label>
                    <JDateInput value={i.cheque?.dueDate ?? ''} onChange={(v) => updCheque(i.key, { dueDate: v })} />
                  </div>
                  <div>
                    <label className="label">شناسهٔ صیاد</label>
                    <input dir="ltr" className="input" value={i.cheque?.sayadId ?? ''} onChange={(e) => updCheque(i.key, { sayadId: e.target.value })} />
                  </div>
                  {isReceipt ? (
                    <>
                      <div>
                        <label className="label">بانک صادرکننده</label>
                        <input className="input" value={i.cheque?.bankName ?? ''} onChange={(e) => updCheque(i.key, { bankName: e.target.value })} />
                      </div>
                      <div>
                        <label className="label">شمارهٔ حساب صادرکننده</label>
                        <input dir="ltr" className="input" value={i.cheque?.accountNo ?? ''} onChange={(e) => updCheque(i.key, { accountNo: e.target.value })} />
                      </div>
                      <div>
                        <label className="label">صاحب حساب</label>
                        <input className="input" value={i.cheque?.drawerName ?? ''} onChange={(e) => updCheque(i.key, { drawerName: e.target.value })} />
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <label className="label">از حساب بانکی ما *</label>
                        <SearchSelect options={bankOpts.filter((b) => banks.find((x) => x.id === b.value)?.kind === 'BANK')} value={i.cheque?.bankAccountId ?? ''} onChange={(v) => updCheque(i.key, { bankAccountId: v })} />
                      </div>
                      <div>
                        <label className="label">دسته‌چک</label>
                        <select className="input" value={i.cheque?.chequeBookId ?? ''} onChange={(e) => updCheque(i.key, { chequeBookId: e.target.value })}>
                          <option value="">—</option>
                          {chequeBooks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                        </select>
                      </div>
                    </>
                  )}
                  <label className="flex items-end gap-2 pb-2 text-sm">
                    <input type="checkbox" checked={!!i.cheque?.isGuarantee} onChange={(e) => updCheque(i.key, { isGuarantee: e.target.checked })} /> تضمینی
                  </label>
                </div>
              )}
            </div>
          ))}
          <button type="button" className={buttonClass('secondary', 'sm')} onClick={() => setItems((xs) => [...xs, emptyItem(isTransfer ? 'BANK' : 'BANK')])}>
            <Plus className="h-4 w-4" /> ردیف جدید
          </button>
          <div className="text-sm font-semibold">جمع: <span className="num">{formatMoney(totalItems, { zero: '۰' })}</span> ریال</div>
        </div>
      </div>

      {!isTransfer && (
        <div className="rounded-xl border border-line bg-white">
          <div className="border-b border-line px-4 py-2.5 text-sm font-semibold">
            بابت (این پول بابت چه حسابی بود؟)
          </div>
          <div className="overflow-x-auto p-4">
            <table className="table min-w-[1000px]">
              <thead>
                <tr>
                  <th className="w-64">حساب معین</th>
                  <th className="w-48">طرف حساب</th>
                  <th className="w-40">کسب‌وکار</th>
                  <th className="w-40">مرکز هزینه</th>
                  <th className="w-56">تطبیق با فاکتور</th>
                  <th className="w-40">مبلغ</th>
                  <th>شرح</th>
                  <th className="w-20" />
                </tr>
              </thead>
              <tbody>
                {allocs.map((a) => (
                  <tr key={a.key}>
                    <td><SearchSelect options={accountOpts} value={a.accountId} onChange={(v) => updAlloc(a.key, { accountId: v })} placeholder="کد یا نام حساب…" /></td>
                    <td><SearchSelect options={partyOpts} value={a.partyId} onChange={(v) => updAlloc(a.key, { partyId: v })} /></td>
                    <td>
                      <select className="input" value={a.businessDimId} onChange={(e) => updAlloc(a.key, { businessDimId: e.target.value })}>
                        <option value="">—</option>
                        {businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                      </select>
                    </td>
                    <td>
                      <select className="input" value={a.costCenterDimId} onChange={(e) => updAlloc(a.key, { costCenterDimId: e.target.value })}>
                        <option value="">—</option>
                        {costCenters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </td>
                    <td>
                      <select className="input" value={a.invoiceId} onChange={(e) => { const inv = invoiceOpts.find((x) => x.id === e.target.value); updAlloc(a.key, { invoiceId: e.target.value, amount: inv && !a.amount ? inv.remaining : a.amount, partyId: inv ? inv.partyId : a.partyId }); }}>
                        <option value="">—</option>
                        {invoiceOpts.map((inv) => <option key={inv.id} value={inv.id}>{inv.label}</option>)}
                      </select>
                    </td>
                    <td><Money value={a.amount} onChange={(v) => updAlloc(a.key, { amount: v })} /></td>
                    <td><input className="input" value={a.description} onChange={(e) => updAlloc(a.key, { description: e.target.value })} /></td>
                    <td className="whitespace-nowrap">
                      <button type="button" title="مانده را در این ردیف بگذار" className="rounded p-1.5 text-slate-500 hover:bg-slate-100" onClick={() => balanceAlloc(a.key)}>=</button>
                      <button type="button" className="rounded p-1.5 text-red-500 hover:bg-red-50" onClick={() => setAllocs((xs) => (xs.length > 1 ? xs.filter((x) => x.key !== a.key) : xs))}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5}>
                    <button type="button" className={buttonClass('secondary', 'sm')} onClick={() => setAllocs((xs) => [...xs, emptyAlloc()])}>
                      <Plus className="h-4 w-4" /> ردیف جدید
                    </button>
                  </td>
                  <td className="num">{formatMoney(totalAllocs, { zero: '۰' })}</td>
                  <td colSpan={2} className={cn('text-sm', diff === 0n ? 'text-emerald-700' : 'text-red-600')}>
                    {diff === 0n ? (totalItems > 0n ? 'تراز است' : '') : `اختلاف: ${formatMoney(diff < 0n ? -diff : diff)}`}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={pending} className={buttonClass('primary')} onClick={() => save(false)}>
          {pending ? 'در حال ذخیره…' : 'ذخیرهٔ پیش‌نویس'}
        </button>
        {canPost && (
          <button type="button" disabled={pending || totalItems === 0n || (!isTransfer && diff !== 0n)} className={buttonClass('success')} onClick={() => save(true)}>
            ذخیره و قطعی کردن
          </button>
        )}
        <button type="button" className={buttonClass('ghost')} onClick={() => router.back()}>انصراف</button>
      </div>
    </div>
  );
}
