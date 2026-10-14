'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  BarChart3, BookOpen, Building2, CalendarRange, FileText, Layers, LayoutDashboard, ListTree, LogOut, Menu, NotebookPen,
  Scale, ScrollText, Tags, Users, Wallet, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { switchEntity, switchFiscalYear, logoutAction } from '@/app/(app)/actions';

type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string }>; show?: boolean };

export function Shell({
  children,
  user,
  entities,
  entityId,
  fiscalYears,
  fiscalYearId,
  perms,
}: {
  children: React.ReactNode;
  user: { name: string; roleLabel: string };
  entities: { id: string; name: string }[];
  entityId: string | null;
  fiscalYears: { id: string; title: string; closed: boolean }[];
  fiscalYearId: string | null;
  perms: { settings: boolean; entities: boolean; users: boolean };
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  const groups: { title: string; items: NavItem[] }[] = [
    {
      title: 'عملیات',
      items: [
        { href: '/', label: 'داشبورد مدیریتی', icon: LayoutDashboard },
        { href: '/vouchers', label: 'اسناد حسابداری', icon: NotebookPen },
      ],
    },
    {
      title: 'گزارش‌ها',
      items: [
        { href: '/reports/trial-balance', label: 'تراز آزمایشی', icon: Scale },
        { href: '/reports/journal', label: 'دفتر روزنامه', icon: ScrollText },
        { href: '/reports/ledger', label: 'دفتر کل / معین / تفصیلی', icon: BookOpen },
        { href: '/reports/dimension', label: 'گزارش تفصیلی و مراکز', icon: Layers },
        { href: '/reports/income-statement', label: 'سود و زیان', icon: BarChart3 },
        { href: '/reports/balance-sheet', label: 'ترازنامه', icon: FileText },
      ],
    },
    {
      title: 'تنظیمات',
      items: [
        { href: '/settings/accounts', label: 'کدینگ حساب‌ها', icon: ListTree, show: true },
        { href: '/settings/dimensions', label: 'تفصیلی‌ها و کسب‌وکارها', icon: Tags, show: true },
        { href: '/settings/fiscal-years', label: 'سال و دوره مالی', icon: CalendarRange, show: true },
        { href: '/settings/entities', label: 'شرکت‌ها', icon: Building2, show: perms.entities },
        { href: '/settings/users', label: 'کاربران', icon: Users, show: perms.users },
      ],
    },
  ];

  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  const nav = (
    <nav className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 border-b border-slate-800 px-4 py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500 font-bold text-white">
          <Wallet className="h-5 w-5" />
        </div>
        <div>
          <div className="text-sm font-bold text-white">حسابداری</div>
          <div className="text-[11px] text-slate-400">سیستم مالی مادر</div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-3">
        {groups.map((g) => (
          <div key={g.title} className="mb-4">
            <div className="px-3 pb-1.5 text-[11px] font-semibold text-slate-500">{g.title}</div>
            {g.items
              .filter((i) => i.show !== false)
              .map((i) => (
                <Link
                  key={i.href}
                  href={i.href}
                  onClick={() => setOpen(false)}
                  className={cn(
                    'mb-0.5 flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition',
                    isActive(i.href) ? 'bg-brand-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white',
                  )}
                >
                  <i.icon className="h-4 w-4 shrink-0" />
                  {i.label}
                </Link>
              ))}
          </div>
        ))}
      </div>
      <div className="border-t border-slate-800 p-3">
        <div className="mb-2 px-1 text-xs text-slate-400">
          <div className="font-medium text-slate-200">{user.name}</div>
          <div>{user.roleLabel}</div>
        </div>
        <form action={logoutAction}>
          <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-slate-800">
            <LogOut className="h-4 w-4" /> خروج
          </button>
        </form>
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen lg:pr-64">
      <aside className="no-print fixed inset-y-0 right-0 z-40 hidden w-64 bg-slate-900 lg:block">{nav}</aside>
      {open && (
        <div className="no-print fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 right-0 w-64 bg-slate-900">{nav}</aside>
        </div>
      )}
      <header className="no-print sticky top-0 z-30 flex flex-wrap items-center gap-3 border-b border-line bg-white/90 px-4 py-2.5 backdrop-blur">
        <button className="rounded-md p-1.5 hover:bg-slate-100 lg:hidden" onClick={() => setOpen(true)} aria-label="منو">
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">شرکت:</span>
          <select
            className="input w-auto py-1"
            value={entityId ?? ''}
            disabled={pending}
            onChange={(e) => start(async () => { await switchEntity(e.target.value); router.refresh(); })}
          >
            {entities.map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
          <span className="mr-2 text-muted">سال مالی:</span>
          <select
            className="input w-auto py-1"
            value={fiscalYearId ?? ''}
            disabled={pending || !fiscalYears.length}
            onChange={(e) => start(async () => { await switchFiscalYear(e.target.value); router.refresh(); })}
          >
            {fiscalYears.map((f) => (
              <option key={f.id} value={f.id}>{f.title}{f.closed ? ' (بسته)' : ''}</option>
            ))}
          </select>
          {pending && <span className="text-xs text-muted">…</span>}
        </div>
      </header>
      <main className="mx-auto max-w-[1400px] p-4 md:p-6">{children}</main>
    </div>
  );
}
