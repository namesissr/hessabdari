'use server';

import type { AllocationMethod } from '@prisma/client';
import prisma from '@/lib/prisma';
import { assertEntityAccess, requireUser } from '@/lib/auth';
import { run, str, optStr, type ActionResult } from '@/lib/action';
import { AppError } from '@/lib/errors';
import { deleteRule, runAllocation, saveRule, type AllocationWeights } from '@/modules/allocation/allocation';
import { formatMoney } from '@/lib/money';

export async function saveRuleAction(fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser('settings.accounting');
    const entityId = str(fd, 'entityId');
    assertEntityAccess(user, entityId);
    const method = str(fd, 'method') as AllocationMethod;
    const weights: AllocationWeights = {};
    for (const [k, v] of fd.entries()) {
      if (!k.startsWith('weight:')) continue;
      const n = Number(String(v));
      if (n > 0) weights[k.slice(7)] = n;
    }
    const codes = str(fd, 'accountCodes')
      .split(/[,\s،]+/)
      .map((c) => c.trim())
      .filter(Boolean);
    await saveRule(prisma, user.id, {
      id: optStr(fd, 'id'),
      entityId,
      name: str(fd, 'name'),
      method,
      sourceBusinessDimId: optStr(fd, 'sourceBusinessDimId'),
      accountCodes: codes,
      weights: method === 'FIXED' ? weights : null,
      active: fd.get('active') === 'on',
    });
    return { message: 'قانون تسهیم ذخیره شد.' };
  });
}

export async function deleteRuleAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser('settings.accounting');
    await deleteRule(prisma, user.id, id);
    return { redirect: '/settings/allocation', message: 'حذف شد.' };
  });
}

export async function runAllocationAction(ruleId: string, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser('voucher.post');
    const periodId = String(fd.get('periodId') ?? '');
    if (!periodId) throw new AppError('دورهٔ مالی را انتخاب کنید.');
    const preview = fd.get('preview') === '1';
    const r = await runAllocation(prisma, user.id, ruleId, periodId, { preview });
    const detail = r.detail.map((d) => `${d.name}: ${formatMoney(BigInt(d.amount))} (${d.weight.toFixed(1)}٪)`).join(' — ');
    return {
      message: preview
        ? `پیش‌نمایش: مبلغ قابل تسهیم ${formatMoney(r.total)} ریال — ${detail}`
        : `تسهیم انجام شد: ${formatMoney(r.total)} ریال — ${detail}`,
    };
  });
}
