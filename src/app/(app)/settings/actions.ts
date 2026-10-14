'use server';

import bcrypt from 'bcryptjs';
import type { BusinessKind, DimRequirement, Role } from '@prisma/client';
import prisma from '@/lib/prisma';
import { assertEntityAccess, requireUser } from '@/lib/auth';
import { run, str, optStr, type ActionResult } from '@/lib/action';
import { AppError } from '@/lib/errors';
import { writeAudit } from '@/lib/audit';
import { parseJ } from '@/lib/jalali';
import { categoryForCode, defaultNormalSide } from '@/modules/accounts/template';
import { createFiscalYear, deleteFiscalYear, setPeriodStatus, updateFiscalYear } from '@/modules/fiscal/fiscal';
import { closeFiscalYear } from '@/modules/ledger/closing';

// ───────────────────────── حساب‌ها

function readRules(fd: FormData) {
  const rules: { dimensionTypeId: string; requirement: DimRequirement; position: number }[] = [];
  let pos = 1;
  for (const [k, v] of fd.entries()) {
    if (!k.startsWith('rule:')) continue;
    const req = String(v);
    if (req === 'REQUIRED' || req === 'OPTIONAL' || req === 'FORBIDDEN') rules.push({ dimensionTypeId: k.slice(5), requirement: req, position: pos++ });
  }
  return rules;
}

export async function saveAccountAction(fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser('settings.accounting');
    const id = optStr(fd, 'id');
    const name = str(fd, 'name');
    if (!name) throw new AppError('نام حساب الزامی است.');
    const tags = fd.getAll('tags').map(String).filter(Boolean);
    const active = fd.get('active') === 'on';
    const allowFx = fd.get('allowFx') === 'on';
    const inheritRules = fd.get('inheritRules') === 'on';
    const rules = inheritRules ? [] : readRules(fd);
    const description = optStr(fd, 'description');

    if (id) {
      const acc = await prisma.account.findUniqueOrThrow({ where: { id } });
      const code = str(fd, 'code') || acc.code;
      if (code !== acc.code) {
        const used = await prisma.voucherLine.count({ where: { accountId: id } });
        if (used) throw new AppError('کد حسابِ دارای گردش قابل تغییر نیست.');
        if (!code.startsWith((await prisma.account.findUnique({ where: { id: acc.parentId ?? '' } }))?.code ?? '')) throw new AppError('کد باید با کد حساب والد شروع شود.');
      }
      await prisma.$transaction(async (tx) => {
        await tx.account.update({ where: { id }, data: { code, name, tags, active, allowFx, description } });
        await tx.accountDimensionRule.deleteMany({ where: { accountId: id } });
        if (rules.length) await tx.accountDimensionRule.createMany({ data: rules.map((r) => ({ ...r, accountId: id })) });
        await writeAudit(tx, { userId: user.id, action: 'account.update', objectType: 'Account', objectId: id, data: { code, name, tags, active, rules } });
      });
      return { message: 'حساب ذخیره شد.' };
    }

    const parentId = str(fd, 'parentId');
    const parent = await prisma.account.findUniqueOrThrow({ where: { id: parentId } });
    if (parent.level === 'SUBSIDIARY') throw new AppError('زیر حساب معین نمی‌توان حساب تعریف کرد؛ از تفصیلی‌ها استفاده کنید.');
    const code = str(fd, 'code');
    if (!/^\d+$/.test(code) || !code.startsWith(parent.code) || code.length <= parent.code.length) {
      throw new AppError(`کد حساب باید عددی و با کد والد (${parent.code}) شروع شود.`);
    }
    const level = parent.level === 'GROUP' ? 'GL' : 'SUBSIDIARY';
    const category = parent.category ?? categoryForCode(code);
    const hasLines = await prisma.voucherLine.count({ where: { accountId: parent.id } });
    if (hasLines) throw new AppError('حساب والد گردش دارد و نمی‌تواند زیرحساب بگیرد.');
    await prisma.$transaction(async (tx) => {
      const acc = await tx.account.create({
        data: {
          chartId: parent.chartId,
          parentId: parent.id,
          code,
          name,
          level,
          category,
          normalSide: (str(fd, 'normalSide') as 'DEBIT' | 'CREDIT' | 'BOTH') || parent.normalSide || defaultNormalSide(category),
          isPostable: level === 'SUBSIDIARY',
          tags,
          allowFx,
          active,
          description,
          rules: rules.length ? { create: rules } : undefined,
        },
      });
      await writeAudit(tx, { userId: user.id, action: 'account.create', objectType: 'Account', objectId: acc.id, data: { code, name } });
    });
    return { message: 'حساب ایجاد شد.' };
  });
}

