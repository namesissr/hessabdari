import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

export type AuditPayload = {
  prevHash: string | null;
  at: Date;
  userId?: string | null;
  action: string;
  objectType: string;
  objectId?: string | null;
  entityId?: string | null;
  data?: unknown;
};

/**
 * ترتیب کلیدها را یکسان می‌کند؛ ستون jsonb در PostgreSQL ترتیب کلیدها را نگه نمی‌دارد،
 * پس هش باید روی شکل نرمال‌شده حساب شود تا هنگام بازبینی دوباره بازتولید شود.
 */
export function canonicalize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonicalize);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v as Record<string, unknown>)
        .sort()
        .map((k) => [k, canonicalize((v as Record<string, unknown>)[k])]),
    );
  }
  if (typeof v === 'bigint') return v.toString();
  return v;
}

export function auditHash(e: AuditPayload): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        e.prevHash,
        e.at.toISOString(),
        e.userId ?? null,
        e.action,
        e.objectType,
        e.objectId ?? null,
        e.entityId ?? null,
        canonicalize(e.data ?? null),
      ]),
    )
    .digest('hex');
}

/** فرمول قدیمی هش (بدون نرمال‌سازی) — فقط برای بازبینی ردیف‌های ثبت‌شده پیش از این تغییر */
export function legacyAuditHash(e: AuditPayload): string {
  return createHash('sha256')
    .update(JSON.stringify([e.prevHash, e.at.toISOString(), e.userId ?? null, e.action, e.objectType, e.objectId ?? null, e.entityId ?? null, e.data ?? null]))
    .digest('hex');
}

/**
 * لاگ ممیزی زنجیره‌ای: هر ردیف هش ردیف قبلی را دارد، پس حذف یا دست‌کاری
 * (که trigger هم جلویش را می‌گیرد) با بررسی زنجیره قابل کشف است.
 */
export async function writeAudit(
  tx: Tx,
  e: { userId?: string | null; action: string; objectType: string; objectId?: string | null; entityId?: string | null; data?: unknown },
) {
  await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext('audit_log'))`);
  const last = await tx.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { hash: true } });
  const prevHash = last?.hash ?? null;
  const data = e.data === undefined ? null : JSON.parse(JSON.stringify(e.data, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
  const at = new Date();
  const hash = auditHash({ ...e, prevHash, at, data });
  await tx.auditLog.create({
    data: {
      at,
      userId: e.userId ?? null,
      action: e.action,
      objectType: e.objectType,
      objectId: e.objectId ?? null,
      entityId: e.entityId ?? null,
      data: data ?? undefined,
      prevHash,
      hash,
    },
  });
}
