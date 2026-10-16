import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { saveParty, saveBankAccount } from '@/modules/treasury/masters';
import { saveTreasury, postTreasury } from '@/modules/treasury/treasury';
import { createCheque, chequeEvent } from '@/modules/treasury/cheques';
import { jToDate, dateToJ, todayUtc } from '@/lib/jalali';

const db = new PrismaClient();

async function main() {
  const user = await db.user.findFirstOrThrow({ where: { role: 'ADMIN' } });
  const entity = await db.entity.findUniqueOrThrow({ where: { code: 'RAI' } });
  const acc: Record<string, string> = {};
  for (const a of await db.account.findMany({ where: { chartId: entity.chartId } })) acc[a.code] = a.id;
  const dim: Record<string, string> = {};
  for (const v of await db.dimensionValue.findMany()) dim[v.code] = v.id;
  const { jy } = dateToJ(todayUtc());
  const d = (m: number, day: number) => jToDate(jy, m, day);

  const customer = await saveParty(db, user.id, { name: 'شرکت فناوری پاسارگاد', kind: 'COMPANY', roles: ['CUSTOMER'], nationalCode: '10101234567', mobile: '09121234567' });
  const supplier = await saveParty(db, user.id, { name: 'داده‌پردازان ابری', kind: 'COMPANY', roles: ['SUPPLIER'], nationalCode: '10987654321' });
  const bank = await saveBankAccount(db, user.id, { entityId: entity.id, name: 'بانک ملت — جاری ۱۲۳۴', kind: 'BANK', bankName: 'ملت', branch: 'ونک', accountNo: '1234567890', iban: 'IR123456789012345678901234', glAccountId: acc['1101'] });
  await saveBankAccount(db, user.id, { entityId: entity.id, name: 'صندوق دفتر', kind: 'CASH', glAccountId: acc['1102'] });

  const r = await saveTreasury(db, user.id, {
    entityId: entity.id,
    type: 'RECEIPT',
    date: d(6, 10),
    partyId: customer.id,
    businessDimId: dim.ARZINO,
    description: 'دریافت بابت فاکتور ۱۰۲',
    items: [{ method: 'BANK', bankAccountId: bank.id, amount: 180_000_000n, feeAmount: 50_000n, reference: 'پیگیری ۸۸۷۷' }],
    allocations: [{ accountId: acc['1301'], partyId: customer.id, businessDimId: dim.ARZINO, amount: 180_000_000n }],
  });
  await postTreasury(db, user.id, r.id);

  const p = await saveTreasury(db, user.id, {
    entityId: entity.id,
    type: 'PAYMENT',
    date: d(6, 12),
    partyId: supplier.id,
    businessDimId: dim.HQ,
    description: 'پرداخت بابت سرور — با چک',
    items: [{ method: 'CHEQUE_NEW', amount: 95_400_000n, newCheque: { serialNo: '452189', sayadId: '1234567890123456', dueDate: d(8, 15), bankAccountId: bank.id, bankName: 'ملت' } }],
    allocations: [{ accountId: acc['7101'], businessDimId: dim.ARZINO, costCenterDimId: dim['120'], amount: 95_400_000n }],
  });
  await postTreasury(db, user.id, p.id);

  const received = await createCheque(
    db,
    user.id,
    { entityId: entity.id, direction: 'RECEIVED', serialNo: '771122', bankName: 'سامان', amount: 64_000_000n, dueDate: d(7, 25), issueDate: d(6, 20), partyId: customer.id, businessDimId: dim.BLUEPAL, description: 'بابت فاکتور ۱۰۵', drawerName: 'شرکت فناوری پاسارگاد' },
    { postRegister: true },
  );
  await chequeEvent(db, user.id, { chequeId: received.id, type: 'DEPOSIT', date: d(7, 20), bankAccountId: bank.id });

  await createCheque(
    db,
    user.id,
    { entityId: entity.id, direction: 'ISSUED', serialNo: '452190', bankName: 'ملت', amount: 25_000_000n, dueDate: d(9, 5), partyId: supplier.id, bankAccountId: bank.id, description: 'پیش‌پرداخت قرارداد' },
    { postRegister: true },
  );

  console.log('treasury demo ready');
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
