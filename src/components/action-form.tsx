'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { ActionResult } from '@/lib/action';
import { cn } from '@/lib/utils';
import { buttonClass, type ButtonVariant } from './ui';

/** فرم عمومی برای server actionها با نمایش خطا/موفقیت */
export function ActionForm({
  action,
  children,
  className,
  submitLabel,
  confirm,
  variant = 'primary',
  size = 'md',
  resetOnSuccess,
  inline,
}: {
  action: (fd: FormData) => Promise<ActionResult>;
  children?: React.ReactNode;
  className?: string;
  submitLabel?: React.ReactNode;
  confirm?: string;
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  resetOnSuccess?: boolean;
  inline?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <form
      className={cn(inline ? 'inline-flex flex-wrap items-center gap-2' : 'space-y-3', className)}
      onSubmit={(e) => {
        e.preventDefault();
        if (confirm && !window.confirm(confirm)) return;
        const form = e.currentTarget;
        const fd = new FormData(form);
        start(async () => {
          const r = await action(fd);
          if (r.ok) {
            setMsg(r.message ? { ok: true, text: r.message } : null);
            if (resetOnSuccess) form.reset();
            if (r.redirect) router.push(r.redirect);
            else router.refresh();
          } else setMsg({ ok: false, text: r.error });
        });
      }}
    >
      {children}
      {submitLabel && (
        <button type="submit" disabled={pending} className={buttonClass(variant, size)}>
          {pending ? '…' : submitLabel}
        </button>
      )}
      {msg && <div className={cn('rounded-md px-3 py-2 text-sm', msg.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700')}>{msg.text}</div>}
    </form>
  );
}
