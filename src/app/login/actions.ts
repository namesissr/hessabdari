'use server';

import bcrypt from 'bcryptjs';
import { headers } from 'next/headers';
import prisma from '@/lib/prisma';
import { createSession } from '@/lib/auth';
import type { ActionResult } from '@/lib/action';

// محدودیت ساده تلاش ناموفق (در حافظه) برای جلوگیری از حدس رمز
const attempts = new Map<string, { n: number; until: number }>();

export async function loginAction(fd: FormData): Promise<ActionResult> {
  const email = String(fd.get('email') ?? '').trim().toLowerCase();
  const password = String(fd.get('password') ?? '');
  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  const key = `${ip}:${email}`;
  const a = attempts.get(key);
  if (a && a.n >= 5 && a.until > Date.now()) return { ok: false, error: 'تلاش‌های ناموفق زیاد؛ چند دقیقه بعد دوباره امتحان کنید.' };

  const user = await prisma.user.findUnique({ where: { email } });
  const valid = user && user.active && (await bcrypt.compare(password, user.passwordHash));
  if (!valid) {
    const n = (a && a.until > Date.now() ? a.n : 0) + 1;
    attempts.set(key, { n, until: Date.now() + 10 * 60 * 1000 });
    return { ok: false, error: 'ایمیل یا رمز عبور نادرست است.' };
  }
  attempts.delete(key);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await createSession(user.id);
  return { ok: true, redirect: '/' };
}
