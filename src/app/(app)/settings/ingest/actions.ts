'use server';

import prisma from '@/lib/prisma';
import { assertEntityAccess, requireUser } from '@/lib/auth';
import { run, str, optStr, type ActionResult } from '@/lib/action';
import { ignoreEvent, retryEvent, rotateSecret, saveSource, type SourceConfig } from '@/modules/ingest/engine';

export async function saveSourceAction(fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser('settings.accounting');
    const entityId = str(fd, 'entityId');
    assertEntityAccess(user, entityId);
    const config: SourceConfig = {
      bankAccountCode: optStr(fd, 'bankAccountCode'),
      revenueAccountCode: optStr(fd, 'revenueAccountCode'),
      expenseAccountCode: optStr(fd, 'expenseAccountCode'),
    };
    const { source, secret } = await saveSource(prisma, user.id, {
      id: optStr(fd, 'id'),
      code: str(fd, 'code').toUpperCase(),
      name: str(fd, 'name'),
      entityId,
      businessDimId: str(fd, 'businessDimId'),
      config,
      active: fd.get('active') === 'on',
    });
    return {
      message: secret ? `منبع ساخته شد. کلید (فقط همین یک بار نمایش داده می‌شود): ${secret}` : 'ذخیره شد.',
      redirect: `/settings/ingest?id=${source.id}`,
    };
  });
}

export async function rotateSecretAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser('settings.accounting');
    const secret = await rotateSecret(prisma, user.id, id);
    return { message: `کلید جدید (همین یک بار نمایش داده می‌شود): ${secret}` };
  });
}

export async function retryEventAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser('voucher.post');
    const r = await retryEvent(prisma, user.id, id);
    return { message: r.voucherId ? 'رویداد با موفقیت سند خورد.' : 'انجام شد.' };
  });
}

export async function ignoreEventAction(id: string, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser('voucher.post');
    await ignoreEvent(prisma, user.id, id, String(fd.get('note') ?? ''));
    return { message: 'رویداد نادیده گرفته شد.' };
  });
}
