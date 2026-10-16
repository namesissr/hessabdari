import type { PrismaClient, RecurrenceKind, VoucherType } from '@prisma/client';
import { AppError } from '@/lib/errors';
import { writeAudit } from '@/lib/audit';
import { addJMonths, dateToJ, jToDate, monthLength } from '@/lib/jalali';
import { toBig } from '@/lib/money';
import { createDraft, type LineInput } from './posting';

/**
 * قالب سند برای ثبت‌های تکراری (حقوق، اجاره، استهلاک…).
 * مبلغ هر ردیف می‌تواند ثابت باشد یا هنگام ساخت سند پرسیده شود.
 */

export type TemplateLine = {
  accountId: string;
  dims: Record<string, string>;
  side: 'DEBIT' | 'CREDIT';
  amount: string; // ریال؛ خالی یعنی هنگام ساخت سند وارد می‌شود
  description: string;
};

export type TemplateInput = {
  entityId: string;
  name: string;
  description?: string | null;
  voucherType: VoucherType;
  recurrence: RecurrenceKind;
  dayOfMonth: number;
  lines: TemplateLine[];
  active: boolean;
};

function validate(input: TemplateInput) {
  if (!input.name.trim()) throw new AppError('نام قالب الزامی است.');
  const lines = input.lines.filter((l) => l.accountId);
  if (lines.length < 2) throw new AppError('قالب باید حداقل دو ردیف داشته باشد.');
  if (input.dayOfMonth < 1 || input.dayOfMonth > 31) throw new AppError('روز ماه باید بین ۱ تا ۳۱ باشد.');
  return lines;
}

export async function saveTemplate(db: PrismaClient, userId: string, input: TemplateInput, id?: string | null) {
  const lines = validate(input);
  return db.$transaction(async (tx) => {
    const data = {
      entityId: input.entityId,
      name: input.name.trim(),
      description: input.description ?? null,
      voucherType: input.voucherType,
      recurrence: input.recurrence,
      dayOfMonth: input.dayOfMonth,
      lines: lines as unknown as object,
      active: input.active,
    };
    const tpl = id ? await tx.voucherTemplate.update({ where: { id }, data }) : await tx.voucherTemplate.create({ data: { ...data, createdById: userId } });
    await writeAudit(tx, { userId, action: id ? 'template.update' : 'template.create', objectType: 'VoucherTemplate', objectId: tpl.id, entityId: input.entityId, data: { name: tpl.name } });
    return tpl;
  });
}

export async function deleteTemplate(db: PrismaClient, userId: string, id: string) {
  return db.$transaction(async (tx) => {
    const tpl = await tx.voucherTemplate.delete({ where: { id } });
    await writeAudit(tx, { userId, action: 'template.delete', objectType: 'VoucherTemplate', objectId: id, entityId: tpl.entityId, data: { name: tpl.name } });
  });
}

/** ساخت سند یادداشت از روی قالب؛ مبالغ خالی قالب از ورودی گرفته می‌شوند */
export async function createFromTemplate(
  db: PrismaClient,
  userId: string,
  id: string,
  input: { date: Date; amounts?: Record<number, string>; description?: string | null },
) {
  const tpl = await db.voucherTemplate.findUniqueOrThrow({ where: { id } });
  const tplLines = tpl.lines as unknown as TemplateLine[];
  const lines: LineInput[] = tplLines.map((l, i) => {
    const raw = input.amounts?.[i] ?? l.amount;
    const amount = toBig(raw || '0');
    if (amount <= 0n) throw new AppError(`مبلغ ردیف ${i + 1} وارد نشده است.`);
    return {
      accountId: l.accountId,
      debit: l.side === 'DEBIT' ? amount : 0n,
      credit: l.side === 'CREDIT' ? amount : 0n,
      dims: l.dims,
      description: l.description || null,
    };
  });
  const debit = lines.reduce((s, l) => s + BigInt(l.debit ?? 0), 0n);
  const credit = lines.reduce((s, l) => s + BigInt(l.credit ?? 0), 0n);
  if (debit !== credit) throw new AppError(`مبالغ وارد شده تراز نیست (بدهکار ${debit} و بستانکار ${credit}).`);

  const voucher = await createDraft(db, userId, {
    entityId: tpl.entityId,
    date: input.date,
    type: tpl.voucherType,
    description: input.description || tpl.name,
    lines,
  });
  await db.$transaction(async (tx) => {
    await tx.voucherTemplate.update({ where: { id }, data: { lastUsedAt: new Date() } });
    await writeAudit(tx, { userId, action: 'template.use', objectType: 'VoucherTemplate', objectId: id, entityId: tpl.entityId, data: { voucherId: voucher.id } });
  });
  return voucher;
}

/** تاریخ پیشنهادی ثبت ماهانه برای یک ماه شمسی */
export function monthlyDate(jy: number, jm: number, dayOfMonth: number) {
  const len = monthLength(jy, jm);
  return jToDate(jy, jm, Math.min(dayOfMonth, len));
}

/** قالب‌های ماهانه‌ای که برای یک ماه هنوز سند نخورده‌اند */
export async function pendingMonthly(db: PrismaClient, entityId: string, forDate: Date) {
  const templates = await db.voucherTemplate.findMany({ where: { entityId, active: true, recurrence: 'MONTHLY' } });
  if (!templates.length) return [];
  const { jy, jm } = dateToJ(forDate);
  const start = jToDate(jy, jm, 1);
  const next = addJMonths(jy, jm, 1);
  const end = jToDate(next.jy, next.jm, 1);
  const out: { template: (typeof templates)[number]; suggestedDate: Date; done: boolean }[] = [];
  for (const t of templates) {
    const done = await db.voucher.count({
      where: { entityId, date: { gte: start, lt: end }, description: { contains: t.name } },
    });
    out.push({ template: t, suggestedDate: monthlyDate(jy, jm, t.dayOfMonth), done: done > 0 });
  }
  return out;
}
