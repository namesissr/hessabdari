'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { ChequeSheet, type SheetLayout } from '@/components/cheque-sheet';
import { buttonClass } from '@/components/ui';
import type { ChequeField } from '@/modules/treasury/cheque-print';
import { markChequePrinted } from '@/app/(app)/cheques/actions';

type SerializedData = { dueDate: string; amount: string; payee: string; payeeNationalId?: string | null; description?: string | null; serialNo?: string | null; sayadId?: string | null; issuePlace?: string | null; note?: string | null };

export function ChequePrintClient({
  chequeId,
  layout,
  layouts,
  data,
  summary,
  direction,
  printedAt,
}: {
  chequeId: string;
  layout: SheetLayout & { id: string; name: string; fields: ChequeField[] };
  layouts: { id: string; name: string }[];
  data: SerializedData;
  summary: { date: string; amountNumber: string; amountWords: string; amountTomanWords: string; payee: string; due: string; serial: string; printCount: number };
  direction: string;
  printedAt: string | null;
}) {
  const [grid, setGrid] = useState(false);
  const [offsetX, setOffsetX] = useState(layout.offsetXMm);
  const [offsetY, setOffsetY] = useState(layout.offsetYMm);
  const [pending, start] = useTransition();
  const printData = { ...data, dueDate: new Date(data.dueDate), amount: BigInt(data.amount) };
  const sheet: SheetLayout = { ...layout, offsetXMm: offsetX, offsetYMm: offsetY };

  const doPrint = () => {
    start(async () => {
      await markChequePrinted(chequeId);
      window.print();
    });
  };

  return (
    <>
      <style>{`@page { size: ${layout.widthMm}mm ${layout.heightMm}mm; margin: 0 }
        @media print { .no-print { display: none !important } body { background: #fff !important } .sheet-wrap { margin: 0 !important; box-shadow: none !important } }`}</style>

      <div className="no-print mx-auto max-w-4xl p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-lg font-bold">چاپ چک {direction === 'ISSUED' ? 'پرداختی' : 'دریافتی'} — سریال {summary.serial}</h1>
          <div className="flex gap-2">
            <Link href={`/cheques/${chequeId}`} className={buttonClass('secondary')}>بازگشت به چک</Link>
            <button onClick={doPrint} disabled={pending} className={buttonClass('primary')}>چاپ روی برگهٔ چک</button>
          </div>
        </div>

        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm">
          <div className="mb-2 font-bold">قبل از چاپ کنترل کنید:</div>
          <ul className="space-y-1">
            <li>تاریخ: <b>{summary.date}</b> (سررسید {summary.due})</li>
            <li>در وجه: <b>{summary.payee}</b></li>
            <li>مبلغ به عدد: <b className="num">{summary.amountNumber}</b> ریال</li>
            <li>مبلغ به حروف: <b>{summary.amountWords}</b></li>
            <li className="text-muted">معادل: {summary.amountTomanWords}</li>
          </ul>
          <div className="mt-2 text-xs text-amber-800">
            در پنجرهٔ چاپ مرورگر: اندازهٔ کاغذ را روی «{layout.widthMm}×{layout.heightMm} میلی‌متر» یا Custom بگذارید، حاشیه را None و گزینهٔ Scale را روی ۱۰۰٪ (نه Fit) تنظیم کنید؛ در غیر این صورت محل نوشته‌ها جابه‌جا می‌شود.
          </div>
          {summary.printCount > 0 && <div className="mt-2 text-xs text-red-700">این چک قبلاً {summary.printCount.toLocaleString('fa-IR')} بار چاپ شده است{printedAt ? ` (آخرین بار ${printedAt})` : ''}.</div>}
        </div>

        <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-line bg-white p-4 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={grid} onChange={(e) => setGrid(e.target.checked)} /> نمایش شبکهٔ راهنما (۵ و ۱۰ میلی‌متری)</label>
          <div>
            <div className="label">جابه‌جایی افقی (mm)</div>
            <input type="number" step={0.5} value={offsetX} onChange={(e) => setOffsetX(Number(e.target.value))} className="input w-24" />
          </div>
          <div>
            <div className="label">جابه‌جایی عمودی (mm)</div>
            <input type="number" step={0.5} value={offsetY} onChange={(e) => setOffsetY(Number(e.target.value))} className="input w-24" />
          </div>
          {layouts.length > 1 && (
            <form>
              <div className="label">قالب چک</div>
              <select name="layout" defaultValue={layout.id} className="input w-56" onChange={(e) => { window.location.search = `?layout=${e.target.value}`; }}>
                {layouts.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </form>
          )}
          <Link href="/settings/cheque-layouts" className="text-xs text-brand-700 hover:underline">تنظیم دقیق محل فیلدها ←</Link>
        </div>
        <p className="mb-2 text-xs text-muted">پیش‌نمایش با مقیاس واقعی ۱:۱ — برای تنظیم اولیه، یک بار روی کاغذ A4 چاپ کنید و برگهٔ چک را روی آن بگذارید.</p>
      </div>

      <div className="sheet-wrap mx-auto mb-8 w-fit bg-white shadow-lg">
        <ChequeSheet layout={sheet} data={printData} grid={grid} />
      </div>
    </>
  );
}
