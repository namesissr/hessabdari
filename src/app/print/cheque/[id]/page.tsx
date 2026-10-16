import { notFound } from 'next/navigation';
import prisma from '@/lib/prisma';
import { assertEntityAccess, pageUser } from '@/lib/auth';
import { formatJ } from '@/lib/jalali';
import { one, type SP } from '@/lib/page';
import { DEFAULT_LAYOUT, printSummary, type ChequeField, type ChequePrintData } from '@/modules/treasury/cheque-print';
import { ChequePrintClient } from './print-client';

export const metadata = { title: 'چاپ چک' };

export default async function ChequePrintPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await pageUser();
  const cheque = await prisma.cheque.findUnique({
    where: { id },
    include: { party: { include: { dimensionValue: true } }, bankAccount: true, chequeBook: { include: { layout: true } }, entity: true },
  });
  if (!cheque) notFound();
  assertEntityAccess(user, cheque.entityId);

  const layoutId = one(sp.layout);
  const layoutRow =
    (layoutId ? await prisma.chequeLayout.findUnique({ where: { id: layoutId } }) : null) ??
    cheque.chequeBook?.layout ??
    (await prisma.chequeLayout.findFirst({ where: { isDefault: true } })) ??
    (await prisma.chequeLayout.findFirst());
  const layouts = await prisma.chequeLayout.findMany({ orderBy: { name: 'asc' } });

  const layout = layoutRow
    ? { id: layoutRow.id, name: layoutRow.name, widthMm: layoutRow.widthMm, heightMm: layoutRow.heightMm, offsetXMm: layoutRow.offsetXMm, offsetYMm: layoutRow.offsetYMm, fields: layoutRow.fields as unknown as ChequeField[] }
    : { id: '', ...DEFAULT_LAYOUT, fields: DEFAULT_LAYOUT.fields };

  const data: ChequePrintData = {
    dueDate: cheque.dueDate,
    amount: cheque.amount,
    payee: cheque.counterpartyName || cheque.party?.dimensionValue.name || '',
    payeeNationalId: cheque.party?.nationalCode ?? null,
    description: cheque.description ?? null,
    serialNo: cheque.serialNo,
    sayadId: cheque.sayadId,
    issuePlace: null,
    note: null,
  };

  return (
    <ChequePrintClient
      chequeId={cheque.id}
      layout={layout}
      layouts={layouts.map((l) => ({ id: l.id, name: l.name }))}
      data={{ ...data, dueDate: data.dueDate.toISOString(), amount: data.amount.toString() }}
      summary={{ ...printSummary(data), due: formatJ(cheque.dueDate), serial: cheque.serialNo, printCount: cheque.printCount }}
      direction={cheque.direction}
      printedAt={cheque.printedAt ? formatJ(cheque.printedAt) : null}
    />
  );
}