export async function deleteAccountAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser('settings.accounting');
    const acc = await prisma.account.findUniqueOrThrow({ where: { id }, include: { children: true } });
    if (acc.children.length) throw new AppError('حساب دارای زیرحساب است.');
    if (acc.systemRole) throw new AppError('حساب سیستمی قابل حذف نیست.');
    if (await prisma.voucherLine.count({ where: { accountId: id } })) throw new AppError('حساب گردش دارد؛ به‌جای حذف غیرفعالش کنید.');
    await prisma.$transaction(async (tx) => {
      await tx.account.delete({ where: { id } });
      await writeAudit(tx, { userId: user.id, action: 'account.delete', objectType: 'Account', objectId: id, data: { code: acc.code, name: acc.name } });
    });
    return { redirect: '/settings/accounts' };
  });
}

// ───────────────────────── ابعاد

export async function saveDimensionTypeAction(fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser('settings.accounting');
    const id = optStr(fd, 'id');
    const name = str(fd, 'name');
    if (!name) throw new AppError('نام الزامی است.');
    const data = { name, description: optStr(fd, 'description'), isHierarchical: fd.get('isHierarchical') === 'on' };
    if (id) {
      await prisma.dimensionType.update({ where: { id }, data });
      return { message: 'ذخیره شد.' };
    }
    const code = str(fd, 'code').toUpperCase();
    if (!/^[A-Z][A-Z0-9_]{1,30}$/.test(code)) throw new AppError('کد لاتین بزرگ (مثل CONTRACT) وارد کنید.');
    const max = await prisma.dimensionType.aggregate({ _max: { sortOrder: true } });
    const t = await prisma.dimensionType.create({ data: { ...data, code, sortOrder: (max._max.sortOrder ?? 0) + 10 } });
    await prisma.$transaction((tx) => writeAudit(tx, { userId: user.id, action: 'dimension_type.create', objectType: 'DimensionType', objectId: t.id, data: { code, name } }));
    return { redirect: `/settings/dimensions?type=${t.id}` };
  });
}

export async function saveDimensionValueAction(fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser('settings.accounting');
    const id = optStr(fd, 'id');
    const typeId = str(fd, 'typeId');
    const code = str(fd, 'code');
    const name = str(fd, 'name');
    if (!code || !name) throw new AppError('کد و نام الزامی است.');
    const entityId = optStr(fd, 'entityId');
    if (entityId) assertEntityAccess(user, entityId);
    const parentId = optStr(fd, 'parentId');
    if (parentId && parentId === id) throw new AppError('والد نمی‌تواند خود مقدار باشد.');
    const data = { code, name, parentId, entityId, active: fd.get('active') === 'on' };
    const type = await prisma.dimensionType.findUniqueOrThrow({ where: { id: typeId } });

    await prisma.$transaction(async (tx) => {
      const v = id ? await tx.dimensionValue.update({ where: { id }, data }) : await tx.dimensionValue.create({ data: { ...data, typeId } });
      if (type.code === 'BUSINESS') {
        const buEntity = entityId ?? str(fd, 'businessEntityId');
        if (!buEntity) throw new AppError('شرکت مالک کسب‌وکار را انتخاب کنید.');
        const bu = {
          entityId: buEntity,
          kind: (str(fd, 'kind') || 'WEBSITE') as BusinessKind,
          domain: optStr(fd, 'domain'),
          launchedAt: parseJ(str(fd, 'launchedAt')),
          description: optStr(fd, 'buDescription'),
        };
        await tx.businessUnit.upsert({ where: { dimensionValueId: v.id }, update: bu, create: { ...bu, dimensionValueId: v.id } });
      }
      await writeAudit(tx, { userId: user.id, action: id ? 'dimension_value.update' : 'dimension_value.create', objectType: 'DimensionValue', objectId: v.id, data: { type: type.code, code, name } });
    });
    return { message: id ? 'ذخیره شد.' : `«${name}» اضافه شد.` };
  });
}

