'use server';

import type { PayMethod, TreasuryType } from '@prisma/client';
import prisma from '@/lib/prisma';
import { assertEntityAccess, requireUser } from '@/lib/auth';
import { run, type ActionResult } from '@/lib/action';
import { AppError } from '@/lib/errors';
import { parseJ } from '@/lib/jalali';
import { deleteTreasury, postTreasury, reverseTreasury, saveTreasury } from '@/modules/treasury/treasury';

export type TreasuryPayload = {
  id?: string | null;
  entityId: string;
  type: TreasuryType;
  date: string;
  partyId: string;
  description: string;
  businessDimId: string;
  projectDimId: string;
  post?: boolean;
  items: {
    method: PayMethod;
    bankAccountId: string;
    toBankAccountId: string;
    chequeId: string;
    amount: string;
    feeAmount: string;
    reference: string;
    cheque?: { serialNo: string; sayadId: string; dueDate: string; bankName: string; branch: string; accountNo: string; drawerName: string; bankAccountId: string; chequeBookId: string; isGuarantee: boolean } | null;
  }[];
  allocations: { accountId: string; partyId: string; businessDimId: string; costCenterDimId: string; projectDimId: string; invoiceId: string; amount: string; description: string }[];
};

export async function saveTreasuryAction(p: TreasuryPayload): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser('voucher.edit');
    assertEntityAccess(user, p.entityId);
    const date = parseJ(p.date);
    if (!date) throw new AppError('تاریخ سند را به شکل ۱۴۰۵/۰۸/۱۲ وارد کنید.');

    const txn = await saveTreasury(
      prisma,
      user.id,
      {
        entityId: p.entityId,
        type: p.type,
        date,
        partyId: p.partyId || null,
        description: p.description || null,
        businessDimId: p.businessDimId || null,
        projectDimId: p.projectDimId || null,
        items: p.items
          .filter((i) => i.amount)
          .map((i) => {
            if (i.method === 'CHEQUE_NEW' && !i.chequeId) {
              const c = i.cheque;
              const due = parseJ(c?.dueDate ?? '');
              if (!c?.serialNo || !due) throw new AppError('برای ردیف چک، شمارهٔ چک و تاریخ سررسید الزامی است.');
              return {
                method: i.method,
                amount: i.amount,
                feeAmount: i.feeAmount || '0',
                reference: i.reference || null,
                newCheque: {
                  serialNo: c.serialNo,
                  sayadId: c.sayadId || null,
                  dueDate: due,
                  bankName: c.bankName || null,
                  branch: c.branch || null,
                  accountNo: c.accountNo || null,
                  drawerName: c.drawerName || null,
                  bankAccountId: c.bankAccountId || null,
                  chequeBookId: c.chequeBookId || null,
                  isGuarantee: !!c.isGuarantee,
                },
              };
            }
            return {
              method: i.method,
              bankAccountId: i.bankAccountId || null,
              toBankAccountId: i.toBankAccountId || null,
              chequeId: i.chequeId || null,
              amount: i.amount,
              feeAmount: i.feeAmount || '0',
              reference: i.reference || null,
            };
          }),
        allocations: p.allocations
          .filter((a) => a.accountId && a.amount)
          .map((a) => ({
            accountId: a.accountId,
            partyId: a.partyId || null,
            businessDimId: a.businessDimId || null,
            costCenterDimId: a.costCenterDimId || null,
            projectDimId: a.projectDimId || null,
            invoiceId: a.invoiceId || null,
            amount: a.amount,
            description: a.description || null,
          })),
      },
      p.id,
    );

    if (p.post) {
      await requireUser('voucher.post');
      await postTreasury(prisma, user.id, txn.id);
      return { redirect: `/treasury/${txn.id}`, message: 'سند خزانه قطعی شد.' };
    }
    return { redirect: `/treasury/${txn.id}`, message: 'ذخیره شد.' };
  });
}

export async function postTreasuryAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser('voucher.post');
    const txn = await prisma.treasuryTxn.findUniqueOrThrow({ where: { id } });
    assertEntityAccess(user, txn.entityId);
    await postTreasury(prisma, user.id, id);
    return { message: 'سند قطعی شد و سند حسابداری صادر شد.' };
  });
}

export async function reverseTreasuryAction(id: string, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser('voucher.post');
    const txn = await prisma.treasuryTxn.findUniqueOrThrow({ where: { id } });
    assertEntityAccess(user, txn.entityId);
    const date = parseJ(String(fd.get('date') ?? ''));
    if (!date) throw new AppError('تاریخ برگشت را وارد کنید.');
    await reverseTreasury(prisma, user.id, id, date);
    return { message: 'سند برگشت صادر شد.' };
  });
}

export async function deleteTreasuryAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser('voucher.edit');
    const txn = await prisma.treasuryTxn.findUniqueOrThrow({ where: { id } });
    assertEntityAccess(user, txn.entityId);
    await deleteTreasury(prisma, user.id, id);
    return { redirect: '/treasury' };
  });
}
