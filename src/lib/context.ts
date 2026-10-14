import 'server-only';
import { cookies } from 'next/headers';
import prisma from './prisma';
import type { SessionUser } from './auth';
import { todayUtc } from './jalali';

export const ENTITY_COOKIE = 'hesabdari_entity';
export const FY_COOKIE = 'hesabdari_fy';

export async function accessibleEntities(user: SessionUser) {
  return prisma.entity.findMany({
    where: { status: 'ACTIVE', ...(user.entityIds ? { id: { in: user.entityIds } } : {}) },
    orderBy: { code: 'asc' },
  });
}

/** شرکت فعال (از کوکی) و سال مالی فعال آن */
export async function activeContext(user: SessionUser) {
  const store = await cookies();
  const entities = await accessibleEntities(user);
  const wanted = store.get(ENTITY_COOKIE)?.value;
  const entity = entities.find((e) => e.id === wanted) ?? entities[0] ?? null;
  if (!entity) return { entities, entity: null, fiscalYears: [], fiscalYear: null };

  const fiscalYears = await prisma.fiscalYear.findMany({
    where: { entityId: entity.id },
    orderBy: { startDate: 'desc' },
  });
  const wantedFy = store.get(FY_COOKIE)?.value;
  const today = todayUtc();
  const fiscalYear =
    fiscalYears.find((f) => f.id === wantedFy) ??
    fiscalYears.find((f) => f.startDate <= today && f.endDate >= today) ??
    fiscalYears[0] ??
    null;
  return { entities, entity, fiscalYears, fiscalYear };
}
