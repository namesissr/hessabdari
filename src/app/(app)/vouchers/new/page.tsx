import prisma from '@/lib/prisma';
import { can } from '@/lib/auth';
import { formatJ, todayUtc } from '@/lib/jalali';
import { one, pageContext, type SP } from '@/lib/page';
import { Empty, PageHeader } from '@/components/ui';
import { loadEditorData } from '../editor-data';
import { VoucherEditor, type EditorLine } from '../voucher-editor';

export const metadata = { title: 'سند جدید' };

export default async function NewVoucherPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { user, entity, fiscalYear } = await pageContext();
  if (!entity || !fiscalYear) return <Empty>ابتدا شرکت و سال مالی را تعریف کنید.</Empty>;
  if (!can(user, 'voucher.edit')) return <Empty>دسترسی ثبت سند ندارید.</Empty>;
  if (fiscalYear.status === 'CLOSED') return <Empty>سال مالی {fiscalYear.title} بسته شده است.</Empty>;

  const data = await loadEditorData(entity.id);
  const today = todayUtc();
  const defaultDate = today >= fiscalYear.startDate && today <= fiscalYear.endDate ? today : fiscalYear.startDate;

  // کپی از سند موجود
  let lines: EditorLine[] = [];
  let description = '';
  const copyId = one(sp.copy);
  if (copyId) {
    const src = await prisma.voucher.findFirst({
      where: { id: copyId, entityId: entity.id },
      include: { lines: { orderBy: { lineNo: 'asc' }, include: { dimensionSet: { include: { items: true } } } } },
    });
    if (src) {
      description = src.description ?? '';
      lines = src.lines.map((l, i) => ({
        key: `c${i}`,
        accountId: l.accountId,
        debit: l.debit > 0n ? l.debit.toString() : '',
        credit: l.credit > 0n ? l.credit.toString() : '',
        description: l.description ?? '',
        dims: Object.fromEntries(l.dimensionSet.items.map((it) => [it.typeId, it.valueId])),
      }));
    }
  }

  return (
    <>
      <PageHeader title="سند حسابداری جدید" subtitle={`${entity.name} — سال مالی ${fiscalYear.title}`} />
      <VoucherEditor
        entityId={entity.id}
        initial={{ date: formatJ(defaultDate, false), type: 'NORMAL', description, lines }}
        accounts={data.accounts}
        types={data.types}
        values={data.values}
        canPost={can(user, 'voucher.post')}
      />
    </>
  );
}
