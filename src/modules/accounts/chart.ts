import type { Account, AccountDimensionRule, DimRequirement, Prisma, PrismaClient } from '@prisma/client';

type Db = Prisma.TransactionClient | PrismaClient;

export type ChartAccount = Account & { rules: AccountDimensionRule[] };

/** کل چارت در حافظه (چند صد حساب) — برای پیمایش درخت، قوانین ابعاد و برچسب‌ها */
export class ChartIndex {
  byId = new Map<string, ChartAccount>();
  children = new Map<string, ChartAccount[]>();
  roots: ChartAccount[] = [];

  constructor(public accounts: ChartAccount[]) {
    const sorted = [...accounts].sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }));
    for (const a of sorted) this.byId.set(a.id, a);
    for (const a of sorted) {
      if (a.parentId && this.byId.has(a.parentId)) {
        const arr = this.children.get(a.parentId) ?? [];
        arr.push(a);
        this.children.set(a.parentId, arr);
      } else this.roots.push(a);
    }
  }

  get(id: string) {
    return this.byId.get(id);
  }

  ancestors(id: string): ChartAccount[] {
    const out: ChartAccount[] = [];
    let cur = this.byId.get(id);
    while (cur?.parentId) {
      cur = this.byId.get(cur.parentId);
      if (cur) out.push(cur);
    }
    return out;
  }

  /** خود حساب + همهٔ زیرحساب‌ها */
  descendantIds(id: string): string[] {
    const out = [id];
    const stack = [...(this.children.get(id) ?? [])];
    while (stack.length) {
      const a = stack.pop()!;
      out.push(a.id);
      stack.push(...(this.children.get(a.id) ?? []));
    }
    return out;
  }

  /** قوانین ابعاد مؤثر: نزدیک‌ترین سطح (خود حساب یا والدها) که قانون دارد */
  effectiveRules(id: string): AccountDimensionRule[] {
    const a = this.byId.get(id);
    if (!a) return [];
    if (a.rules.length) return a.rules;
    for (const p of this.ancestors(id)) if (p.rules.length) return p.rules;
    return [];
  }

  requirement(id: string, typeId: string): DimRequirement {
    return this.effectiveRules(id).find((r) => r.dimensionTypeId === typeId)?.requirement ?? 'OPTIONAL';
  }

  hasTag(id: string, tag: string): boolean {
    const a = this.byId.get(id);
    if (!a) return false;
    if (a.tags.includes(tag)) return true;
    return this.ancestors(id).some((p) => p.tags.includes(tag));
  }

  /** نزدیک‌ترین جد در سطح مشخص (مثلاً حساب کل یک معین) */
  atLevel(id: string, level: Account['level']): ChartAccount | undefined {
    const a = this.byId.get(id);
    if (!a) return undefined;
    if (a.level === level) return a;
    return this.ancestors(id).find((p) => p.level === level);
  }

  /** پیمایش پیش‌ترتیب با عمق */
  walk(): { account: ChartAccount; depth: number }[] {
    const out: { account: ChartAccount; depth: number }[] = [];
    const visit = (a: ChartAccount, depth: number) => {
      out.push({ account: a, depth });
      for (const c of this.children.get(a.id) ?? []) visit(c, depth + 1);
    };
    for (const r of this.roots) visit(r, 0);
    return out;
  }
}

export async function loadChart(db: Db, chartId: string): Promise<ChartIndex> {
  const accounts = await db.account.findMany({ where: { chartId }, include: { rules: true } });
  return new ChartIndex(accounts);
}

export const LEVEL_LABELS: Record<Account['level'], string> = { GROUP: 'گروه', GL: 'کل', SUBSIDIARY: 'معین' };

export const CATEGORY_LABELS: Record<Account['category'], string> = {
  ASSET: 'دارایی',
  LIABILITY: 'بدهی',
  EQUITY: 'حقوق مالکانه',
  REVENUE: 'درآمد',
  EXPENSE: 'هزینه',
  MEMO: 'انتظامی',
};

export const ACCOUNT_TAGS: Record<string, string> = {
  CASH: 'موجودی نقد',
  RECEIVABLE: 'دریافتنی',
  PAYABLE: 'پرداختنی',
  LOAN: 'تسهیلات',
  INVESTMENT: 'سرمایه‌گذاری',
  FIXED_ASSET: 'دارایی ثابت',
  DEFERRED_REVENUE: 'پیش‌دریافت',
  CURRENT: 'جاری',
  NON_CURRENT: 'غیرجاری',
  OPERATING_REVENUE: 'درآمد عملیاتی',
  CONTRA_REVENUE: 'برگشت و تخفیف',
  OTHER_INCOME: 'سایر درآمدها',
  COGS: 'بهای تمام‌شده',
  OPEX: 'هزینهٔ عملیاتی',
  FINANCE: 'هزینهٔ مالی',
  OTHER_EXPENSE: 'سایر هزینه‌ها',
  TAX: 'مالیات بر درآمد',
};
