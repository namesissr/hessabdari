import prisma from '@/lib/prisma';
import { formatJ } from '@/lib/jalali';
import { CONTRACT_LABEL, STATUS_LABEL } from '@/modules/hr/employees';
import { ActionForm } from '@/components/action-form';
import { JDateInput } from '@/components/jdate-input';
import { Card } from '@/components/ui';
import { saveEmployeeAction } from './actions';

type Employee = Awaited<ReturnType<typeof prisma.employee.findUnique>>;

/** فرم کامل پروندهٔ کارمند (ثبت و ویرایش) */
export async function EmployeeForm({ entityId, employee }: { entityId: string; employee?: NonNullable<Employee> | null }) {
  const [businesses, costCenters, managers] = await Promise.all([
    prisma.dimensionValue.findMany({ where: { type: { code: 'BUSINESS' }, active: true }, orderBy: { code: 'asc' } }),
    prisma.dimensionValue.findMany({ where: { type: { code: 'COST_CENTER' }, active: true }, orderBy: { code: 'asc' } }),
    prisma.employee.findMany({ where: { entityId, status: 'ACTIVE', ...(employee ? { id: { not: employee.id } } : {}) }, orderBy: { firstName: 'asc' } }),
  ]);
  const money = (v: bigint | undefined) => (v !== undefined ? v.toString() : '');

  return (
    <ActionForm action={saveEmployeeAction} submitLabel={employee ? 'ذخیرهٔ تغییرات' : 'ثبت کارمند'} className="space-y-4">
      <input type="hidden" name="entityId" value={entityId} />
      {employee && <input type="hidden" name="id" value={employee.id} />}

      <Card title="اطلاعات فردی">
        <div className="grid gap-3 md:grid-cols-4">
          <div><label className="label">کد پرسنلی</label><input name="code" dir="ltr" className="input" defaultValue={employee?.code} placeholder="خودکار" /></div>
          <div><label className="label">نام *</label><input name="firstName" className="input" defaultValue={employee?.firstName} required /></div>
          <div><label className="label">نام خانوادگی *</label><input name="lastName" className="input" defaultValue={employee?.lastName} required /></div>
          <div><label className="label">نام پدر</label><input name="fatherName" className="input" defaultValue={employee?.fatherName ?? ''} /></div>
          <div><label className="label">کد ملی</label><input name="nationalCode" dir="ltr" inputMode="numeric" className="input" defaultValue={employee?.nationalCode ?? ''} /></div>
          <div><label className="label">شمارهٔ شناسنامه</label><input name="idNumber" dir="ltr" className="input" defaultValue={employee?.idNumber ?? ''} /></div>
          <div><label className="label">تاریخ تولد</label><JDateInput name="birthDate" defaultValue={employee?.birthDate ? formatJ(employee.birthDate, false) : ''} /></div>
          <div>
            <label className="label">جنسیت</label>
            <select name="gender" className="input" defaultValue={employee?.gender ?? 'MALE'}>
              <option value="MALE">مرد</option>
              <option value="FEMALE">زن</option>
            </select>
          </div>
          <div>
            <label className="label">وضعیت تأهل</label>
            <select name="maritalStatus" className="input" defaultValue={employee?.maritalStatus ?? 'SINGLE'}>
              <option value="SINGLE">مجرد</option>
              <option value="MARRIED">متأهل</option>
            </select>
          </div>
          <div><label className="label">تعداد فرزند</label><input name="childrenCount" type="number" min={0} max={20} className="input" defaultValue={employee?.childrenCount ?? 0} /></div>
          <div><label className="label">موبایل</label><input name="mobile" dir="ltr" className="input" defaultValue={employee?.mobile ?? ''} /></div>
          <div><label className="label">تلفن</label><input name="phone" dir="ltr" className="input" defaultValue={employee?.phone ?? ''} /></div>
          <div className="md:col-span-2"><label className="label">ایمیل</label><input name="email" dir="ltr" className="input" defaultValue={employee?.email ?? ''} /></div>
          <div className="md:col-span-2"><label className="label">نشانی</label><input name="address" className="input" defaultValue={employee?.address ?? ''} /></div>
          <div><label className="label">تماس اضطراری (نام)</label><input name="emergencyName" className="input" defaultValue={employee?.emergencyName ?? ''} /></div>
          <div><label className="label">تماس اضطراری (شماره)</label><input name="emergencyPhone" dir="ltr" className="input" defaultValue={employee?.emergencyPhone ?? ''} /></div>
        </div>
      </Card>

      <Card title="اطلاعات شغلی">
        <div className="grid gap-3 md:grid-cols-4">
          <div><label className="label">تاریخ استخدام *</label><JDateInput name="hireDate" defaultValue={employee?.hireDate ? formatJ(employee.hireDate, false) : ''} required /></div>
          <div>
            <label className="label">نوع قرارداد</label>
            <select name="contractType" className="input" defaultValue={employee?.contractType ?? 'PERMANENT'}>
              {Object.entries(CONTRACT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div><label className="label">سمت</label><input name="position" className="input" defaultValue={employee?.position ?? ''} /></div>
          <div>
            <label className="label">مدیر مستقیم</label>
            <select name="managerId" className="input" defaultValue={employee?.managerId ?? ''}>
              <option value="">—</option>
              {managers.map((m) => <option key={m.id} value={m.id}>{m.firstName} {m.lastName}</option>)}
            </select>
          </div>
          <div>
            <label className="label">کسب‌وکار (برای تخصیص هزینهٔ حقوق)</label>
            <select name="businessDimId" className="input" defaultValue={employee?.businessDimId ?? ''}>
              <option value="">—</option>
              {businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">مرکز هزینه</label>
            <select name="costCenterDimId" className="input" defaultValue={employee?.costCenterDimId ?? ''}>
              <option value="">—</option>
              {costCenters.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">وضعیت</label>
            <select name="status" className="input" defaultValue={employee?.status ?? 'ACTIVE'}>
              {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div><label className="label">مبنای سنوات (اگر با استخدام فرق دارد)</label><JDateInput name="severanceStartDate" defaultValue={employee?.severanceStartDate ? formatJ(employee.severanceStartDate, false) : ''} /></div>
          <div><label className="label">تاریخ پایان همکاری</label><JDateInput name="terminationDate" defaultValue={employee?.terminationDate ? formatJ(employee.terminationDate, false) : ''} /></div>
          <div className="md:col-span-3"><label className="label">علت پایان همکاری</label><input name="terminationReason" className="input" defaultValue={employee?.terminationReason ?? ''} /></div>
        </div>
      </Card>

      <Card title="بیمه و مالیات">
        <div className="grid gap-3 md:grid-cols-4">
          <div><label className="label">شمارهٔ بیمه</label><input name="insuranceNo" dir="ltr" className="input" defaultValue={employee?.insuranceNo ?? ''} /></div>
          <div><label className="label">شمارهٔ پروندهٔ مالیاتی</label><input name="taxFileNo" dir="ltr" className="input" defaultValue={employee?.taxFileNo ?? ''} /></div>
          <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" name="insured" defaultChecked={employee ? employee.insured : true} /> مشمول بیمهٔ تأمین اجتماعی</label>
          <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" name="taxExempt" defaultChecked={employee?.taxExempt} /> معاف از مالیات حقوق</label>
        </div>
      </Card>

      <Card title="حقوق و مزایای ماهانه (ریال)">
        <div className="grid gap-3 md:grid-cols-3">
          <div><label className="label">حقوق پایه *</label><input name="baseSalary" dir="ltr" inputMode="numeric" className="input num" defaultValue={money(employee?.baseSalary)} required /></div>
          <div><label className="label">حق مسکن</label><input name="housingAllowance" dir="ltr" inputMode="numeric" className="input num" defaultValue={money(employee?.housingAllowance)} placeholder="خالی = پیش‌فرض سال" /></div>
          <div><label className="label">بن خواربار</label><input name="foodAllowance" dir="ltr" inputMode="numeric" className="input num" defaultValue={money(employee?.foodAllowance)} placeholder="خالی = پیش‌فرض سال" /></div>
          <div><label className="label">حق اولاد</label><input name="childAllowance" dir="ltr" inputMode="numeric" className="input num" defaultValue={money(employee?.childAllowance)} placeholder="خالی = بر اساس تعداد فرزند" /></div>
          <div><label className="label">ایاب و ذهاب</label><input name="transportAllowance" dir="ltr" inputMode="numeric" className="input num" defaultValue={money(employee?.transportAllowance)} /></div>
          <div><label className="label">سایر مزایا</label><input name="otherAllowance" dir="ltr" inputMode="numeric" className="input num" defaultValue={money(employee?.otherAllowance)} /></div>
        </div>
      </Card>

      <Card title="حساب بانکی و یادداشت">
        <div className="grid gap-3 md:grid-cols-4">
          <div><label className="label">بانک</label><input name="bankName" className="input" defaultValue={employee?.bankName ?? ''} /></div>
          <div><label className="label">شمارهٔ حساب</label><input name="accountNo" dir="ltr" className="input" defaultValue={employee?.accountNo ?? ''} /></div>
          <div className="md:col-span-2"><label className="label">شبا (برای فایل بانک)</label><input name="iban" dir="ltr" className="input" defaultValue={employee?.iban ?? ''} placeholder="IR..." /></div>
          <div className="md:col-span-4"><label className="label">یادداشت</label><input name="notes" className="input" defaultValue={employee?.notes ?? ''} /></div>
        </div>
      </Card>
    </ActionForm>
  );
}
