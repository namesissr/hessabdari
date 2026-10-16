import Link from 'next/link';
import prisma from '@/lib/prisma';
import { can } from '@/lib/auth';
import { one, pageContext, type SP } from '@/lib/page';
import { Badge, Card, Empty, LinkButton, PageHeader } from '@/components/ui';
import { ActionForm } from '@/components/action-form';
import { cn } from '@/lib/utils';
import type { ChequeField } from '@/modules/treasury/cheque-print';
import { LayoutEditor } from './layout-editor';
import { createLayoutAction, deleteLayoutAction, setDefaultLayoutAction } from './actions';

export const metadata = { title: 'قالب چاپ چک' };

export default async function ChequeLayoutsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { user } = await pageContext();
  if (!can(user, 'settings.accounting')) return <Empty>دسترسی ندارید.</Empty>;
  const layouts = await prisma.chequeLayout.findMany({ orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] });
  const selected = layouts.find((l) => l.id === one(sp.id)) ?? layouts[0] ?? null;

  return (
    <>
      <PageHeader
        title="قالب چاپ چک"
        subtitle="برای هر بانک یک قالب بسازید و یک‌بار محل نوشته‌ها را تنظیم کنید؛ بعد از آن چاپ همهٔ چک‌های آن بانک دقیق خواهد بود."
        actions={layouts.length ? <LinkButton href={`/print/cheque-test?layout=${selected?.id ?? ''}`} variant="secondary">چاپ آزمایشی</LinkButton> : null}
      />
      <div className="grid gap-4 xl:grid-cols-[260px_1fr]">
        <div className="space-y-4">
          <Card title="قالب‌ها" bodyClass="p-2">
            {layouts.length === 0 && <div className="p-3 text-sm text-muted">هنوز قالبی ساخته نشده است.</div>}
            <ul>
              {layouts.map((l) => (
                <li key={l.id}>
                  <Link href={`?id=${l.id}`} className={cn('flex items-center justify-between rounded-lg px-3 py-2 text-sm', l.id === selected?.id ? 'bg-brand-600 text-white' : 'hover:bg-slate-100')}>
                    <span>{l.name}</span>
                    {l.isDefault && <Badge tone={l.id === selected?.id ? 'blue' : 'green'}>پیش‌فرض</Badge>}
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
          <Card title="قالب جدید">
            <ActionForm action={createLayoutAction} submitLabel="ساخت قالب" size="sm">
              <input name="name" className="input" placeholder="مثلاً چک بانک ملت" required />
              <input name="bankName" className="input" placeholder="نام بانک" />
              {selected && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="copyFrom" value={selected.id} defaultChecked /> کپی از «{selected.name}»
                </label>
              )}
            </ActionForm>
          </Card>
          {selected && (
            <Card title="عملیات">
              <div className="space-y-2">
                {!selected.isDefault && <ActionForm inline action={setDefaultLayoutAction.bind(null, selected.id)} submitLabel="قالب پیش‌فرض شود" size="sm" />}
                <ActionForm inline action={deleteLayoutAction.bind(null, selected.id)} submitLabel="حذف قالب" variant="danger" size="sm" confirm="این قالب حذف شود؟" />
              </div>
            </Card>
          )}
        </div>
        <div>
          {selected ? (
            <LayoutEditor
              layout={{
                id: selected.id,
                name: selected.name,
                bankName: selected.bankName,
                widthMm: selected.widthMm,
                heightMm: selected.heightMm,
                offsetXMm: selected.offsetXMm,
                offsetYMm: selected.offsetYMm,
                fields: selected.fields as unknown as ChequeField[],
              }}
            />
          ) : (
            <Empty>ابتدا یک قالب بسازید (قالب پیش‌فرض صیادی به‌صورت آماده ساخته می‌شود).</Empty>
          )}
        </div>
      </div>
    </>
  );
}
