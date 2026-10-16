'use server';

import type { BankAccountKind } from '@prisma/client';
import prisma from '@/lib/prisma';
import { assertEntityAccess, requireUser } from '@/lib/auth';
import { run, str, optStr, type ActionResult } from '@/lib/action';
import { AppError } from '@/lib/errors';
import { saveBankAccount } from '@/modules/treasury/masters';

export async function saveBankAccountAction(fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser('settings.accounting');
    const entityId = str(fd, 'entityId');
    assertEntityAccess(user, entityId);
    const id = optStr(fd, 'id');
    await saveBankAccount(
      prisma,
      user.id,
      {
        entityId,
        code: optStr(fd, 'code'),
        name: str(fd, 'name'),
        kind: (str(fd, 'kind') || 'BANK') as BankAccountKind,
        bankName: optStr(fd, 'bankName'),
        branch: optStr(fd, 'branch'),
        accountNo: optStr(fd, 'accountNo'),
        iban: optStr(fd, 'iban'),
        cardNo: optStr(fd, 'cardNo'),
        glAccountId: str(fd, 'glAccountId'),
        custodianPartyId: optStr(fd, 'custodianPartyId'),
        description: optStr(fd, 'description'),
        active: fd.get('active') === 'on',
      },
      id,
    );
    return { message: id ? 'ذخیره شد.' : 'حساب اضافه شد.' };
  });
}

export async function saveChequeBookAction(fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser('settings.accounting');
    const bankAccountId = str(fd, 'bankAccountId');
    const bank = await prisma.bankAccount.findUniqueOrThrow({ where: { id: bankAccountId } });
    assertEntityAccess(user, bank.entityId);
    const name = str(fd, 'name');
    if (!name) throw new AppError('نام دسته‌چک الزامی است.');
    const id = optStr(fd, 'id');
    const data = {
      bankAccountId,
      name,
      serialFrom: optStr(fd, 'serialFrom'),
      serialTo: optStr(fd, 'serialTo'),
      layoutId: optStr(fd, 'layoutId'),
      active: fd.get('active') === 'on',
    };
    if (id) await prisma.chequeBook.update({ where: { id }, data });
    else await prisma.chequeBook.create({ data });
    return { message: 'دسته‌چک ذخیره شد.' };
  });
}
