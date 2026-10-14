import type { Prisma, PrismaClient } from '@prisma/client';
import { AppError } from '@/lib/errors';

type Db = Prisma.TransactionClient | PrismaClient;

/** { dimensionTypeId: dimensionValueId } */
export type DimMap = Record<string, string>;

export function dimHash(dims: DimMap): string {
  return Object.entries(dims)
    .filter(([, v]) => !!v)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([t, v]) => `${t}:${v}`)
    .join('|');
}

/**
 * شناسهٔ مجموعهٔ ابعاد را برمی‌گرداند (در صورت نبود می‌سازد).
 * هر ترکیب یکتای ابعاد فقط یک بار ذخیره می‌شود.
 */
export async function resolveDimensionSet(db: Db, dims: DimMap): Promise<number> {
  const clean: DimMap = {};
  for (const [t, v] of Object.entries(dims)) if (v) clean[t] = v;
  const hash = dimHash(clean);
  const existing = await db.dimensionSet.findUnique({ where: { hash }, select: { id: true } });
  if (existing) return existing.id;
  try {
    const created = await db.dimensionSet.create({
      data: {
        hash,
        items: { create: Object.entries(clean).map(([typeId, valueId]) => ({ typeId, valueId })) },
      },
      select: { id: true },
    });
    return created.id;
  } catch {
    const again = await db.dimensionSet.findUnique({ where: { hash }, select: { id: true } });
    if (!again) throw new AppError('ثبت مجموعهٔ ابعاد ناموفق بود.');
    return again.id;
  }
}

export type SetItemInfo = { typeId: string; typeCode: string; typeName: string; valueId: string; valueCode: string; valueName: string };

export async function loadSets(db: Db, ids: number[]): Promise<Map<number, SetItemInfo[]>> {
  const map = new Map<number, SetItemInfo[]>();
  if (!ids.length) return map;
  const items = await db.dimensionSetItem.findMany({
    where: { setId: { in: [...new Set(ids)] } },
    include: { type: true, value: true },
    orderBy: { type: { sortOrder: 'asc' } },
  });
  for (const it of items) {
    const arr = map.get(it.setId) ?? [];
    arr.push({
      typeId: it.typeId,
      typeCode: it.type.code,
      typeName: it.type.name,
      valueId: it.valueId,
      valueCode: it.value.code,
      valueName: it.value.name,
    });
    map.set(it.setId, arr);
  }
  return map;
}

/** مقدار بُعد به همراه همهٔ زیرمجموعه‌ها (برای ابعاد درختی مثل مرکز هزینه) */
export async function expandDimensionValues(db: Db, valueIds: string[]): Promise<string[]> {
  if (!valueIds.length) return [];
  const result = new Set(valueIds);
  let frontier = valueIds;
  while (frontier.length) {
    const kids = await db.dimensionValue.findMany({ where: { parentId: { in: frontier } }, select: { id: true } });
    frontier = kids.map((k) => k.id).filter((id) => !result.has(id));
    frontier.forEach((id) => result.add(id));
  }
  return [...result];
}
