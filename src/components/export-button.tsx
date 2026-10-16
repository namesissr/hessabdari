'use client';

import { FileSpreadsheet } from 'lucide-react';
import { buttonClass } from './ui';
import { toLatinDigits } from '@/lib/jalali';

/**
 * خروجی CSV از جدول‌های همین صفحه (قابل باز کردن در اکسل).
 * ارقام فارسی و جداکنندهٔ هزارگان حذف می‌شوند تا ستون‌ها در اکسل عددی بمانند.
 */
export function ExportButton({ filename = 'report' }: { filename?: string }) {
  const run = () => {
    const tables = Array.from(document.querySelectorAll<HTMLTableElement>('main table'));
    if (!tables.length) return;
    const lines: string[] = [];
    const cell = (el: HTMLTableCellElement) => {
      const raw = (el.innerText ?? '').replace(/\s+/g, ' ').trim();
      const latin = toLatinDigits(raw).replace(/[٬،]/g, '');
      const numeric = latin.replace(/[,()]/g, (m) => (m === ',' ? '' : ''));
      const isNumber = /^-?\d+(\.\d+)?$/.test(numeric.replace(/\s/g, ''));
      const value = isNumber ? (latin.includes('(') ? `-${numeric.replace(/\s/g, '')}` : numeric.replace(/\s/g, '')) : latin;
      return `"${value.replace(/"/g, '""')}"`;
    };
    for (const table of tables) {
      for (const row of Array.from(table.rows)) {
        lines.push(Array.from(row.cells).map(cell).join(','));
      }
      lines.push('');
    }
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <button type="button" onClick={run} className={buttonClass('secondary')}>
      <FileSpreadsheet className="h-4 w-4" /> خروجی اکسل
    </button>
  );
}
