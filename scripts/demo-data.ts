/**
 * دادهٔ نمایشی برای آشنایی با سیستم — فقط روی دیتابیس آزمایشی اجرا کنید.
 *   DATABASE_URL=...hesabdari_demo npx tsx scripts/demo-data.ts
 * اگر در دیتابیس سندی وجود داشته باشد اجرا نمی‌شود.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { createDraft, postVoucher } from '../src/modules/ledger/posting';
import { jToDate, dateToJ, todayUtc } from '../src/lib/jalali';

const db = new PrismaClient();

async function main() {
  if (!/demo|test/.test(process.env.DATABASE_URL ?? '')) throw new Error('DATABASE_URL must point to a demo/test database');
  if (await db.voucher.count()) throw new Error('database already has vouchers — refusing to add demo data');

  const user = await db.user.findFirstOrThrow({ where: { role: 'ADMIN' } });
  const entity = await db.entity.findUniqueOrThrow({ where: { code: 'RAI' } });
  const acc: Record<string, string> = {};
  for (const a of await db.account.findMany({ where: { chartId: entity.chartId } })) acc[a.code] = a.id;
  const type: Record<string, string> = {};
  for (const t of await db.dimensionType.findMany()) type[t.code] = t.id;
  const dim: Record<string, string> = {};
  for (const v of await db.dimensionValue.findMany()) dim[v.code] = v.id;

  const mk = async (typeCode: string, code: string, name: string) =>
    (dim[code] = (await db.dimensionValue.create({ data: { typeId: type[typeCode], code, name } })).id);
  await mk('BANK_ACCOUNT', 'BK-MELLAT', 'بانک ملت — جاری ۱۲۳۴');
  await mk('BANK_ACCOUNT', 'BK-SAMAN', 'بانک سامان — جاری ۵۶۷۸');
  await mk('BANK_ACCOUNT', 'CASH-HQ', 'صندوق دفتر مرکزی');
  await mk('PARTY', 'P-HETZNER', 'Hetzner Online');
  await mk('PARTY', 'P-ZIBAL', 'درگاه پرداخت زیبال');
  await mk('PARTY', 'P-LANDLORD', 'موجر دفتر مرکزی');
  await mk('PARTY', 'P-SH1', 'سهامدار — آقای الف');
  await mk('PARTY', 'P-CUST1', 'شرکت نمونه (مشتری سازمانی)');
  await mk('INSTRUMENT', 'GOLD-COIN', 'سکهٔ تمام بهار آزادی');
  await mk('INSTRUMENT', 'FUND-FIXED', 'صندوق درآمد ثابت نمونه');

  const B = (c: string) => ({ [type.BUSINESS]: dim[c] });
  const BANK = (c = 'BK-MELLAT') => ({ [type.BANK_ACCOUNT]: dim[c] });
  const CC = (c: string) => ({ [type.COST_CENTER]: dim[c] });
  const P = (c: string) => ({ [type.PARTY]: dim[c] });
  const { jy, jm: curMonth } = dateToJ(todayUtc());
  const post = async (m: number, d: number, description: string, lines: Parameters<typeof createDraft>[2]['lines'], type: 'NORMAL' | 'OPENING' = 'NORMAL') => {
    const v = await createDraft(db, user.id, { entityId: entity.id, date: jToDate(jy, m, d), description, lines, type });
    await postVoucher(db, user.id, v.id);
  };

  await post(1, 1, 'مانده‌های افتتاحیه', [
    { accountId: acc['1101'], debit: 25_000_000_000n, dims: BANK() },
    { accountId: acc['1102'], debit: 500_000_000n, dims: BANK('CASH-HQ') },
    { accountId: acc['2104'], debit: 3_000_000_000n },
    { accountId: acc['5101'], credit: 20_000_000_000n, dims: P('P-SH1') },
    { accountId: acc['5301'], credit: 8_500_000_000n, dims: B('HQ') },
  ], 'OPENING');

  const sales: Record<string, bigint> = { ARZINO: 4_200_000_000n, BLUEPAL: 2_600_000_000n, CHARTINO: 1_500_000_000n, FILIMINO: 900_000_000n };
  for (let m = 1; m <= Math.min(curMonth, 12); m++) {
    const growth = BigInt(100 + m * 6);
    for (const [biz, base] of Object.entries(sales)) {
      const amount = (base * growth) / 100n;
      await post(m, 10, `فروش ماهانهٔ ${biz} از درگاه`, [
        { accountId: acc['1104'], debit: amount, dims: B(biz) },
        { accountId: acc['6101'], credit: (amount * 100n) / 110n, dims: B(biz) },
        { accountId: acc['3201'], credit: amount - (amount * 100n) / 110n, dims: B(biz) },
      ]);
      await post(m, 12, `تسویهٔ درگاه زیبال — ${biz}`, [
        { accountId: acc['1101'], debit: amount - amount / 100n, dims: BANK() },
        { accountId: acc['7103'], debit: amount / 100n, dims: B(biz) },
        { accountId: acc['1104'], credit: amount, dims: B(biz) },
      ]);
      await post(m, 15, `هزینهٔ سرور Hetzner — ${biz}`, [
        { accountId: acc['7101'], debit: base / 5n, dims: { ...B(biz), ...CC('120') } },
        { accountId: acc['3101'], credit: base / 5n, dims: P('P-HETZNER') },
      ]);
    }
    await post(m, 20, 'حقوق کارکنان', [
      { accountId: acc['8101'], debit: 1_800_000_000n, dims: { ...B('HQ'), ...CC('110') } },
      { accountId: acc['8101'], debit: 600_000_000n, dims: { ...B('HQ'), ...CC('300') } },
      { accountId: acc['8101'], debit: 500_000_000n, dims: { ...B('HQ'), ...CC('400') } },
      { accountId: acc['1101'], credit: 2_900_000_000n, dims: BANK() },
    ]);
    await post(m, 25, 'اجارهٔ دفتر مرکزی', [
      { accountId: acc['8201'], debit: 350_000_000n, dims: { ...B('HQ'), ...CC('400') } },
      { accountId: acc['1101'], credit: 350_000_000n, dims: BANK() },
    ]);
    await post(m, 26, 'تبلیغات آنلاین ارزینو و بلوپال', [
      { accountId: acc['8301'], debit: 400_000_000n, dims: { ...B('ARZINO'), ...CC('200') } },
      { accountId: acc['8301'], debit: 250_000_000n, dims: { ...B('BLUEPAL'), ...CC('200') } },
      { accountId: acc['1101'], credit: 650_000_000n, dims: BANK('BK-SAMAN') },
    ]);
  }
  await post(2, 5, 'خرید سکهٔ تمام (۵ عدد)', [
    { accountId: acc['1203'], debit: 3_750_000_000n, dims: { [type.INSTRUMENT]: dim['GOLD-COIN'] }, quantity: 5, unit: 'سکه' },
    { accountId: acc['1101'], credit: 3_750_000_000n, dims: BANK() },
  ]);
  await post(3, 1, 'خرید واحد صندوق درآمد ثابت', [
    { accountId: acc['1202'], debit: 5_000_000_000n, dims: { [type.INSTRUMENT]: dim['FUND-FIXED'] } },
    { accountId: acc['1101'], credit: 5_000_000_000n, dims: BANK() },
  ]);
  const v = await createDraft(db, user.id, {
    entityId: entity.id,
    date: jToDate(jy, Math.min(curMonth, 12), 1),
    description: 'یادداشت نمونه — پرداخت بدهی Hetzner (هنوز قطعی نشده)',
    lines: [
      { accountId: acc['3101'], debit: 1_000_000_000n, dims: P('P-HETZNER') },
      { accountId: acc['1101'], credit: 1_000_000_000n, dims: BANK() },
    ],
  });
  console.log('demo data created; sample draft', v.draftNo);
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
