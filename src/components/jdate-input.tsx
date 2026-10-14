'use client';

import { useState } from 'react';
import { parseJ, toLatinDigits } from '@/lib/jalali';
import { cn } from '@/lib/utils';

/** ورودی تاریخ شمسی: 1405/06/31 (ارقام فارسی هم پذیرفته می‌شود) */
export function JDateInput({
  name,
  defaultValue,
  value,
  onChange,
  required,
  className,
}: {
  name?: string;
  defaultValue?: string;
  value?: string;
  onChange?: (v: string) => void;
  required?: boolean;
  className?: string;
}) {
  const [inner, setInner] = useState(defaultValue ?? '');
  const v = value ?? inner;
  const invalid = v !== '' && !parseJ(v);
  return (
    <input
      name={name}
      required={required}
      dir="ltr"
      inputMode="numeric"
      placeholder="1405/06/31"
      className={cn('input text-left', invalid && 'border-red-400', className)}
      value={v}
      onChange={(e) => {
        const nv = toLatinDigits(e.target.value).replace(/[^\d/]/g, '');
        if (onChange) onChange(nv);
        else setInner(nv);
      }}
    />
  );
}
