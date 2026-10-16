import prisma from '@/lib/prisma';
import { pageUser } from '@/lib/auth';
import { one, type SP } from '@/lib/page';
import { DEFAULT_LAYOUT, SAMPLE_DATA, type ChequeField } from '@/modules/treasury/cheque-print';
import { ChequeSheet } from '@/components/cheque-sheet';
import { PrintButton } from '@/components/print-button';
import { LinkButton } from '@/components/ui';

export const metadata = { title: 'چاپ آزمایشی چک' };

/** چاپ آزمایشی روی کاغذ معمولی برای تنظیم دقیق محل نوشته‌ها */
export default async function ChequeTestPrintPage({ searchParams }: { searchParams: SP }) {
  await pageUser();
  const sp = await searchParams;
  const id = one(sp.layout);
  const row = (id ? await prisma.chequeLayout.findUnique({ where: { id } }) : null) ?? (await prisma.chequeLayout.findFirst({ where: { isDefault: true } })) ?? (await prisma.chequeLayout.findFirst());
  const layout = row
    ? { widthMm: row.widthMm, heightMm: row.heightMm, offsetXMm: row.offsetXMm, offsetYMm: row.offsetYMm, fields: row.fields as unknown as ChequeField[] }
    : { widthMm: DEFAULT_LAYOUT.widthMm, heightMm: DEFAULT_LAYOUT.heightMm, offsetXMm: 0, offsetYMm: 0, fields: DEFAULT_LAYOUT.fields };

  return (
    <>
      <style>{`@page { size: ${layout.widthMm}mm ${layout.heightMm}mm; margin: 0 }
        @media print { .no-print { display: none !important } body { background: #fff !important } .sheet-wrap { margin: 0 !important; box-shadow: none !important; border: 0 !important } }`}</style>
      <div className="no-print mx-auto max-w-3xl p-4">
        <h1 className="mb-2 text-lg font-bold">چاپ آزمایشی {row ? `— ${row.name}` : ''}</h1>
        <ol className="mb-4 list-decimal space-y-1 pr-5 text-sm text-slate-700">
          <li>این صفحه را با اندازهٔ کاغذ {layout.widthMm}×{layout.heightMm} میلی‌متر (یا A4 با Scale = ۱۰۰٪ و حاشیهٔ None) چاپ کنید.</li>
          <li>برگهٔ چک واقعی را روی کاغذ چاپ‌شده بگذارید و جلوی نور بگیرید.</li>
          <li>اختلاف هر فیلد را با خط‌کش (خطوط شبکه هر ۵ و ۱۰ میلی‌متر) اندازه بگیرید.</li>
          <li>در صفحهٔ «قالب چاپ چک» همان مقدار را اصلاح کنید؛ اگر همهٔ فیلدها یک‌اندازه جابه‌جا بودند، فقط «جابه‌جایی کل» را تغییر دهید.</li>
        </ol>
        <div className="flex gap-2">
          <PrintButton label="چاپ آزمایشی" />
          <LinkButton href="/settings/cheque-layouts">بازگشت به تنظیم قالب</LinkButton>
        </div>
      </div>
      <div className="sheet-wrap mx-auto mb-8 w-fit border border-slate-300 bg-white shadow-lg">
        <ChequeSheet layout={layout} data={SAMPLE_DATA} grid />
      </div>
    </>
  );
}
