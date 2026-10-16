import { can } from '@/lib/auth';
import { pageContext } from '@/lib/page';
import { Empty, PageHeader } from '@/components/ui';
import { EmployeeForm } from '../employee-form';

export const metadata = { title: 'کارمند جدید' };

export default async function NewEmployeePage() {
  const { user, entity } = await pageContext();
  if (!entity) return <Empty>ابتدا شرکت را تعریف کنید.</Empty>;
  if (!can(user, 'voucher.edit')) return <Empty>دسترسی ندارید.</Empty>;
  return (
    <>
      <PageHeader title="ثبت کارمند جدید" subtitle="با ثبت کارمند، یک طرف حساب (تفصیلی) هم خودکار ساخته می‌شود تا حقوق پرداختنی و وام او در حسابداری قابل پیگیری باشد." />
      <EmployeeForm entityId={entity.id} />
    </>
  );
}