export async function deleteDimensionValueAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser('settings.accounting');
    const used = await prisma.dimensionSetItem.count({ where: { valueId: id } });
    if (used) throw new AppError('این تفصیلی در اسناد استفاده شده؛ به‌جای حذف غیرفعالش کنید.');
    const kids = await prisma.dimensionValue.count({ where: { parentId: id } });
    if (kids) throw new AppError('این مقدار زیرمجموعه دارد.');
    const v = await prisma.dimensionValue.delete({ where: { id } });
    await prisma.$transaction((tx) => writeAudit(tx, { userId: user.id, action: 'dimension_value.delete', objectType: 'DimensionValue', objectId: id, data: { code: v.code, name: v.name } }));
    return { redirect: `/settings/dimensions?type=${v.typeId}` };
  });
}

// ───────────────────────── سال مالی

export async function saveFiscalYearAction(fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser('settings.accounting');
    const id = optStr(fd, 'id');
    const title = str(fd, 'title');
    const startDate = parseJ(str(fd, 'start'));
    const endDate = parseJ(str(fd, 'end'));
    if (!title) throw new AppError('عنوان سال مالی الزامی است.');
    if (!startDate || !endDate) throw new AppError('تاریخ شروع و پایان را به صورت 1405/01/01 وارد کنید.');
    if (id) {
      const fy = await prisma.fiscalYear.findUniqueOrThrow({ where: { id } });
      assertEntityAccess(user, fy.entityId);
      await updateFiscalYear(prisma, user.id, id, { title, startDate, endDate });
      return { message: 'سال مالی ذخیره شد.' };
    }
    const entityId = str(fd, 'entityId');
    assertEntityAccess(user, entityId);
    await createFiscalYear(prisma, user.id, { entityId, title, startDate, endDate });
    return { message: `سال مالی ${title} ایجاد شد.` };
  });
}

export async function deleteFiscalYearAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser('settings.accounting');
    const fy = await prisma.fiscalYear.findUniqueOrThrow({ where: { id } });
    assertEntityAccess(user, fy.entityId);
    await deleteFiscalYear(prisma, user.id, id);
  });
}

export async function setPeriodStatusAction(periodId: string, status: 'OPEN' | 'LOCKED'): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser('period.lock');
    await setPeriodStatus(prisma, user.id, periodId, status);
  });
}

export async function closeFiscalYearAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser('year.close');
    const fy = await prisma.fiscalYear.findUniqueOrThrow({ where: { id } });
    assertEntityAccess(user, fy.entityId);
    const r = await closeFiscalYear(prisma, user.id, id);
    return { message: `سال مالی بسته شد و ${r.vouchers.length} سند پایان سال/افتتاحیه صادر شد.` };
  });
}

// ───────────────────────── شرکت‌ها

