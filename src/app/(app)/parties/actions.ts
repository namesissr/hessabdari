'use server';

import type { PartyKind } from '@prisma/client';
import prisma from '@/lib/prisma';
import { requireUser } from '@/lib/auth';
import { run, str, optStr, type ActionResult } from '@/lib/action';
import { AppError } from '@/lib/errors';
import { saveParty } from '@/modules/treasury/masters';

export async function savePartyAction(fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser('voucher.edit');
    const id = optStr(fd, 'id');
    await saveParty(
      prisma,
      user.id,
      {
        entityId: optStr(fd, 'entityId'),
        code: optStr(fd, 'code'),
        name: str(fd, 'name'),
        kind: (str(fd, 'kind') || 'COMPANY') as PartyKind,
        nationalCode: optStr(fd, 'nationalCode'),
        economicCode: optStr(fd, 'economicCode'),
        registrationNo: optStr(fd, 'registrationNo'),
        phone: optStr(fd, 'phone'),
        mobile: optStr(fd, 'mobile'),
        email: optStr(fd, 'email'),
        address: optStr(fd, 'address'),
        bankName: optStr(fd, 'bankName'),
        accountNo: optStr(fd, 'accountNo'),
        iban: optStr(fd, 'iban'),
        roles: fd.getAll('roles').map(String),
        notes: optStr(fd, 'notes'),
        active: fd.get('active') === 'on',
      },
      id,
    );
    return { message: id ? 'ذخیره شد.' : 'طرف حساب اضافه شد.' };
  });
}

export async function deletePartyAction(id: string): Promise<ActionResult> {
  return run(async () => {
    await requireUser('settings.accounting');
    const party = await prisma.party.findUniqueOrThrow({ where: { id } });
    const used = await prisma.dimensionSetItem.count({ where: { valueId: party.dimensionValueId } });
    if (used) throw new AppError('این طرف حساب در اسناد استفاده شده؛ به‌جای حذف، غیرفعالش کنید.');
    await prisma.$transaction([prisma.party.delete({ where: { id } }), prisma.dimensionValue.delete({ where: { id: party.dimensionValueId } })]);
    return { redirect: '/parties', message: 'حذف شد.' };
  });
}
