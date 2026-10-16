import 'server-only';
import type { InvoiceType } from '@prisma/client';
import prisma from '@/lib/prisma';
import { loadChart } from '@/modules/accounts/chart';

/** حساب‌های پیشنهادی هر نوع فاکتور: فروش → درآمد، خرید → هزینه/دارایی */
export async function loadInvoiceFormData(entityId: string, type: InvoiceType) {
  const entity = await prisma.entity.findUniqueOrThrow({ where: { id: entityId } });
  const chart = await loadChart(prisma, entity.chartId);
  const isSales = type === 'SALES' || type === 'SALES_RETURN';
  const [parties, businesses, costCenters, projects] = await Promise.all([
    prisma.party.findMany({ where: { active: true, OR: [{ entityId: null }, { entityId }] }, include: { dimensionValue: true }, orderBy: { dimensionValue: { name: 'asc' } } }),
    prisma.dimensionValue.findMany({ where: { type: { code: 'BUSINESS' }, active: true }, orderBy: { code: 'asc' } }),
    prisma.dimensionValue.findMany({ where: { type: { code: 'COST_CENTER' }, active: true }, orderBy: { code: 'asc' } }),
    prisma.dimensionValue.findMany({ where: { type: { code: 'PROJECT' }, active: true }, orderBy: { code: 'asc' } }),
  ]);

  const postable = chart.walk().map((w) => w.account).filter((a) => a.isPostable && a.active);
  const preferred = postable.filter((a) => (isSales ? a.category === 'REVENUE' : a.category === 'EXPENSE' || a.category === 'ASSET'));
  const ordered = [...preferred, ...postable.filter((a) => !preferred.includes(a))];

  return {
    parties: parties.map((p) => ({ id: p.id, name: p.dimensionValue.name, hint: p.dimensionValue.code })),
    accounts: ordered.map((a) => ({ id: a.id, name: `${a.code} — ${a.name}`, hint: chart.ancestors(a.id).reverse().map((x) => x.name).join(' › ') })),
    businesses: businesses.map((b) => ({ id: b.id, name: b.name })),
    costCenters: costCenters.map((c) => ({ id: c.id, name: `${c.code} — ${c.name}` })),
    projects: projects.map((p) => ({ id: p.id, name: p.name })),
  };
}
