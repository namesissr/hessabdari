'use server';

import prisma from '@/lib/prisma';
import { requireUser } from '@/lib/auth';
import { run, str, optStr, type ActionResult } from '@/lib/action';
import { AppError } from '@/lib/errors';
import { writeAudit } from '@/lib/audit';
import { DEFAULT_LAYOUT, type ChequeField } from '@/modules/treasury/cheque-print';

export async function createLayoutAction(fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser('settings.accounting');
    const name = str(fd, 'name') || 'قالب جدید چک';
    const copyFrom = optStr(fd, 'copyFrom');
    const source = copyFrom ? await prisma.chequeLayout.findUnique({ where: { id: copyFrom } }) : null;
    const layout = await prisma.chequeLayout.create({
      data: {
        name,
        bankName: optStr(fd, 'bankName'),
        widthMm: source?.widthMm ?? DEFAULT_LAYOUT.widthMm,
        heightMm: source?.heightMm ?? DEFAULT_LAYOUT.heightMm,
        offsetXMm: source?.offsetXMm ?? 0,
        offsetYMm: source?.offsetYMm ?? 0,
        fields: (source?.fields ?? DEFAULT_LAYOUT.fields) as object,
        isDefault: (await prisma.chequeLayout.count()) === 0,
      },
    });
    await prisma.$transaction((tx) => writeAudit(tx, { userId: user.id, action: 'cheque_layout.create', objectType: 'ChequeLayout', objectId: layout.id, data: { name } }));
    return { redirect: `/settings/cheque-layouts?id=${layout.id}`, message: 'قالب ساخته شد.' };
  });
}

export async function saveLayoutAction(payload: {
  id: string;
  name: string;
  bankName: string | null;
  widthMm: number;
  heightMm: number;
  offsetXMm: number;
  offsetYMm: number;
  fields: ChequeField[];
}): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser('settings.accounting');
    if (!payload.name.trim()) throw new AppError('نام قالب الزامی است.');
    if (payload.widthMm < 50 || payload.widthMm > 300 || payload.heightMm < 40 || payload.heightMm > 200) {
      throw new AppError('اندازهٔ برگهٔ چک معتبر نیست (عرض ۵۰ تا ۳۰۰ و ارتفاع ۴۰ تا ۲۰۰ میلی‌متر).');
    }
    for (const f of payload.fields) {
      if (f.xMm < 0 || f.xMm > payload.widthMm || f.yMm < 0 || f.yMm > payload.heightMm) {
        throw new AppError(`مختصات فیلد «${f.label}» بیرون از برگهٔ چک است.`);
      }
      if (f.fontSize < 5 || f.fontSize > 30) throw new AppError(`اندازهٔ قلم فیلد «${f.label}» معتبر نیست.`);
      if (f.maxWidthMm && (f.align ?? 'right') === 'right' && f.xMm + f.maxWidthMm > payload.widthMm + 0.01) {
        throw new AppError(`فیلد «${f.label}» با این عرض از لبهٔ چپ برگه بیرون می‌زند؛ عرض مجاز را کم کنید یا فیلد را به سمت راست ببرید.`);
      }
    }
    await prisma.chequeLayout.update({
      where: { id: payload.id },
      data: {
        name: payload.name.trim(),
        bankName: payload.bankName,
        widthMm: payload.widthMm,
        heightMm: payload.heightMm,
        offsetXMm: payload.offsetXMm,
        offsetYMm: payload.offsetYMm,
        fields: payload.fields as unknown as object,
      },
    });
    await prisma.$transaction((tx) => writeAudit(tx, { userId: user.id, action: 'cheque_layout.update', objectType: 'ChequeLayout', objectId: payload.id, data: { name: payload.name } }));
    return { message: 'قالب ذخیره شد.' };
  });
}

export async function setDefaultLayoutAction(id: string): Promise<ActionResult> {
  return run(async () => {
    await requireUser('settings.accounting');
    await prisma.$transaction([
      prisma.chequeLayout.updateMany({ data: { isDefault: false } }),
      prisma.chequeLayout.update({ where: { id }, data: { isDefault: true } }),
    ]);
    return { message: 'قالب پیش‌فرض تغییر کرد.' };
  });
}

export async function deleteLayoutAction(id: string): Promise<ActionResult> {
  return run(async () => {
    await requireUser('settings.accounting');
    const used = await prisma.chequeBook.count({ where: { layoutId: id } });
    if (used) throw new AppError('این قالب به یک دسته‌چک وصل است.');
    await prisma.chequeLayout.delete({ where: { id } });
    return { redirect: '/settings/cheque-layouts', message: 'حذف شد.' };
  });
}
