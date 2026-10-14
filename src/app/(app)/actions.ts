'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import prisma from '@/lib/prisma';
import { assertEntityAccess, destroySession, requireUser } from '@/lib/auth';
import { ENTITY_COOKIE, FY_COOKIE } from '@/lib/context';

const cookieOpts = { httpOnly: true, sameSite: 'lax' as const, path: '/', maxAge: 60 * 60 * 24 * 365 };

export async function switchEntity(entityId: string) {
  const user = await requireUser();
  assertEntityAccess(user, entityId);
  const store = await cookies();
  store.set(ENTITY_COOKIE, entityId, cookieOpts);
  store.delete(FY_COOKIE);
}

export async function switchFiscalYear(fiscalYearId: string) {
  const user = await requireUser();
  const fy = await prisma.fiscalYear.findUniqueOrThrow({ where: { id: fiscalYearId } });
  assertEntityAccess(user, fy.entityId);
  const store = await cookies();
  store.set(FY_COOKIE, fy.id, cookieOpts);
  store.set(ENTITY_COOKIE, fy.entityId, cookieOpts);
}

export async function logoutAction() {
  await destroySession();
  redirect('/login');
}
