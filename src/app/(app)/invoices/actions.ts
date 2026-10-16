'use server';

import type { InvoiceType } from '@prisma/client';
import prisma from '@/lib/prisma';
import { assertEntityAccess, requireUser } from '@/lib/auth';
import { run, type ActionResult } from '@/lib/action';
import { AppError } from '@/lib/errors';
import { parseJ } from '@/lib/jalali';
import { toBig } from '@/lib/money';
import { cancelInvoice, deleteInvoice, postInvoice, saveInvoice, settleInvoice, unsettle } from '@/modules/sales/invoices';

export type InvoicePayload = {
  id?: string | null;
  entityId: string;
  type: InvoiceType;
  date: string;
  dueDate: string;
  partyId: string;
  businessDimId: string;
  projectDimId: string;
  reference: string;
  description: string;
  post?: boolean;
  lines: {
    title: string;
    accountId: string;
    quantity: string;
    unitPrice: string;
    discount: string;
    taxRate: string;
    businessDimId: string;
    costCenterDimId: string;
    projectDimId: string;
    description: string;
  }[];
};

export async function saveInvoiceAction(p: InvoicePayload): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser('voucher.edit');
    assertEntityAccess(user, p.entityId);
    const date = parseJ(p.date);
    if (!date) throw new AppError('تاریخ فاکتور را وارد کنید.');
    if (!p.partyId) throw new AppError('طرف حساب فاکتور را انتخاب کنید.');
    const invoice = await saveInvoice(
      prisma,
      user.id,
      {
        entityId: p.entityId,
        type: p.type,
        date,
        dueDate: parseJ(p.dueDate),
        partyId: p.partyId,
        businessDimId: p.businessDimId || null,
        projectDimId: p.projectDimId || null,
        reference: p.reference || null,
        description: p.description || null,
        lines: p.lines
          .filter((l) => l.accountId && l.title)
          .map((l) => ({
            title: l.title,
            accountId: l.accountId,
            quantity: l.quantity || '1',
            unitPrice: l.unitPrice || '0',
            discount: l.discount || '0',
            taxRate: l.taxRate || '0',
            businessDimId: l.businessDimId || null,
            costCenterDimId: l.costCenterDimId || null,
            projectDimId: l.projectDimId || null,
            description: l.description || null,
          })),
      },
      p.id,
    );
    if (p.post) {
      await requireUser('voucher.post');
      await postInvoice(prisma, user.id, invoice.id);
      return { redirect: `/invoices/${invoice.id}`, message: 'فاکتور قطعی شد و سند حسابداری صادر شد.' };
    }
    return { redirect: `/invoices/${invoice.id}`, message: 'ذخیره شد.' };
  });
}

async function guard(id: string, perm: 'voucher.edit' | 'voucher.post') {
  const user = await requireUser(perm);
  const inv = await prisma.invoice.findUniqueOrThrow({ where: { id } });
  assertEntityAccess(user, inv.entityId);
  return user;
}

export async function postInvoiceAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const user = await guard(id, 'voucher.post');
    await postInvoice(prisma, user.id, id);
    return { message: 'فاکتور قطعی شد.' };
  });
}

export async function cancelInvoiceAction(id: string, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await guard(id, 'voucher.post');
    const date = parseJ(String(fd.get('date') ?? ''));
    if (!date) throw new AppError('تاریخ ابطال را وارد کنید.');
    await cancelInvoice(prisma, user.id, id, date);
    return { message: 'فاکتور ابطال شد.' };
  });
}

export async function deleteInvoiceAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const user = await guard(id, 'voucher.edit');
    await deleteInvoice(prisma, user.id, id);
    return { redirect: '/invoices' };
  });
}

export async function settleInvoiceAction(id: string, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await guard(id, 'voucher.edit');
    const date = parseJ(String(fd.get('date') ?? ''));
    if (!date) throw new AppError('تاریخ تطبیق را وارد کنید.');
    await settleInvoice(prisma, user.id, { invoiceId: id, amount: toBig(String(fd.get('amount') ?? '0')), date, note: String(fd.get('note') ?? '') || null });
    return { message: 'تطبیق ثبت شد.' };
  });
}

export async function unsettleAction(settlementId: string): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser('voucher.edit');
    await unsettle(prisma, user.id, settlementId);
    return { message: 'تطبیق حذف شد.' };
  });
}
