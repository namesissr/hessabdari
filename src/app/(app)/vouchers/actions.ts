'use server';

import type { VoucherType } from '@prisma/client';
import prisma from '@/lib/prisma';
import { assertEntityAccess, requireUser } from '@/lib/auth';
import { run, type ActionResult } from '@/lib/action';
import { AppError, errorMessage } from '@/lib/errors';
import { parseJ } from '@/lib/jalali';
import { createDraft, deleteDraft, postVoucher, reverseVoucher, setReviewed, updateDraft, renumberVouchers } from '@/modules/ledger/posting';

export type VoucherPayload = {
  id?: string | null;
  entityId: string;
  date: string;
  type: VoucherType;
  description: string;
  lines: { accountId: string; debit: string; credit: string; description: string; dims: Record<string, string> }[];
  post?: boolean;
};

const MANUAL_TYPES: VoucherType[] = ['NORMAL', 'ADJUSTMENT', 'OPENING'];

export async function saveVoucherAction(p: VoucherPayload): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser('voucher.edit');
    const date = parseJ(p.date);
    if (!date) throw new AppError('تاریخ سند نامعتبر است.');
    if (!MANUAL_TYPES.includes(p.type)) throw new AppError('نوع سند نامعتبر است.');
    const lines = p.lines
      .filter((l) => l.accountId || l.debit || l.credit)
      .map((l) => ({ accountId: l.accountId, debit: l.debit || '0', credit: l.credit || '0', description: l.description, dims: l.dims }));
    if (lines.some((l) => !l.accountId)) throw new AppError('برای همهٔ ردیف‌ها حساب را انتخاب کنید.');

    let id = p.id ?? null;
    if (id) {
      const v = await prisma.voucher.findUniqueOrThrow({ where: { id } });
      assertEntityAccess(user, v.entityId);
      await updateDraft(prisma, user.id, id, { date, type: p.type, description: p.description, lines });
    } else {
      assertEntityAccess(user, p.entityId);
      const v = await createDraft(prisma, user.id, { entityId: p.entityId, date, type: p.type, description: p.description, lines });
      id = v.id;
    }
    if (p.post) {
      await requireUser('voucher.post');
      try {
        const r = await postVoucher(prisma, user.id, id);
        return { redirect: `/vouchers/${id}`, message: `سند با شمارهٔ ${r.number} قطعی شد.` };
      } catch (e) {
        // یادداشت ذخیره شده؛ خطای قطعی شدن را روی صفحهٔ سند نشان می‌دهیم
        const msg = errorMessage(e);
        return { redirect: `/vouchers/${id}?err=${encodeURIComponent(msg.slice(0, 300))}` };
      }
    }
    return { redirect: `/vouchers/${id}`, message: 'ذخیره شد.' };
  });
}

async function guard(id: string, perm: 'voucher.edit' | 'voucher.post') {
  const user = await requireUser(perm);
  const v = await prisma.voucher.findUniqueOrThrow({ where: { id } });
  assertEntityAccess(user, v.entityId);
  return user;
}

export async function postAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const user = await guard(id, 'voucher.post');
    const r = await postVoucher(prisma, user.id, id);
    return { message: `سند با شمارهٔ ${r.number} قطعی شد.` };
  });
}

export async function reviewAction(id: string, reviewed: boolean): Promise<ActionResult> {
  return run(async () => {
    const user = await guard(id, 'voucher.edit');
    await setReviewed(prisma, user.id, id, reviewed);
  });
}

export async function deleteAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const user = await guard(id, 'voucher.edit');
    await deleteDraft(prisma, user.id, id);
    return { redirect: '/vouchers' };
  });
}

export async function reverseAction(id: string, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await guard(id, 'voucher.post');
    const date = parseJ(String(fd.get('date') ?? ''));
    if (!date) throw new AppError('تاریخ سند برگشت نامعتبر است.');
    const rev = await reverseVoucher(prisma, user.id, id, date, String(fd.get('description') ?? '') || undefined);
    return { redirect: `/vouchers/${rev.id}` };
  });
}

export async function renumberAction(fiscalYearId: string): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser('voucher.post');
    const fy = await prisma.fiscalYear.findUniqueOrThrow({ where: { id: fiscalYearId } });
    assertEntityAccess(user, fy.entityId);
    const n = await renumberVouchers(prisma, user.id, fiscalYearId);
    return { message: `${n} سند بر اساس تاریخ شماره‌گذاری شد.` };
  });
}
