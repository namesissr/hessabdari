'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ChequeSheet, type SheetLayout } from '@/components/cheque-sheet';
import { buttonClass } from '@/components/ui';
import { FIELD_LABELS, SAMPLE_DATA, type ChequeField, type ChequeFieldKey } from '@/modules/treasury/cheque-print';
import { cn } from '@/lib/utils';
import { saveLayoutAction } from './actions';

const ALIGNS: { value: 'right' | 'center' | 'left'; label: string }[] = [
  { value: 'right', label: 'راست‌چین' },
  { value: 'center', label: 'وسط' },
  { value: 'left', label: 'چپ‌چین' },
];

export function LayoutEditor({ layout }: { layout: SheetLayout & { id: string; name: string; bankName: string | null } }) {
  const router = useRouter();
  const [name, setName] = useState(layout.name);
  const [bankName, setBankName] = useState(layout.bankName ?? '');
  const [widthMm, setWidth] = useState(layout.widthMm);
  const [heightMm, setHeight] = useState(layout.heightMm);
  const [offsetXMm, setOffsetX] = useState(layout.offsetXMm);
  const [offsetYMm, setOffsetY] = useState(layout.offsetYMm);
  const [fields, setFields] = useState<ChequeField[]>(layout.fields);
  const [selected, setSelected] = useState<ChequeFieldKey | null>(fields.find((f) => f.enabled)?.key ?? null);
  const [grid, setGrid] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const update = (key: ChequeFieldKey, patch: Partial<ChequeField>) =>
    setFields((fs) => fs.map((f) => (f.key === key ? { ...f, ...patch } : f)));

  const sheet: SheetLayout = { widthMm, heightMm, offsetXMm, offsetYMm, fields };
  const sel = fields.find((f) => f.key === selected) ?? null;

  const save = () =>
    start(async () => {
      setMsg(null);
      const r = await saveLayoutAction({ id: layout.id, name, bankName: bankName || null, widthMm, heightMm, offsetXMm, offsetYMm, fields });
      setMsg(r.ok ? r.message ?? 'ذخیره شد.' : r.error);
      if (r.ok) router.refresh();
    });

  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-xl border border-line bg-white p-4 md:grid-cols-6">
        <div className="md:col-span-2">
          <label className="label">نام قالب</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label">بانک</label>
          <input className="input" value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="ملت" />
        </div>
        <div>
          <label className="label">عرض برگه (mm)</label>
          <input type="number" step={0.5} className="input" value={widthMm} onChange={(e) => setWidth(Number(e.target.value))} />
        </div>
        <div>
          <label className="label">ارتفاع برگه (mm)</label>
          <input type="number" step={0.5} className="input" value={heightMm} onChange={(e) => setHeight(Number(e.target.value))} />
        </div>
        <div className="flex items-end gap-2">
          <button onClick={save} disabled={pending} className={buttonClass('primary')}>{pending ? '…' : 'ذخیرهٔ قالب'}</button>
        </div>
        <div>
          <label className="label">جابه‌جایی کل افقی (mm)</label>
          <input type="number" step={0.5} className="input" value={offsetXMm} onChange={(e) => setOffsetX(Number(e.target.value))} />
        </div>
        <div>
          <label className="label">جابه‌جایی کل عمودی (mm)</label>
          <input type="number" step={0.5} className="input" value={offsetYMm} onChange={(e) => setOffsetY(Number(e.target.value))} />
        </div>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input type="checkbox" checked={grid} onChange={(e) => setGrid(e.target.checked)} /> شبکهٔ راهنما
        </label>
        {msg && <div className="md:col-span-3 self-end rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{msg}</div>}
      </div>

      <div className="rounded-xl border border-line bg-white p-4">
        <p className="mb-3 text-sm text-muted">
          فیلد را از جدول پایین انتخاب کنید و روی برگه کلیک کنید تا دقیقاً همان‌جا بنشیند (دقت ۰٫۱ میلی‌متر). خط‌های آبی هر ۱۰ و خاکستری هر ۵ میلی‌متر است.
          مبدأ اندازه‌گیری، گوشهٔ <b>بالا-راست</b> برگهٔ چک است.
        </p>
        <div className="overflow-auto">
          <div className="mx-auto w-fit border border-slate-300 shadow-sm">
            <ChequeSheet
              layout={sheet}
              data={SAMPLE_DATA}
              grid={grid}
              highlightKey={selected}
              onPick={(x, y) => selected && update(selected, { xMm: x, yMm: y })}
            />
          </div>
        </div>
        {sel && (
          <div className="mt-3 flex flex-wrap items-end gap-3 rounded-lg bg-slate-50 p-3 text-sm">
            <span className="font-semibold">{sel.label}</span>
            <div><div className="label">فاصله از راست (mm)</div><input type="number" step={0.5} className="input w-24" value={sel.xMm} onChange={(e) => update(sel.key, { xMm: Number(e.target.value) })} /></div>
            <div><div className="label">فاصله از بالا (mm)</div><input type="number" step={0.5} className="input w-24" value={sel.yMm} onChange={(e) => update(sel.key, { yMm: Number(e.target.value) })} /></div>
            <div><div className="label">قلم (pt)</div><input type="number" step={0.5} className="input w-20" value={sel.fontSize} onChange={(e) => update(sel.key, { fontSize: Number(e.target.value) })} /></div>
            <div><div className="label">چینش</div>
              <select className="input w-28" value={sel.align ?? 'right'} onChange={(e) => update(sel.key, { align: e.target.value as 'right' })}>
                {ALIGNS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
              </select>
            </div>
            <div><div className="label">عرض مجاز (mm)</div><input type="number" step={1} className="input w-24" value={sel.maxWidthMm ?? 0} onChange={(e) => update(sel.key, { maxWidthMm: Number(e.target.value) || undefined })} /></div>
            <div><div className="label">فاصلهٔ حروف (mm)</div><input type="number" step={0.1} className="input w-24" value={sel.charSpacingMm ?? 0} onChange={(e) => update(sel.key, { charSpacingMm: Number(e.target.value) || undefined })} /></div>
            <label className="flex items-center gap-1.5 pb-2"><input type="checkbox" checked={!!sel.bold} onChange={(e) => update(sel.key, { bold: e.target.checked })} /> ضخیم</label>
          </div>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-line bg-white">
        <table className="table">
          <thead>
            <tr><th>چاپ شود</th><th>فیلد</th><th>از راست</th><th>از بالا</th><th>قلم</th><th>چینش</th><th /></tr>
          </thead>
          <tbody>
            {fields.map((f) => (
              <tr key={f.key} className={cn(f.key === selected && 'bg-brand-50')} onClick={() => setSelected(f.key)}>
                <td><input type="checkbox" checked={f.enabled} onChange={(e) => update(f.key, { enabled: e.target.checked })} /></td>
                <td>{FIELD_LABELS[f.key]}</td>
                <td className="num">{f.xMm}</td>
                <td className="num">{f.yMm}</td>
                <td className="num">{f.fontSize}</td>
                <td>{ALIGNS.find((a) => a.value === (f.align ?? 'right'))?.label}</td>
                <td>
                  <button type="button" className="text-xs text-brand-700 hover:underline" onClick={() => setSelected(f.key)}>انتخاب برای جابه‌جایی</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
