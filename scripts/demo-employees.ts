/**
 * دادهٔ نمایشی کارکنان و حقوق — فقط روی دیتابیس آزمایشی.
 *   DATABASE_URL=...hesabdari_demo npx tsx scripts/demo-employees.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { saveEmployee, addLoan, addLeave } from '@/modules/hr/employees';
import { createRun, updateItem } from '@/modules/hr/payroll';
import { dateToJ, jToDate, todayUtc } from '@/lib/jalali';

const db = new PrismaClient();

async function main() {
  if (!/demo|test/.test(process.env.DATABASE_URL ?? '')) throw new Error('DATABASE_URL must point to a demo/test database');
  const user = await db.user.findFirstOrThrow({ where: { role: 'ADMIN' } });
  const entity = await db.entity.findUniqueOrThrow({ where: { code: 'RAI' } });
  if (await db.employee.count({ where: { entityId: entity.id } })) {
    console.log('employees already exist — skipping');
    return;
  }
  const dim: Record<string, string> = {};
  for (const v of await db.dimensionValue.findMany()) dim[v.code] = v.id;
  const bank = await db.bankAccount.findFirstOrThrow({ where: { entityId: entity.id } });
  const { jy, jm } = dateToJ(todayUtc());

  const people = [
    { firstName: 'سارا', lastName: 'محمدی', position: 'مدیر مالی', base: 320_000_000n, cc: '400', biz: 'HQ', children: 1, married: true },
    { firstName: 'امیر', lastName: 'کاظمی', position: 'برنامه‌نویس ارشد', base: 280_000_000n, cc: '110', biz: 'HQ', children: 2, married: true },
    { firstName: 'نگار', lastName: 'حسینی', position: 'کارشناس پشتیبانی', base: 150_000_000n, cc: '300', biz: 'ARZINOO', children: 0, married: false },
    { firstName: 'رضا', lastName: 'نوری', position: 'کارشناس زیرساخت', base: 230_000_000n, cc: '120', biz: 'HQ', children: 0, married: false },
    { firstName: 'مریم', lastName: 'صادقی', position: 'کارشناس بازاریابی', base: 180_000_000n, cc: '200', biz: 'BLUEPAL', children: 1, married: true },
  ];

  const ids: string[] = [];
  for (const [i, p] of people.entries()) {
    const emp = await saveEmployee(db, user.id, {
      entityId: entity.id,
      firstName: p.firstName,
      lastName: p.lastName,
      nationalCode: String(1234567890 + i),
      gender: i % 2 === 0 ? 'FEMALE' : 'MALE',
      maritalStatus: p.married ? 'MARRIED' : 'SINGLE',
      childrenCount: p.children,
      mobile: `0912000000${i}`,
      hireDate: jToDate(jy - 2 + i, 1 + i, 10),
      contractType: 'PERMANENT',
      position: p.position,
      businessDimId: dim[p.biz],
      costCenterDimId: dim[p.cc],
      insuranceNo: `${98000000 + i}`,
      insured: true,
      taxExempt: false,
      bankName: 'ملت',
      iban: `IR${(100000000000000000000000n + BigInt(i)).toString()}`,
      baseSalary: p.base,
      housingAllowance: 9_000_000n,
      foodAllowance: 20_000_000n,
      childAllowance: 0n,
      transportAllowance: 10_000_000n,
      otherAllowance: 0n,
      status: 'ACTIVE',
    });
    ids.push(emp.id);
  }

  await addLoan(db, user.id, { employeeId: ids[1], date: jToDate(jy, Math.max(1, jm - 1), 5), amount: 80_000_000n, installmentAmount: 10_000_000n, isAdvance: false, description: 'وام ضروری', bankAccountId: bank.id });
  await addLeave(db, user.id, { employeeId: ids[2], type: 'ANNUAL', fromDate: jToDate(jy, jm, 3), toDate: jToDate(jy, jm, 5), days: 3, note: 'مرخصی استحقاقی' });

  const run = await createRun(db, user.id, { entityId: entity.id, jy, jm: Math.max(1, jm - 1) });
  const items = await db.payrollItem.findMany({ where: { runId: run.id } });
  await updateItem(db, user.id, items[1].id, { overtimeHours: 24 });
  await updateItem(db, user.id, items[2].id, { workingDays: 27, absenceDays: 0, overtimeHours: 8 });
  console.log(`employees: ${ids.length}, payroll run ${run.title} created (draft)`);
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
