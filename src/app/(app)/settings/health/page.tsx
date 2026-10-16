import Link from 'next/link';
import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import prisma from '@/lib/prisma';
import { can } from '@/lib/auth';
import { pageContext } from '@/lib/page';
import { healthChecks } from '@/modules/reports/health';
import { Card, Empty, PageHeader } from '@/components/ui';
import { cn } from '@/lib/utils';

export const metadata = { title: 'بررسی سلامت دفاتر' };

const ICON = { ok: CheckCircle2, warn: AlertTriangle, error: XCircle };
const TONE = { ok: 'text-emerald-600', warn: 'text-amber-600', error: 'text-red-600' };
const BG = { ok: 'bg-emerald-50', warn: 'bg-amber-50', error: 'bg-red-50' };

export default async function HealthPage() {
  const { user, entity, fiscalYear } = await pageContext();
  if (!can(user, 'settings.accounting')) return <Empty>دسترسی ندارید.</Empty>;
  if (!entity || !fiscalYear) return <Empty>ابتدا شرکت و سال مالی را تعریف کنید.</Empty>;
  const checks = await healthChecks(prisma, entity.id, fiscalYear.id);
  const bad = checks.filter((c) => c.status !== 'ok').length;

  return (
    <>
      <PageHeader
        title="بررسی سلامت دفاتر"
        subtitle={`${entity.name} — سال مالی ${fiscalYear.title} — ${bad === 0 ? 'همهٔ کنترل‌ها سالم است' : `${bad.toLocaleString('fa-IR')} مورد نیاز به رسیدگی دارد`}`}
      />
      <div className="grid gap-3 md:grid-cols-2">
        {checks.map((c) => {
          const Icon = ICON[c.status];
          return (
            <Card key={c.key} bodyClass={cn('flex gap-3 p-4', BG[c.status])}>
              <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', TONE[c.status])} />
              <div>
                <div className="font-semibold">{c.title}</div>
                <div className="mt-1 text-sm text-slate-700">{c.detail}</div>
                {c.href && <Link href={c.href} className="mt-2 inline-block text-xs text-brand-700 hover:underline">رفتن به صفحهٔ مربوط ←</Link>}
              </div>
            </Card>
          );
        })}
      </div>
      <p className="mt-4 text-xs text-muted">
        این کنترل‌ها را قبل از بستن هر دوره و پیش از ارائهٔ دفاتر به حسابرس یا ممیز مالیاتی اجرا کنید.
      </p>
    </>
  );
}
