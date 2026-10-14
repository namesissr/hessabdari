import 'server-only';
import prisma from '@/lib/prisma';
import { loadChart } from '@/modules/accounts/chart';

export type EditorAccount = { id: string; code: string; name: string; path: string; rules: { typeId: string; requirement: 'REQUIRED' | 'OPTIONAL' | 'FORBIDDEN' }[] };
export type EditorDimType = { id: string; code: string; name: string };
export type EditorDimValue = { id: string; typeId: string; code: string; name: string };

/** دادهٔ لازم برای ویرایشگر سند: حساب‌های معین با قوانین تفصیلی مؤثر + مقادیر تفصیلی */
export async function loadEditorData(entityId: string) {
  const entity = await prisma.entity.findUniqueOrThrow({ where: { id: entityId } });
  const chart = await loadChart(prisma, entity.chartId);
  const accounts: EditorAccount[] = chart
    .walk()
    .map((w) => w.account)
    .filter((a) => a.isPostable && a.active)
    .map((a) => ({
      id: a.id,
      code: a.code,
      name: a.name,
      path: chart.ancestors(a.id).reverse().map((p) => p.name).join(' › '),
      rules: chart.effectiveRules(a.id).sort((x, y) => x.position - y.position).map((r) => ({ typeId: r.dimensionTypeId, requirement: r.requirement })),
    }));
  const types: EditorDimType[] = (await prisma.dimensionType.findMany({ orderBy: { sortOrder: 'asc' } })).map((t) => ({ id: t.id, code: t.code, name: t.name }));
  const values: EditorDimValue[] = (
    await prisma.dimensionValue.findMany({
      where: { active: true, OR: [{ entityId: null }, { entityId }] },
      orderBy: [{ typeId: 'asc' }, { code: 'asc' }],
    })
  ).map((v) => ({ id: v.id, typeId: v.typeId, code: v.code, name: v.name }));
  return { accounts, types, values };
}
