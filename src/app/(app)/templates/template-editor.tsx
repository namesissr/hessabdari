'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import type { RecurrenceKind, VoucherType } from '@prisma/client';
import { SearchSelect, type Option } from '@/components/search-select';
import { buttonClass } from '@/components/ui';
import { formatMoney } from '@/lib/money';
import { toLatinDigits } from '@/lib/jalali';
import { cn } from '@/lib/utils';
import type { TemplateLine } from '@/modules/ledger/templates';
import { saveTemplateAction } from './actions';

type Acc = { id: string; name: string; hint?: string; rules: { typeId: string; requirement: string }[] };
type DimType = { id: string; name: string };
type DimValue = { id: string; typeId: string; name: string; code: string };

const digits = (v: string) => toLatinDigits(v).replace(/\D/g, '').replace(/^0+(?=\d)/, '');
const group = (v: string) => (v ? v.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '');

let seq = 0;
const emptyLine = (): TemplateLine & { key: string } => ({ key: `t${Date.now()}-${seq++}`, accountId: '', side: 'DEBIT', amount: '', dims: {}, description: '' });

export function TemplateEditor({
  entityId,
  templateId,
  initial,
  accounts,
  types,
  values,
}: {
  entityId: string;
  templateId?: string | null;
  initial?: { name: string; description: string; voucherType: VoucherType; recurrence: RecurrenceKind; dayOfMonth: number; active: boolean; lines: (TemplateLine & { key: string })[] } | null;
  accounts: Acc[];
  types: DimType[];
  values: DimValue[];
}) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [voucherType, setVoucherType] = useState<VoucherType>(initial?.voucherType ?? 'NORMAL');
  const [recurrence, setRecurrence] = useState<RecurrenceKind>(initial?.recurrence ?? 'NONE');
  const [dayOfMonth, setDay] = useState(initial?.dayOfMonth ?? 28);
  const [active, setActive] = useState(initial?.active ?? true);
  const [lines, setLines] = useState(initial?.lines?.length ? initial.lines : [emptyLine(), emptyLine()]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const accById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const accountOpts: Option[] = useMemo(() => accounts.map((a) => ({ value: a.id, label: a.name, hint: a.hint })), [accounts]);
  const typeName = useMemo(() => new Map(types.map((t) => [t.id, t.name])), [types]);
  const valueOpts = useMemo(() => {
    const m = new Map<string, Option[]>();
    for (const v of values) m.set(v.typeId, [...(m.get(v.typeId) ?? []), { value: v.id, label: v.name, hint: v.code }]);
    return m;
  }, [values]);

  const upd = (key: string, patch: Partial<TemplateLine>) => setLines((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  const debit = lines.filter((l) => l.side === 'DEBIT').reduce((s, l) => s + BigInt(l.amount || '0'), 0n);
  const credit = lines.filter((l) => l.side === 'CREDIT').reduce((s, l) => s + BigInt(l.amount || '0'), 0n);
  const hasVariable = lines.some((l) => !l.amount);

  const save = () => {
    setError(null);
    start(async () => {
      const r = await saveTemplateAction({
        id: templateId ?? null,
        entityId,
        name,
        description,
        voucherType,
        recurrence,
        dayOfMonth,
        active,
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
      <div className="grid gap-3 rounded-xl border border-line bg-white p-4 md:grid-cols-6">
        <div className="md:col-span-2">
          <label className="label">نام قالب *</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="حقوق ماهانه" />
        </div>
        <div className="md:col-span-2">
          <label className="label">شرح پیش‌فرض سند</label>
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div>
          <label className="label">نوع سند</label>
          <select className="input" value={voucherType} onChange={(e) => setVoucherType(e.target.value as VoucherType)}>
            <option value="NORMAL">عادی</option>
            <option value="ADJUSTMENT">اصلاحی</option>
          </select>
        </div>
        <div>
          <label className="label">تکرار</label>
          <select className="input" value={recurrence} onChange={(e) => setRecurrence(e.target.value as RecurrenceKind)}>
            <option value="NONE">بدون تکرار</option>
            <option value="MONTHLY">ماهانه</option>
          </select>
        </div>
        {recurrence === 'MONTHLY' && (
          <div>
            <label className="label">روز ماه</label>
            <input type="number" min={1} max={31} className="input" value={dayOfMonth} onChange={(e) => setDay(Number(e.target.value))} />
          </div>
        )}
        <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> فعال</label>
      </div>

      <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-sm">
        <table className="table min-w-[1000px]">
          <thead>
            <tr><th className="w-8">#</th><th className="w-64">حساب معین</th><th>تفصیلی‌ها</th><th className="w-28">نوع</th><th className="w-40">مبلغ ثابت</th><th className="w-48">شرح ردیف</th><th className="w-10" /></tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const acc = accById.get(l.accountId);
              const rules = (acc?.rules ?? []).filter((r) => r.requirement !== 'FORBIDDEN');
              return (
                <tr key={l.key}>
                  <td className="pt-3 text-center text-xs text-muted">{(i + 1).toLocaleString('fa-IR')}</td>
                  <td><SearchSelect options={accountOpts} value={l.accountId} onChange={(v) => upd(l.key, { accountId: v, dims: {} })} placeholder="کد یا نام حساب…" /></td>
                  <td>
                    {rules.length ? (
                      <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-1.5">
                        {rules.map((r) => (
                          <div key={r.typeId}>
                            <div className="mb-0.5 text-[11px] text-muted">{typeName.get(r.typeId)}{r.requirement === 'REQUIRED' && <span className="text-red-500"> *</span>}</div>
                            <SearchSelect options={valueOpts.get(r.typeId) ?? []} value={l.dims[r.typeId] ?? ''} onChange={(v) => upd(l.key, { dims: { ...l.dims, [r.typeId]: v } })} />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-muted">{acc ? 'بدون تفصیلی' : 'ابتدا حساب را انتخاب کنید'}</span>
                    )}
                  </td>
                  <td>
                    <select className="input" value={l.side} onChange={(e) => upd(l.key, { side: e.target.value as 'DEBIT' })}>
                      <option value="DEBIT">بدهکار</option>
                      <option value="CREDIT">بستانکار</option>
                    </select>
                  </td>
                  <td>
                    <input dir="ltr" className="input num" value={group(l.amount)} onChange={(e) => upd(l.key, { amount: digits(e.target.value) })} placeholder="هر بار پرسیده شود" />
                  </td>
                  <td><input className="input" value={l.description} onChange={(e) => upd(l.key, { description: e.target.value })} /></td>
                  <td>
                    <button type="button" className="rounded p-1.5 text-red-500 hover:bg-red-50" onClick={() => setLines((xs) => (xs.length > 2 ? xs.filter((x) => x.key !== l.key) : xs))}>
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
                <button type="button" className={buttonClass('secondary', 'sm')} onClick={() => setLines((xs) => [...xs, emptyLine()])}>
                  <Plus className="h-4 w-4" /> ردیف جدید
                </button>
              </td>
              <td className={cn('num text-xs', !hasVariable && debit !== credit && 'text-red-600')}>
                {hasVariable ? 'مبلغ متغیر' : `بدهکار ${formatMoney(debit)} / بستانکار ${formatMoney(credit)}`}
              </td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="text-xs text-muted">ردیف‌هایی که مبلغ ثابت ندارند، هنگام ساخت سند از شما پرسیده می‌شوند (مثلاً مبلغ حقوق هر ماه).</p>
      {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="flex gap-2">
        <button type="button" disabled={pending || !name} className={buttonClass('primary')} onClick={save}>{pending ? '…' : 'ذخیرهٔ قالب'}</button>
        <button type="button" className={buttonClass('ghost')} onClick={() => router.back()}>انصراف</button>
      </div>
    </div>
  );
}