export async function saveEntityAction(fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser('settings.entities');
    const id = optStr(fd, 'id');
    const name = str(fd, 'name');
    if (!name) throw new AppError('نام شرکت الزامی است.');
    const month = Number(str(fd, 'fiscalStartMonth') || 1);
    const day = Number(str(fd, 'fiscalStartDay') || 1);
    if (month < 1 || month > 12 || day < 1 || day > 31) throw new AppError('روز/ماه شروع سال مالی نامعتبر است.');
    const data = {
      name,
      legalName: optStr(fd, 'legalName'),
      legalType: optStr(fd, 'legalType'),
      nationalId: optStr(fd, 'nationalId'),
      economicCode: optStr(fd, 'economicCode'),
      registrationNo: optStr(fd, 'registrationNo'),
      address: optStr(fd, 'address'),
      parentId: optStr(fd, 'parentId'),
      fiscalStartMonth: month,
      fiscalStartDay: day,
      status: fd.get('active') === 'on' ? ('ACTIVE' as const) : ('INACTIVE' as const),
    };
    if (id) {
      if (data.parentId === id) throw new AppError('شرکت نمی‌تواند والد خودش باشد.');
      await prisma.$transaction(async (tx) => {
        await tx.entity.update({ where: { id }, data });
        await writeAudit(tx, { userId: user.id, action: 'entity.update', objectType: 'Entity', objectId: id, entityId: id, data });
      });
      return { message: 'ذخیره شد.' };
    }
    const code = str(fd, 'code').toUpperCase();
    if (!/^[A-Z0-9_-]{2,20}$/.test(code)) throw new AppError('کد شرکت را لاتین وارد کنید (مثلاً GOLD).');
    const chart = await prisma.chart.findFirstOrThrow({ where: { isGroupTemplate: true } });
    const entity = await prisma.$transaction(async (tx) => {
      const e = await tx.entity.create({ data: { ...data, code, chartId: chart.id } });
      await writeAudit(tx, { userId: user.id, action: 'entity.create', objectType: 'Entity', objectId: e.id, entityId: e.id, data: { code, name } });
      return e;
    });
    const fyStart = parseJ(str(fd, 'fyStart'));
    const fyEnd = parseJ(str(fd, 'fyEnd'));
    const fyTitle = str(fd, 'fyTitle');
    if (fyStart && fyEnd && fyTitle) await createFiscalYear(prisma, user.id, { entityId: entity.id, title: fyTitle, startDate: fyStart, endDate: fyEnd });
    return { message: `شرکت «${name}» ایجاد شد.` };
  });
}

// ───────────────────────── کاربران

const ROLES: Role[] = ['ADMIN', 'FINANCE_MANAGER', 'ACCOUNTANT', 'VIEWER'];

export async function saveUserAction(fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const admin = await requireUser('users.manage');
    const id = optStr(fd, 'id');
    const name = str(fd, 'name');
    const role = str(fd, 'role') as Role;
    if (!name) throw new AppError('نام الزامی است.');
    if (!ROLES.includes(role)) throw new AppError('نقش نامعتبر است.');
    const password = str(fd, 'password');
    if (password && password.length < 10) throw new AppError('رمز عبور باید حداقل ۱۰ کاراکتر باشد.');
    const entityIds = fd.getAll('entityIds').map(String).filter(Boolean);
    const active = fd.get('active') === 'on';

    if (id) {
      if (id === admin.id && (role !== 'ADMIN' || !active)) throw new AppError('نمی‌توانید نقش یا وضعیت حساب خودتان را کاهش دهید.');
      await prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id }, data: { name, role, active, ...(password ? { passwordHash: await bcrypt.hash(password, 10) } : {}) } });
        await tx.userScope.deleteMany({ where: { userId: id } });
        if (entityIds.length) await tx.userScope.createMany({ data: entityIds.map((entityId) => ({ userId: id, entityId })) });
        await writeAudit(tx, { userId: admin.id, action: 'user.update', objectType: 'User', objectId: id, data: { name, role, active, entityIds, passwordChanged: !!password } });
      });
      return { message: 'کاربر ذخیره شد.' };
    }
    const email = str(fd, 'email').toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new AppError('ایمیل نامعتبر است.');
    if (!password) throw new AppError('رمز عبور الزامی است.');
    await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: { email, name, role, active, passwordHash: await bcrypt.hash(password, 10), scopes: entityIds.length ? { create: entityIds.map((entityId) => ({ entityId })) } : undefined },
      });
      await writeAudit(tx, { userId: admin.id, action: 'user.create', objectType: 'User', objectId: u.id, data: { email, role, entityIds } });
    });
    return { message: 'کاربر ایجاد شد.' };
  });
}
