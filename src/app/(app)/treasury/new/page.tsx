import type { TreasuryType } from '@prisma/client';
import { can } from '@/lib/auth';
import { formatJ, todayUtc } from '@/lib/jalali';
import { one, pageContext, type SP } from '@/lib/page';
import { TREASURY_TYPE_LABEL } from '@/modules/treasury/treasury';
import { Empty, PageHeader } from '@/components/ui';
import { loadTreasuryFormData } from '../form-data';
import { TreasuryForm } from '../treasury-form';

export const metadata = { title: 'سند خزانه' };

const HINTS: Record<TreasuryType, string> = {
  RECEIPT: 'پولی که دریافت کرده‌اید: نقد، واریز بانکی، کارت‌خوان، درگاه یا چک. در بخش «بابت» مشخص کنید این پول بابت چه بود (مثلاً تسویهٔ حساب مشتری یا درآمد).',
  PAYMENT: 'پولی که پرداخت کرده‌اید: نقد، حواله، چک صادره یا واگذاری چک دریافتی. در «بابت» حساب هزینه یا بدهی را انتخاب کنید.',
  TRANSFER: 'انتقال وجه بین حساب‌های بانکی/صندوق خودتان. کارمزد از حساب مبدأ کسر می‌شود.',
};

export default async function NewTreasuryPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { user, entity, fiscalYear } = await pageContext();
  if (!entity || !fiscalYear) return <Empty>ابتدا شرکت و سال مالی را تعریف کنید.</Empty>;
  if (!can(user, 'voucher.edit')) return <Empty>دسترسی ندارید.</Empty>;
  const t = one(sp.type);
  const type: TreasuryType = t === 'PAYMENT' || t === 'TRANSFER' ? t : 'RECEIPT';
  const data = await loadTreasuryFormData(entity.id);
  const today = todayUtc();
  const def = today >= fiscalYear.startDate && today <= fiscalYear.endDate ? today : fiscalYear.startDate;

  return (
    <>
      <PageHeader title={`${TREASURY_TYPE_LABEL[type]} جدید`} subtitle={HINTS[type]} />
      <TreasuryForm entityId={entity.id} type={type} defaultDate={formatJ(def, false)} canPost={can(user, 'voucher.post')} {...data} />
    </>
  );
}
