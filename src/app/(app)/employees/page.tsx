import Link from 'next/link';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { can } from '@/lib/auth';
import { formatJ, toFaDigits } from '@/lib/jalali';
import { one, pageContext, type SP } from '@/lib/page';
import { CONTRACT_LABEL, STATUS_LABEL } from '@/modules/hr/employees';
import { severanceLiability } from '@/modules/hr/payroll';
import { Badge, Card, Empty, LinkButton, Money, PageHeader, Stat } from '@/components/ui';
import { cn } from '@/lib/utils';

export const metadata = { title: 'کارکنان' };

const STATUS_TONE = { ACTIVE: 'green', ON_LEAVE: 'blue', SUSPENDED: 'amber', TERMINATED: 'gray' } as const;

export default async function EmployeesPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { user, entity } = await pageContext();
  if (!entity) return <Empty>ابتدا شرکت را تعریف کنید.</Empty>;

  const q = one(sp.q).trim();
  const status = one(sp.status) || 'ACTIVE';
  const businessDimId = one(sp.business);

  const where: Prisma.EmployeeWhereInput = {
    entityId: entity.id,
    ...(status === 'ALL' ? {} : { status: status as never }),
    ...(businessDimId ? { businessDimId } : {}),
    ...(q
      ? {
          OR: [
            { firstName: { contains: q, mode: 'insensitive' } },
            { lastName: { contains: q, mode: 'insensitive' } },
            { code: { contains: q } },
            { nationalCode: { contains: q } },
            { mobile: { contains: q } },
            { position: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [employees, businesses, dims, counts] = await Promise.all([
    prisma.employee.findMany({ where, orderBy: { code: 'asc' }, take: 300, include: { loans: { where: { status: 'ACTIVE' } } } }),
    prisma.dimensionValue.findMany({ where: { type: { code: 'BUSINESS' }, active: true }, orderBy: { code: 'asc' } }),
    prisma.dimensionValue.findMany({ where: { type: { code: 'COST_CENTER' } } }),
    prisma.employee.groupBy({ by: ['status'], where: { entityId: entity.id }, _count: true }),
  ]);
  const severance = await severanceLiability(prisma, entity.id);
  const dimName = new Map(dims.map((d) => [d.id, d.name]));
  const bizName = new Map(businesses.map((b) => [b.id, b.name]));

  const active = counts.find((c) => c.status === 'ACTIVE')?._count ?? 0;
  const totalSalary = employees.filter((e) => e.status === 'ACTIVE').reduce((s, e) => s + e.baseSalary + e.housingAllowance + e.foodAllowance + e.transportAllowance + e.otherAllowance, 0n);
  const totalSeverance = [...severance.values()].reduce((s, v) => s + (v._sum.severanceAccrual ?? 0n), 0n);
  const totalLoans = employees.reduce((s, e) => s + e.loans.reduce((x, l) => x + (l.amount - l.paidAmount), 0n), 0n);

  return (
    <>
      <PageHeader
        title="کارکنان"
        subtitle={`${entity.name} — ${toFaDigits(active)} نفر شاغل`}
        actions={
          can(user, 'voucher.edit') ? (
            <>
              <LinkButton href="/employees/new" variant="primary">کارمند جدید</LinkButton>
              <LinkButton href="/payroll">لیست حقوق</LinkButton>
            </>
          ) : null
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="تعداد کارکنان شاغل" value={BigInt(active)} hint="بدون پایان‌همکاری‌ها" />
        <Stat label="جمع حقوق و مزایای ماهانه" value={totalSalary} hint="بر اساس احکام جاری" />
        <Stat label="ذخیرهٔ سنوات انباشته" value={totalSeverance} hint="از روی فیش‌های قطعی‌شده" />
        <Stat label="ماندهٔ وام و مساعده" value={totalLoans} tone={totalLoans > 0n ? 'red' : undefined} />
      </div>

      <Card className="mb-4">
        <form className="grid gap-3 md:grid-cols-5">
          <div className="md:col-span-2">
            <label className="label">جستجو (نام، کد پرسنلی، کد ملی، سمت)</label>
            <input name="q" defaultValue={q} className="input" />
          </div>
          <div>
            <label className="label">وضعیت</label>
            <select name="status" defaultValue={status} className="input">
              <option value="ALL">همه</option>
              {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="label">کسب‌وکار</label>
            <select name="business" defaultValue={businessDimId} className="input">
              <option value="">همه</option>
              {businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div className="flex items-end">
            <button className="rounded-lg bg-slate-800 px-4 py-2 text-sm text-white">فیلتر</button>
          </div>
        </form>
      </Card>

      <Card bodyClass="p-0">
        {employees.length === 0 ? (
          <div className="p-4"><Empty>کارمندی ثبت نشده است.</Empty></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>کد</th>
                  <th>نام و نام خانوادگی</th>
                  <th>سمت</th>
                  <th>کسب‌وکار / مرکز هزینه</th>
                  <th>قرارداد</th>
                  <th>تاریخ استخدام</th>
                  <th>حقوق و مزایا</th>
                  <th>بیمه</th>
                  <th>وضعیت</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((e) => {
                  const total = e.baseSalary + e.housingAllowance + e.foodAllowance + e.transportAllowance + e.otherAllowance;
                  return (
                    <tr key={e.id} className={cn(e.status === 'TERMINATED' && 'text-slate-400')}>
                      <td className="num">{toFaDigits(e.code)}</td>
                      <td>
                        <Link className="font-medium text-brand-700 hover:underline" href={`/employees/${e.id}`}>{e.firstName} {e.lastName}</Link>
                        {e.nationalCode && <div className="num text-xs text-muted">{toFaDigits(e.nationalCode)}</div>}
                      </td>
                      <td className="text-sm">{e.position ?? '—'}</td>
                      <td className="text-xs">
                        {e.businessDimId ? bizName.get(e.businessDimId) : '—'}
                        {e.costCenterDimId && <div className="text-muted">{dimName.get(e.costCenterDimId)}</div>}
                      </td>
                      <td className="text-xs">{CONTRACT_LABEL[e.contractType]}</td>
                      <td className="whitespace-nowrap text-xs">{formatJ(e.hireDate)}</td>
                      <td><Money value={total} /></td>
                      <td className="text-xs">{e.insured ? <Badge tone="green">بیمه</Badge> : <Badge tone="gray">بدون بیمه</Badge>}</td>
                      <td><Badge tone={STATUS_TONE[e.status]}>{STATUS_LABEL[e.status]}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
