import type { InvoiceType } from '@prisma/client';
import { can } from '@/lib/auth';
import { formatJ, todayUtc } from '@/lib/jalali';
import { one, pageContext, type SP } from '@/lib/page';
import { INVOICE_TYPE_LABEL } from '@/modules/sales/invoices';
import { Empty, PageHeader } from '@/components/ui';
import { loadInvoiceFormData } from '../form-data';
import { InvoiceForm } from '../invoice-form';

export const metadata = { title: 'فاکتور جدید' };

const TYPES: InvoiceType[] = ['SALES', 'PURCHASE', 'SALES_RETURN', 'PURCHASE_RETURN'];

export default async function NewInvoicePage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { user, entity, fiscalYear } = await pageContext();
  if (!entity || !fiscalYear) return <Empty>ابتدا شرکت و سال مالی را تعریف کنید.</Empty>;
  if (!can(user, 'voucher.edit')) return <Empty>دسترسی ندارید.</Empty>;
  const t = one(sp.type) as InvoiceType;
  const type: InvoiceType = TYPES.includes(t) ? t : 'SALES';
  const data = await loadInvoiceFormData(entity.id, type);
  const today = todayUtc();
  const def = today >= fiscalYear.startDate && today <= fiscalYear.endDate ? today : fiscalYear.startDate;

  return (
    <>
      <PageHeader
        title={`${INVOICE_TYPE_LABEL[type]} جدید`}
        subtitle="مالیات بر ارزش افزودهٔ هر ردیف جدا محاسبه و در حساب مالیات ثبت می‌شود. با قطعی کردن، سند حسابداری خودکار صادر می‌شود."
      />
      <InvoiceForm entityId={entity.id} type={type} defaultDate={formatJ(def, false)} defaultTaxRate="10" canPost={can(user, 'voucher.post')} {...data} />
    </>
  );
}
