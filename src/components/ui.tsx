import Link from 'next/link';
import { cn } from '@/lib/utils';
import { formatMoney } from '@/lib/money';

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold text-ink">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-muted">{subtitle}</div>}
      </div>
      {actions && <div className="no-print flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className, bodyClass }: { title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={cn('print-full rounded-xl border border-line bg-white shadow-sm', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
          {actions && <div className="no-print flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn('p-4', bodyClass)}>{children}</div>
    </section>
  );
}

const variants = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 border-transparent',
  secondary: 'bg-white text-slate-700 hover:bg-slate-50 border-slate-300',
  danger: 'bg-white text-red-700 hover:bg-red-50 border-red-300',
  ghost: 'bg-transparent text-slate-600 hover:bg-slate-100 border-transparent',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700 border-transparent',
};

export type ButtonVariant = keyof typeof variants;

export function buttonClass(variant: ButtonVariant = 'secondary', size: 'sm' | 'md' = 'md') {
  return cn(
    'inline-flex items-center justify-center gap-1.5 rounded-lg border font-medium transition disabled:cursor-not-allowed disabled:opacity-50',
    size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-2 text-sm',
    variants[variant],
  );
}

export function LinkButton({ href, children, variant = 'secondary', size = 'md' }: { href: string; children: React.ReactNode; variant?: ButtonVariant; size?: 'sm' | 'md' }) {
  return (
    <Link href={href} className={buttonClass(variant, size)}>
      {children}
    </Link>
  );
}

const badgeTones = {
  gray: 'bg-slate-100 text-slate-700',
  blue: 'bg-blue-50 text-blue-700',
  green: 'bg-emerald-50 text-emerald-700',
  amber: 'bg-amber-50 text-amber-800',
  red: 'bg-red-50 text-red-700',
  violet: 'bg-violet-50 text-violet-700',
};

export function Badge({ children, tone = 'gray' }: { children: React.ReactNode; tone?: keyof typeof badgeTones }) {
  return <span className={cn('inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap', badgeTones[tone])}>{children}</span>;
}

export function Money({ value, className, zero = '—', colored }: { value: bigint | string | number | null | undefined; className?: string; zero?: string; colored?: boolean }) {
  const n = BigInt(value ?? 0);
  return <span className={cn('num whitespace-nowrap', colored && n < 0n && 'text-red-600', className)}>{formatMoney(n, { zero })}</span>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-muted">{children}</div>;
}

export function Stat({ label, value, hint, tone }: { label: string; value: bigint | string; hint?: React.ReactNode; tone?: 'green' | 'red' | 'default' }) {
  const n = BigInt(value);
  return (
    <div className="rounded-xl border border-line bg-white p-4 shadow-sm">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className={cn('mt-2 text-lg font-bold', tone === 'green' && 'text-emerald-700', tone === 'red' && 'text-red-600')}>
        <Money value={n} zero="۰" />
        <span className="mr-1 text-xs font-normal text-muted">ریال</span>
      </div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export const STATUS_LABEL: Record<string, { label: string; tone: keyof typeof badgeTones }> = {
  DRAFT: { label: 'یادداشت', tone: 'amber' },
  REVIEWED: { label: 'بررسی‌شده', tone: 'blue' },
  POSTED: { label: 'قطعی', tone: 'green' },
};

export const TYPE_LABEL: Record<string, string> = {
  OPENING: 'افتتاحیه',
  NORMAL: 'عادی',
  ADJUSTMENT: 'اصلاحی',
  ALLOCATION: 'تسهیم',
  REVERSAL: 'برگشت',
  SYSTEM: 'سیستمی',
  PL_CLOSING: 'بستن حساب‌های موقت',
  CLOSING: 'اختتامیه',
};
