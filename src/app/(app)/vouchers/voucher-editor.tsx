'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, Scale, Copy } from 'lucide-react';
import type { VoucherType } from '@prisma/client';
import { SearchSelect, type Option } from '@/components/search-select';
import { JDateInput } from '@/components/jdate-input';
import { buttonClass } from '@/components/ui';
import { formatMoney } from '@/lib/money';
import { toLatinDigits } from '@/lib/jalali';
import { cn } from '@/lib/utils';
import { saveVoucherAction } from './actions';
import type { EditorAccount, EditorDimType, EditorDimValue } from './editor-data';

export type EditorLine = { key: string; accountId: string; debit: string; credit: string; description: string; dims: Record<string, string> };

let seq = 0;
const newKey = () => `l${Date.now()}-${seq++}`;
export const emptyLine = (): EditorLine => ({ key: newKey(), accountId: '', debit: '', credit: '', description: '', dims: {} });

function digits(v: string) {
  return toLatinDigits(v).replace(/[^\d]/g, '').replace(/^0+(?=\d)/, '');
}
function group(v: string) {
  return v ? v.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '';
}

function MoneyInput({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return <input dir="ltr" inputMode="numeric" className="input num" disabled={disabled} value={group(value)} onChange={(e) => onChange(digits(e.target.value))} />;
}

export function VoucherEditor({
  entityId,
  voucherId,
  initial,
  accounts,
  types,
  values,
  canPost,
}: {
  entityId: string;
  voucherId?: string | null;
  initial: { date: string; type: VoucherType; description: string; lines: EditorLine[] };
  accounts: EditorAccount[];
  types: EditorDimType[];
  values: EditorDimValue[];
  canPost: boolean;
}) {
  const router = useRouter();
  const [date, setDate] = useState(initial.date);
  const [type, setType] = useState<VoucherType>(initial.type);
  const [description, setDescription] = useState(initial.description);
  const [lines, setLines] = useState<EditorLine[]>(initial.lines.length ? initial.lines : [emptyLine(), emptyLine()]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const accById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const accountOptions: Option[] = useMemo(() => accounts.map((a) => ({ value: a.id, label: `${a.code} — ${a.name}`, hint: a.path })), [accounts]);
  const typeById = useMemo(() => new Map(types.map((t) => [t.id, t])), [types]);
  const valueOptions = useMemo(() => {
    const m = new Map<string, Option[]>();
    for (const v of values) {
      const arr = m.get(v.typeId) ?? [];
      arr.push({ value: v.id, label: v.name, hint: v.code });
      m.set(v.typeId, arr);
    }
    return m;
  }, [values]);

  const totals = useMemo(() => {
    let d = 0n, c = 0n;
    for (const l of lines) {
      d += BigInt(l.debit || '0');
      c += BigInt(l.credit || '0');
    }
    return { d, c, diff: d - c };
  }, [lines]);

  const update = (key: string, patch: Partial<EditorLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const setAccount = (key: string, accountId: string) => {
    const acc = accById.get(accountId);
    setLines((ls) =>
      ls.map((l) => {
        if (l.key !== key) return l;
        // فقط تفصیلی‌های مجاز حساب جدید حفظ می‌شوند
        const allowed = new Set((acc?.rules ?? []).filter((r) => r.requirement !== 'FORBIDDEN').map((r) => r.typeId));
        const dims = Object.fromEntries(Object.entries(l.dims).filter(([t]) => allowed.has(t)));
        return { ...l, accountId, dims };
      }),
    );
  };

  const balanceLine = (key: string) => {
    const l = lines.find((x) => x.key === key)!;
    const own = BigInt(l.debit || '0') - BigInt(l.credit || '0');
    const rest = totals.diff - own; // مانده بدون این ردیف
    if (rest > 0n) update(key, { credit: rest.toString(), debit: '' });
    else if (rest < 0n) update(key, { debit: (-rest).toString(), credit: '' });
  };

  const save = (post: boolean) => {
    setError(null);
    start(async () => {
      const r = await saveVoucherAction({
        id: voucherId,
        entityId,
        date,
        type,
        description,
        post,
        lines: lines.map(({ key: _k, ...l }) => l),
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
      <div className="grid gap-3 rounded-xl border border-line bg-white p-4 shadow-sm md:grid-cols-[160px_180px_1fr]">
        <div>
          <label className="label">تاریخ سند</label>
          <JDateInput value={date} onChange={setDate} required />
        </div>
        <div>
          <label className="label">نوع سند</label>
          <select className="input" value={type} onChange={(e) => setType(e.target.value as VoucherType)}>
            <option value="NORMAL">عادی</option>
            <option value="ADJUSTMENT">اصلاحی</option>
            <option value="OPENING">افتتاحیه (مانده‌های اول دوره)</option>
          </select>
        </div>
        <div>
          <label className="label">شرح سند</label>
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="مثلاً: ثبت فروش اشتراک ارزینو — مهر ۱۴۰۵" />
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-sm">
        <table className="table min-w-[1100px]">
          <thead>
            <tr>
              <th className="w-8">#</th>
              <th className="w-[280px]">حساب معین</th>
              <th>تفصیلی‌ها / مراکز</th>
              <th className="w-[200px]">شرح ردیف</th>
              <th className="w-[150px]">بدهکار</th>
              <th className="w-[150px]">بستانکار</th>
              <th className="w-[70px]" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const acc = accById.get(l.accountId);
              const rules = (acc?.rules ?? []).filter((r) => r.requirement !== 'FORBIDDEN');
              return (
                <tr key={l.key}>
                  <td className="pt-3 text-center text-xs text-muted">{(i + 1).toLocaleString('fa-IR')}</td>
                  <td>
                    <SearchSelect options={accountOptions} value={l.accountId} onChange={(v) => setAccount(l.key, v)} placeholder="کد یا نام حساب…" allowEmpty={false} />
                  </td>
                  <td>
                    {acc ? (
                      rules.length ? (
                        <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-1.5">
                          {rules.map((r) => {
                            const t = typeById.get(r.typeId);
                            const missing = r.requirement === 'REQUIRED' && !l.dims[r.typeId];
                            return (
                              <div key={r.typeId}>
                                <div className="mb-0.5 text-[11px] text-muted">
                                  {t?.name}
                                  {r.requirement === 'REQUIRED' && <span className="text-red-500"> *</span>}
                                </div>
                                <SearchSelect
                                  options={valueOptions.get(r.typeId) ?? []}
                                  value={l.dims[r.typeId] ?? ''}
                                  invalid={missing}
                                  onChange={(v) => update(l.key, { dims: { ...l.dims, [r.typeId]: v } })}
                                />
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <span className="text-xs text-muted">این حساب تفصیلی ندارد</span>
                      )
                    ) : (
                      <span className="text-xs text-muted">ابتدا حساب را انتخاب کنید</span>
                    )}
                  </td>
                  <td>
                    <input className="input" value={l.description} onChange={(e) => update(l.key, { description: e.target.value })} placeholder={description || ''} />
                  </td>
                  <td>
                    <MoneyInput value={l.debit} onChange={(v) => update(l.key, { debit: v, credit: v ? '' : l.credit })} />
                  </td>
                  <td>
                    <MoneyInput value={l.credit} onChange={(v) => update(l.key, { credit: v, debit: v ? '' : l.debit })} />
                  </td>
                  <td className="whitespace-nowrap">
                    <button type="button" title="تراز کردن با این ردیف" className="rounded p-1.5 text-slate-500 hover:bg-slate-100" onClick={() => balanceLine(l.key)}>
                      <Scale className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      title="تکرار ردیف"
                      className="rounded p-1.5 text-slate-500 hover:bg-slate-100"
                      onClick={() => setLines((ls) => { const idx = ls.findIndex((x) => x.key === l.key); const copy = { ...l, key: newKey(), debit: '', credit: '' }; return [...ls.slice(0, idx + 1), copy, ...ls.slice(idx + 1)]; })}
                    >
                      <Copy className="h-4 w-4" />
                    </button>
                    <button type="button" title="حذف ردیف" className="rounded p-1.5 text-red-500 hover:bg-red-50" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : ls))}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4}>
                <div className="flex items-center justify-between">
                  <button type="button" className={buttonClass('secondary', 'sm')} onClick={() => setLines((ls) => [...ls, emptyLine()])}>
                    <Plus className="h-4 w-4" /> ردیف جدید
                  </button>
                  <span className={cn('text-sm', totals.diff === 0n ? 'text-emerald-700' : 'text-red-600')}>
                    {totals.diff === 0n ? (totals.d > 0n ? 'سند تراز است' : '') : `اختلاف: ${formatMoney(totals.diff < 0n ? -totals.diff : totals.diff)} (${totals.diff > 0n ? 'بدهکار بیشتر' : 'بستانکار بیشتر'})`}
                  </span>
                </div>
              </td>
              <td className="num">{formatMoney(totals.d)}</td>
              <td className="num">{formatMoney(totals.c)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={pending} className={buttonClass('primary')} onClick={() => save(false)}>
          {pending ? 'در حال ذخیره…' : 'ذخیرهٔ یادداشت'}
        </button>
        {canPost && (
          <button type="button" disabled={pending || totals.diff !== 0n || totals.d === 0n} className={buttonClass('success')} onClick={() => save(true)}>
            ذخیره و قطعی کردن
          </button>
        )}
        <button type="button" className={buttonClass('ghost')} onClick={() => router.back()}>
          انصراف
        </button>
      </div>
    </div>
  );
}
