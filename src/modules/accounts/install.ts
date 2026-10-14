import type { Prisma, PrismaClient } from '@prisma/client';
import { CHART_TEMPLATE, SYSTEM_DIMENSIONS, categoryForCode, defaultNormalSide, levelForCode, parentCode } from './template';

type Db = Prisma.TransactionClient | PrismaClient;

export async function ensureSystemDimensions(db: Db) {
  for (const [i, d] of SYSTEM_DIMENSIONS.entries()) {
    await db.dimensionType.upsert({
      where: { code: d.code },
      update: {},
      create: { code: d.code, name: d.name, description: d.description, isHierarchical: !!d.isHierarchical, isSystem: true, sortOrder: (i + 1) * 10 },
    });
  }
}

/** نصب قالب چارت روی یک چارت (فقط حساب‌هایی که وجود ندارند اضافه می‌شوند) */
export async function installChartTemplate(db: Db, chartId: string) {
  await ensureSystemDimensions(db);
  const types = await db.dimensionType.findMany();
  const typeByCode = new Map(types.map((t) => [t.code, t.id]));
  const idByCode = new Map<string, string>();
  const existing = await db.account.findMany({ where: { chartId }, select: { id: true, code: true } });
  existing.forEach((a) => idByCode.set(a.code, a.id));

  let created = 0;
  for (const t of CHART_TEMPLATE) {
    if (idByCode.has(t.code)) continue;
    const category = categoryForCode(t.code);
    const level = levelForCode(t.code);
    const pc = parentCode(t.code);
    const acc = await db.account.create({
      data: {
        chartId,
        code: t.code,
        name: t.name,
        level,
        parentId: pc ? idByCode.get(pc) ?? null : null,
        category,
        normalSide: t.normalSide ?? defaultNormalSide(category),
        isPostable: level === 'SUBSIDIARY',
        tags: t.tags ?? [],
        systemRole: t.systemRole ?? null,
        rules: t.rules
          ? { create: t.rules.map(([code, requirement], i) => ({ dimensionTypeId: typeByCode.get(code)!, requirement, position: i + 1 })) }
          : undefined,
      },
    });
    idByCode.set(t.code, acc.id);
    created++;
  }
  return created;
}
