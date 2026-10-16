import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { installChartTemplate, ensureSystemDimensions } from '../src/modules/accounts/install';
import { buildPeriods } from '../src/modules/fiscal/fiscal';
import { jToDate, addDays, dateToJ, todayUtc } from '../src/lib/jalali';
import { DEFAULT_LAYOUT } from '../src/modules/treasury/cheque-print';
import { SYSTEM_USER_EMAIL } from '../src/modules/ingest/engine';

const prisma = new PrismaClient();

/**
 * دادهٔ اولیه — idempotent (اجرای دوباره چیزی را تکرار نمی‌کند).
 * شرکت: رایانش ابری ایرانیان؛ کسب‌وکارها: ارزینو، بلوپال، چارتینو، فیلیمینو + ستاد.
 */
async function main() {
  await ensureSystemDimensions(prisma);

  const chart = await prisma.chart.upsert({
    where: { code: 'GROUP' },
    update: {},
    create: { code: 'GROUP', name: 'چارت حساب‌های مجموعه', isGroupTemplate: true },
  });
  const created = await installChartTemplate(prisma, chart.id);
  console.log(`chart: ${created} accounts created`);

  const entity = await prisma.entity.upsert({
    where: { code: 'RAI' },
    update: {},
    create: {
      code: 'RAI',
      name: 'رایانش ابری ایرانیان',
      legalName: 'شرکت رایانش ابری ایرانیان',
      chartId: chart.id,
    },
  });

  // سال مالی جاری (پیش‌فرض: سال شمسی جاری از ۱ فروردین)
  if ((await prisma.fiscalYear.count({ where: { entityId: entity.id } })) === 0) {
    const { jy } = dateToJ(todayUtc());
    const start = jToDate(jy, 1, 1);
    const end = addDays(jToDate(jy + 1, 1, 1), -1);
    await prisma.fiscalYear.create({
      data: { entityId: entity.id, title: String(jy), startDate: start, endDate: end, periods: { create: buildPeriods(start, end) } },
    });
    console.log(`fiscal year ${jy} created`);
  }

  const bizType = await prisma.dimensionType.findUniqueOrThrow({ where: { code: 'BUSINESS' } });
  const businesses = [
    { code: 'HQ', name: 'ستاد و هزینه‌های مشترک', kind: 'HEADQUARTERS' as const },
    { code: 'ARZINO', name: 'ارزینو', kind: 'WEBSITE' as const },
    { code: 'BLUEPAL', name: 'بلوپال', kind: 'WEBSITE' as const },
    { code: 'CHARTINO', name: 'چارتینو', kind: 'WEBSITE' as const },
    { code: 'FILIMINO', name: 'فیلیمینو', kind: 'WEBSITE' as const },
  ];
  for (const b of businesses) {
    const v = await prisma.dimensionValue.upsert({
      where: { typeId_code: { typeId: bizType.id, code: b.code } },
      update: {},
      create: { typeId: bizType.id, code: b.code, name: b.name },
    });
    await prisma.businessUnit.upsert({
      where: { dimensionValueId: v.id },
      update: {},
      create: { dimensionValueId: v.id, entityId: entity.id, kind: b.kind },
    });
  }

  const ccType = await prisma.dimensionType.findUniqueOrThrow({ where: { code: 'COST_CENTER' } });
  const centers: { code: string; name: string; parent?: string }[] = [
    { code: '100', name: 'فنی و مهندسی' },
    { code: '110', name: 'توسعهٔ نرم‌افزار', parent: '100' },
    { code: '120', name: 'زیرساخت و سرور', parent: '100' },
    { code: '200', name: 'بازاریابی و فروش' },
    { code: '300', name: 'پشتیبانی مشتریان' },
    { code: '400', name: 'مالی و اداری' },
    { code: '500', name: 'مدیریت' },
  ];
  for (const c of centers) {
    const parent = c.parent ? await prisma.dimensionValue.findUnique({ where: { typeId_code: { typeId: ccType.id, code: c.parent } } }) : null;
    await prisma.dimensionValue.upsert({
      where: { typeId_code: { typeId: ccType.id, code: c.code } },
      update: {},
      create: { typeId: ccType.id, code: c.code, name: c.name, parentId: parent?.id ?? null },
    });
  }

  if ((await prisma.chequeLayout.count()) === 0) {
    await prisma.chequeLayout.create({
      data: {
        name: DEFAULT_LAYOUT.name,
        widthMm: DEFAULT_LAYOUT.widthMm,
        heightMm: DEFAULT_LAYOUT.heightMm,
        fields: DEFAULT_LAYOUT.fields as object,
        isDefault: true,
      },
    });
    console.log('cheque layout created');
  }

  // کاربر سیستمی برای اسناد خودکار (ورود با آن ممکن نیست)
  if (!(await prisma.user.findUnique({ where: { email: SYSTEM_USER_EMAIL } }))) {
    await prisma.user.create({
      data: { email: SYSTEM_USER_EMAIL, name: 'سیستم (اسناد خودکار)', role: 'VIEWER', active: false, passwordHash: await bcrypt.hash(randomBytes(32).toString('hex'), 10) },
    });
  }

  const email = (process.env.ADMIN_EMAIL ?? 'admin@hesabdari.local').toLowerCase();
  if (!(await prisma.user.findUnique({ where: { email } }))) {
    const password = process.env.ADMIN_PASSWORD || (process.env.NODE_ENV === 'production' ? '' : 'Hesabdari!2026');
    if (password.length < 10) throw new Error('ADMIN_PASSWORD (min 10 chars) is required to create the first admin');
    await prisma.user.create({
      data: { email, name: 'مدیر سیستم', role: 'ADMIN', passwordHash: await bcrypt.hash(password, 10) },
    });
    console.log(`admin user: ${email}`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
