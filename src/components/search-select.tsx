'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { toLatinDigits } from '@/lib/jalali';

export type Option = { value: string; label: string; hint?: string; disabled?: boolean };

/** انتخاب‌گر قابل جستجو با کیبورد (برای حساب‌ها و تفصیلی‌ها با تعداد زیاد) */
export function SearchSelect({
  options,
  value,
  onChange,
  placeholder = 'انتخاب…',
  name,
  className,
  invalid,
  allowEmpty = true,
  autoFocus,
}: {
  options: Option[];
  value?: string | null;
  onChange?: (v: string) => void;
  placeholder?: string;
  name?: string;
  className?: string;
  invalid?: boolean;
  allowEmpty?: boolean;
  autoFocus?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [internal, setInternal] = useState(value ?? '');
  const current = onChange ? value ?? '' : internal;
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === current);

  const filtered = useMemo(() => {
    const s = toLatinDigits(q.trim().toLowerCase());
    const list = s ? options.filter((o) => toLatinDigits(`${o.label} ${o.hint ?? ''}`.toLowerCase()).includes(s)) : options;
    return list.slice(0, 200);
  }, [q, options]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const pick = (v: string) => {
    if (onChange) onChange(v);
    else setInternal(v);
    setOpen(false);
    setQ('');
  };

  return (
    <div ref={ref} className={cn('relative', className)}>
      {name && <input type="hidden" name={name} value={current} />}
      <input
        autoFocus={autoFocus}
        className={cn('input', invalid && 'border-red-400 bg-red-50/40')}
        placeholder={selected ? '' : placeholder}
        value={open ? q : selected?.label ?? ''}
        onFocus={() => {
          setOpen(true);
          setActive(0);
        }}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, filtered.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter' && open) {
            e.preventDefault();
            const o = filtered[active];
            if (o && !o.disabled) pick(o.value);
          } else if (e.key === 'Escape' || e.key === 'Tab') setOpen(false);
        }}
      />
      {open && (
        <div className="absolute z-30 mt-1 max-h-72 w-full min-w-64 overflow-auto rounded-lg border border-line bg-white py-1 shadow-lg">
          {allowEmpty && current && (
            <button type="button" className="block w-full px-3 py-1.5 text-right text-xs text-muted hover:bg-slate-50" onMouseDown={(e) => e.preventDefault()} onClick={() => pick('')}>
              — پاک کردن —
            </button>
          )}
          {filtered.length === 0 && <div className="px-3 py-2 text-xs text-muted">موردی یافت نشد</div>}
          {filtered.map((o, i) => (
            <button
              key={o.value}
              type="button"
              disabled={o.disabled}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(o.value)}
              onMouseEnter={() => setActive(i)}
              className={cn(
                'flex w-full items-center justify-between gap-3 px-3 py-1.5 text-right text-sm',
                i === active && 'bg-brand-50',
                o.value === current && 'font-semibold text-brand-700',
                o.disabled && 'cursor-default text-slate-400',
              )}
            >
              <span>{o.label}</span>
              {o.hint && <span className="text-xs text-muted">{o.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
