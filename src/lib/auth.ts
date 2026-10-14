import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { SignJWT, jwtVerify } from 'jose';
import type { Role } from '@prisma/client';
import prisma from './prisma';
import { env } from './env';
import { AppError } from './errors';

const ALG = 'HS256';
const key = () => new TextEncoder().encode(env.sessionSecret);

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  /** null = دسترسی به همهٔ شرکت‌ها */
  entityIds: string[] | null;
};

export type Permission =
  | 'voucher.edit'
  | 'voucher.post'
  | 'period.lock'
  | 'year.close'
  | 'settings.accounting'
  | 'settings.entities'
  | 'users.manage';

const MATRIX: Record<Permission, Role[]> = {
  'voucher.edit': ['ADMIN', 'FINANCE_MANAGER', 'ACCOUNTANT'],
  'voucher.post': ['ADMIN', 'FINANCE_MANAGER'],
  'period.lock': ['ADMIN', 'FINANCE_MANAGER'],
  'year.close': ['ADMIN', 'FINANCE_MANAGER'],
  'settings.accounting': ['ADMIN', 'FINANCE_MANAGER'],
  'settings.entities': ['ADMIN'],
  'users.manage': ['ADMIN'],
};

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'مدیر سیستم',
  FINANCE_MANAGER: 'مدیر مالی',
  ACCOUNTANT: 'حسابدار',
  VIEWER: 'فقط مشاهده',
};

export function can(user: Pick<SessionUser, 'role'>, p: Permission): boolean {
  return MATRIX[p].includes(user.role);
}

export async function createSession(userId: string) {
  const expires = new Date(Date.now() + env.sessionDays * 86400000);
  const jwt = await new SignJWT({ uid: userId })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(Math.floor(expires.getTime() / 1000))
    .sign(key());
  (await cookies()).set(env.cookieName, jwt, {
    httpOnly: true,
    secure: env.secureCookie,
    sameSite: 'lax',
    path: '/',
    expires,
  });
}

export async function destroySession() {
  (await cookies()).delete(env.cookieName);
}

export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(env.cookieName)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: [ALG] });
    const user = await prisma.user.findUnique({
      where: { id: String(payload.uid) },
      include: { scopes: true },
    });
    if (!user || !user.active) return null;
    const entityScopes = user.scopes.filter((s) => s.entityId).map((s) => s.entityId!);
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      entityIds: entityScopes.length ? entityScopes : null,
    };
  } catch {
    return null;
  }
});

/** برای صفحات: کاربر وارد نشده → صفحهٔ ورود */
export async function pageUser(): Promise<SessionUser> {
  const u = await getCurrentUser();
  if (!u) redirect('/login');
  return u;
}

/** برای actionها و API */
export async function requireUser(permission?: Permission): Promise<SessionUser> {
  const u = await getCurrentUser();
  if (!u) throw new AppError('برای ادامه وارد شوید.', 401);
  if (permission && !can(u, permission)) throw new AppError('دسترسی لازم برای این عملیات را ندارید.', 403);
  return u;
}

export function assertEntityAccess(user: SessionUser, entityId: string) {
  if (user.entityIds && !user.entityIds.includes(entityId)) {
    throw new AppError('به این شرکت دسترسی ندارید.', 403);
  }
}
