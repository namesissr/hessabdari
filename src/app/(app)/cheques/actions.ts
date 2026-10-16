'use server';

import type { ChequeDirection, ChequeEventType } from '@prisma/client';
import prisma from '@/lib/prisma';
import { assertEntityAccess, requireUser } from '@/lib/auth';
import { run, str, optStr, type ActionResult } from '@/lib/action';
import { AppError } from '@/lib/errors';
import { parseJ } from '@/lib/jalali';
import { toBig } from '@/lib/money';
import { chequeEvent, createCheque } from '@/modules/treasury/cheques';

export async function saveChequeAction(fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser('voucher.edit');
    const entityId = str(fd, 'entityId');
    assertEntityAccess(user, entityId);
    const direction = str(fd, 'direction') as ChequeDirection;
    if (direction !== 'RECEIVED' && direction !== 'ISSUED') throw new AppError('نوع چک نامعتبر است.');
    const dueDate = parseJ(str(fd, 'dueDate'));
    if (!dueDate) throw new AppError('تاریخ سررسید را به شکل ۱۴۰۵/۰۸/۱۲ وارد کنید.');
    const issueDate = parseJ(str(fd, 'issueDate'));
    const amount = toBig(str(fd, 'amount'));
    if (amount <= 0n) throw new AppError('مبلغ چک را وارد کنید.');
    const post = fd.get('post') === 'on';

    const cheque = await createCheque(
      prisma,
      user.id,
      {
        entityId,
        direction,
        serialNo: str(fd, 'serialNo'),
        sayadId: optStr(fd, 'sayadId'),
        bankName: optStr(fd, 'bankName'),
        branch: optStr(fd, 'branch'),
        accountNo: optStr(fd, 'accountNo'),
        drawerName: optStr(fd, 'drawerName'),
        amount,
        issueDate,
        dueDate,
        partyId: optStr(fd, 'partyId'),
        counterpartyName: optStr(fd, 'counterpartyName'),
        description: optStr(fd, 'description'),
        businessDimId: optStr(fd, 'businessDimId'),
        projectDimId: optStr(fd, 'projectDimId'),
        isGuarantee: fd.get('isGuarantee') === 'on',
        bankAccountId: optStr(fd, 'bankAccountId'),
        chequeBookId: optStr(fd, 'chequeBookId'),
      },
      { postRegister: post },
    );
    return { redirect: `/cheques/${cheque.id}`, message: 'چک ثبت شد.' };
  });
}

export async function chequeEventAction(chequeId: string, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser('voucher.post');
    const cheque = await prisma.cheque.findUniqueOrThrow({ where: { id: chequeId } });
    assertEntityAccess(user, cheque.entityId);
    const date = parseJ(str(fd, 'date'));
    if (!date) throw new AppError('تاریخ عملیات را وارد کنید.');
    await chequeEvent(prisma, user.id, {
      chequeId,
      type: str(fd, 'type') as ChequeEventType,
      date,
      bankAccountId: optStr(fd, 'bankAccountId'),
      partyId: optStr(fd, 'partyId'),
      feeAmount: toBig(str(fd, 'feeAmount') || '0'),
      businessDimId: optStr(fd, 'businessDimId'),
      description: optStr(fd, 'description'),
    });
    return { message: 'وضعیت چک به‌روز شد.' };
  });
}

export async function updateChequeNotesAction(chequeId: string, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser('voucher.edit');
    const cheque = await prisma.cheque.findUniqueOrThrow({ where: { id: chequeId } });
    assertEntityAccess(user, cheque.entityId);
    await prisma.cheque.update({
      where: { id: chequeId },
      data: {
        description: optStr(fd, 'description'),
        counterpartyName: optStr(fd, 'counterpartyName'),
        location: optStr(fd, 'location'),
        drawerName: optStr(fd, 'drawerName'),
        sayadId: optStr(fd, 'sayadId'),
      },
    });
    return { message: 'ذخیره شد.' };
  });
}

export async function markChequePrinted(chequeId: string): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser('voucher.edit');
    const cheque = await prisma.cheque.findUniqueOrThrow({ where: { id: chequeId } });
    assertEntityAccess(user, cheque.entityId);
    await prisma.cheque.update({ where: { id: chequeId }, data: { printedAt: new Date(), printCount: { increment: 1 } } });
  });
}
