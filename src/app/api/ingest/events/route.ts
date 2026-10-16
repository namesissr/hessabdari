import { headers } from 'next/headers';
import prisma from '@/lib/prisma';
import { errorMessage } from '@/lib/errors';
import { findSourceByKey, ingestEvent, type EventPayload } from '@/modules/ingest/engine';

export const dynamic = 'force-dynamic';

/**
 * دریافت رویداد مالی از سایت‌ها.
 *   POST /api/ingest/events     هدر: X-Source-Key: <کلید منبع>
 *   { "type": "order.paid", "externalId": "arz-98231", "amount": 12000000, "tax": 1200000, ... }
 * ارسال دوبارهٔ همان externalId سند تکراری نمی‌سازد.
 */
export async function POST(req: Request) {
  const key = (await headers()).get('x-source-key') ?? '';
  const source = await findSourceByKey(prisma, key);
  if (!source) return Response.json({ ok: false, error: 'کلید منبع نامعتبر است.' }, { status: 401 });

  let body: EventPayload | EventPayload[];
  try {
    body = (await req.json()) as EventPayload | EventPayload[];
  } catch {
    return Response.json({ ok: false, error: 'بدنهٔ درخواست JSON معتبر نیست.' }, { status: 400 });
  }

  const events = Array.isArray(body) ? body : [body];
  if (events.length > 100) return Response.json({ ok: false, error: 'حداکثر ۱۰۰ رویداد در هر درخواست.' }, { status: 400 });

  const results: { externalId: string; ok: boolean; duplicate?: boolean; voucherId?: string | null; error?: string }[] = [];
  let failed = 0;
  for (const e of events) {
    try {
      const r = await ingestEvent(prisma, source.id, e);
      results.push({ externalId: e.externalId, ok: true, duplicate: r.duplicate, voucherId: r.voucherId });
    } catch (err) {
      failed++;
      results.push({ externalId: e?.externalId ?? '', ok: false, error: errorMessage(err) });
    }
  }

  const single = !Array.isArray(body);
  const status = failed === 0 ? 200 : failed === events.length ? 422 : 207;
  return Response.json(single ? results[0] : { ok: failed === 0, results }, { status });
}

/** بررسی سلامت اتصال از سمت سایت */
export async function GET() {
  const key = (await headers()).get('x-source-key') ?? '';
  const source = await findSourceByKey(prisma, key);
  if (!source) return Response.json({ ok: false }, { status: 401 });
  const [count, last] = await Promise.all([
    prisma.ingestEvent.count({ where: { sourceId: source.id } }),
    prisma.ingestEvent.findFirst({ where: { sourceId: source.id }, orderBy: { receivedAt: 'desc' }, select: { externalId: true, status: true, receivedAt: true } }),
  ]);
  return Response.json({ ok: true, source: { code: source.code, name: source.name }, events: count, last });
}
