import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

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
  const hash = createHash('sha256')
    .update(JSON.stringify([prevHash, at.toISOString(), e.userId ?? null, e.action, e.objectType, e.objectId ?? null, e.entityId ?? null, data]))
    .digest('hex');
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
