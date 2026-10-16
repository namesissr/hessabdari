import 'server-only';
import prisma from '@/lib/prisma';
import { formatJ } from '@/lib/jalali';
import { formatMoney } from '@/lib/money';
import { loadChart } from '@/modules/accounts/chart';

/** دادهٔ لازم برای فرم دریافت/پرداخت */
export async function loadTreasuryFormData(entityId: string) {
  const entity = await prisma.entity.findUniqueOrThrow({ where: { id: entityId } });
  const chart = await loadChart(prisma, entity.chartId);
  const [banks, parties, businesses, costCenters, projects, cheques, books, invoices] = await Promise.all([
    prisma.bankAccount.findMany({ where: { entityId, active: true }, include: { dimensionValue: true }, orderBy: { dimensionValue: { code: 'asc' } } }),
    prisma.party.findMany({ where: { active: true, OR: [{ entityId: null }, { entityId }] }, include: { dimensionValue: true }, orderBy: { dimensionValue: { name: 'asc' } } }),
    prisma.dimensionValue.findMany({ where: { type: { code: 'BUSINESS' }, active: true }, orderBy: { code: 'asc' } }),
    prisma.dimensionValue.findMany({ where: { type: { code: 'COST_CENTER' }, active: true }, orderBy: { code: 'asc' } }),
    prisma.dimensionValue.findMany({ where: { type: { code: 'PROJECT' }, active: true }, orderBy: { code: 'asc' } }),
    prisma.cheque.findMany({
      where: { entityId, direction: 'RECEIVED', status: 'IN_HAND', isGuarantee: false },
      include: { party: { include: { dimensionValue: true } } },
      orderBy: { dueDate: 'asc' },
    }),
    prisma.chequeBook.findMany({ where: { active: true, bankAccount: { entityId } } }),
    prisma.invoice.findMany({ where: { entityId, status: "POSTED" }, include: { party: { include: { dimensionValue: true } } }, orderBy: { date: "asc" } }),
  ]);

  return {
    banks: banks.map((b) => ({ id: b.id, name: b.dimensionValue.name, hint: b.accountNo ?? b.bankName ?? undefined, kind: b.kind })),
    parties: parties.map((p) => ({ id: p.id, name: p.dimensionValue.name, hint: p.dimensionValue.code })),
    accounts: chart
      .walk()
      .map((w) => w.account)
      .filter((a) => a.isPostable && a.active)
      .map((a) => ({ id: a.id, name: `${a.code} — ${a.name}`, hint: chart.ancestors(a.id).reverse().map((p) => p.name).join(' › ') })),
    businesses: businesses.map((b) => ({ id: b.id, name: b.name })),
    costCenters: costCenters.map((c) => ({ id: c.id, name: `${c.code} — ${c.name}` })),
    projects: projects.map((p) => ({ id: p.id, name: p.name })),
    openCheques: cheques.map((c) => ({
      id: c.id,
      label: `${c.serialNo} — ${formatMoney(c.amount)} ریال — سررسید ${formatJ(c.dueDate)}${c.party ? ` — ${c.party.dimensionValue.name}` : ''}`,
      amount: c.amount.toString(),
    })),
    chequeBooks: books.map((b) => ({ id: b.id, name: b.name })),
    invoices: invoices
      .filter((i) => i.total > i.settledAmount)
      .map((i) => ({
        id: i.id,
        partyId: i.partyId,
        type: i.type,
        remaining: (i.total - i.settledAmount).toString(),
        label: `${i.type === "SALES" ? "فروش" : i.type === "PURCHASE" ? "خرید" : i.type} ${i.number} — ${formatMoney(i.total - i.settledAmount)} ریال — ${i.party.dimensionValue.name}`,
      })),
  };
}
