'use server';

import type { RecurrenceKind, VoucherType } from '@prisma/client';
import prisma from '@/lib/prisma';
import { assertEntityAccess, requireUser } from '@/lib/auth';
import { run, type ActionResult } from '@/lib/action';
import { AppError } from '@/lib/errors';
import { parseJ } from '@/lib/jalali';
import { createFromTemplate, deleteTemplate, saveTemplate, type TemplateLine } from '@/modules/ledger/templates';

export type TemplatePayload = {
  id?: string | null;
  entityId: string;
  name: string;
  description: string;
  voucherType: VoucherType;
  recurrence: RecurrenceKind;
  dayOfMonth: number;
  active: boolean;
  lines: TemplateLine[];
};

export async function saveTemplateAction(p: TemplatePayload): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser('voucher.edit');
    assertEntityAccess(user, p.entityId);
    const tpl = await saveTemplate(
      prisma,
      user.id,
      {
        entityId: p.entityId,
        name: p.name,
        description: p.description || null,
        voucherType: p.voucherType,
        recurrence: p.recurrence,
        dayOfMonth: Number(p.dayOfMonth) || 1,
        active: p.active,
        lines: p.lines,
      },
      p.id,
    );
    return { redirect: `/templates?id=${tpl.id}`, message: 'قالب ذخیره شد.' };
  });
}

export async function deleteTemplateAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser('voucher.edit');
    const tpl = await prisma.voucherTemplate.findUniqueOrThrow({ where: { id } });
    assertEntityAccess(user, tpl.entityId);
    await deleteTemplate(prisma, user.id, id);
    return { redirect: '/templates', message: 'حذف شد.' };
  });
}

export async function useTemplateAction(id: string, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser('voucher.edit');
    const tpl = await prisma.voucherTemplate.findUniqueOrThrow({ where: { id } });
    assertEntityAccess(user, tpl.entityId);
    const date = parseJ(String(fd.get('date') ?? ''));
    if (!date) throw new AppError('تاریخ سند را وارد کنید.');
    const amounts: Record<number, string> = {};
    for (const [k, v] of fd.entries()) if (k.startsWith('amount:')) amounts[Number(k.slice(7))] = String(v);
    const voucher = await createFromTemplate(prisma, user.id, id, { date, amounts, description: String(fd.get('description') ?? '') || null });
    return { redirect: `/vouchers/${voucher.id}`, message: 'سند یادداشت از روی قالب ساخته شد.' };
  });
}

/** ساخت قالب از روی یک سند موجود */
export async function templateFromVoucherAction(voucherId: string, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser('voucher.edit');
    const v = await prisma.voucher.findUniqueOrThrow({
      where: { id: voucherId },
      include: { lines: { orderBy: { lineNo: 'asc' }, include: { dimensionSet: { include: { items: true } } } } },
    });
    assertEntityAccess(user, v.entityId);
    const name = String(fd.get('name') ?? '').trim() || v.description || 'قالب بدون نام';
    const keepAmounts = fd.get('keepAmounts') === 'on';
    const lines: TemplateLine[] = v.lines.map((l) => ({
      accountId: l.accountId,
      side: l.debit > 0n ? 'DEBIT' : 'CREDIT',
      amount: keepAmounts ? (l.debit > 0n ? l.debit.toString() : l.credit.toString()) : '',
      dims: Object.fromEntries(l.dimensionSet.items.map((i) => [i.typeId, i.valueId])),
      description: l.description ?? '',
    }));
    const tpl = await saveTemplate(prisma, user.id, {
      entityId: v.entityId,
      name,
      description: v.description,
      voucherType: v.type === 'SYSTEM' ? 'NORMAL' : v.type,
      recurrence: fd.get('monthly') === 'on' ? 'MONTHLY' : 'NONE',
      dayOfMonth: Number(fd.get('dayOfMonth') ?? 1) || 1,
      active: true,
      lines,
    });
    return { redirect: `/templates?id=${tpl.id}`, message: 'قالب از روی این سند ساخته شد.' };
  });
}
