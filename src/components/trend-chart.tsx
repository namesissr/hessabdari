'use client';

import { useState } from 'react';
import { formatMoney } from '@/lib/money';

type Point = { title: string; revenue: string; expense: string };

const COLORS = { revenue: '#2a78d6', expense: '#eb6834' };
const LABELS = { revenue: 'درآمد', expense: 'هزینه' };

/** نمودار ستونی گروهی درآمد/هزینهٔ ماهانه — یک محور، راهنما، tooltip هنگام hover */
export function TrendChart({ data }: { data: Point[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const rows = data.map((d) => ({ title: d.title, revenue: BigInt(d.revenue), expense: BigInt(d.expense) }));
  const max = rows.reduce((m, r) => (r.revenue > m ? r.revenue : r.expense > m ? r.expense : m), 0n);
  const W = 720, H = 240, padL = 8, padR = 78, padT = 12, padB = 36;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const slot = plotW / Math.max(rows.length, 1);
  const barW = Math.min(18, (slot - 10) / 2);
  const scale = (v: bigint) => (max > 0n && v > 0n ? Number((v * 10000n) / max) / 10000 * plotH : 0);
  const ticks = [0, 0.5, 1];

  if (max === 0n) return <div className="flex h-48 items-center justify-center text-sm text-muted">هنوز درآمد یا هزینه‌ای ثبت نشده است.</div>;

  return (
    <div className="relative">
      <div className="mb-2 flex gap-4 text-xs text-slate-600">
        {(Object.keys(COLORS) as (keyof typeof COLORS)[]).map((k) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: COLORS[k] }} />
            {LABELS[k]}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="روند ماهانهٔ درآمد و هزینه" onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => {
          const y = padT + plotH - t * plotH;
          const val = (max * BigInt(Math.round(t * 100))) / 100n;
          return (
            <g key={t}>
              <line x1={padL} x2={padL + plotW} y1={y} y2={y} stroke="#e2e8f0" strokeWidth={1} />
              <text x={W - 2} y={y + 4} fontSize={10} fill="#64748b" textAnchor="start" direction="rtl">
                {compact(val)}
              </text>
            </g>
          );
        })}
        {rows.map((r, i) => {
          // راست‌به‌چپ: ماه اول در سمت راست
          const cx = padL + plotW - (i + 0.5) * slot;
          const hr = scale(r.revenue), he = scale(r.expense);
          return (
            <g key={i} onMouseEnter={() => setHover(i)}>
              <rect x={cx - slot / 2} y={padT} width={slot} height={plotH} fill={hover === i ? '#f1f5f9' : 'transparent'} />
              {hr > 0 && <rect x={cx + 1} y={padT + plotH - hr} width={barW} height={hr} rx={3} fill={COLORS.revenue} />}
              {he > 0 && <rect x={cx - 1 - barW} y={padT + plotH - he} width={barW} height={he} rx={3} fill={COLORS.expense} />}
              <text x={cx} y={H - 14} fontSize={10} fill="#475569" textAnchor="middle">
                {r.title.split(' ')[0]}
              </text>
            </g>
          );
        })}
      </svg>
      {hover !== null && rows[hover] && (
        <div className="pointer-events-none absolute top-8 left-2 rounded-lg border border-line bg-white px-3 py-2 text-xs shadow-md">
          <div className="mb-1 font-semibold">{rows[hover].title}</div>
          <div>درآمد: <span className="num">{formatMoney(rows[hover].revenue, { zero: '۰' })}</span></div>
          <div>هزینه: <span className="num">{formatMoney(rows[hover].expense, { zero: '۰' })}</span></div>
          <div className="mt-1 border-t border-line pt-1">خالص: <span className="num">{formatMoney(rows[hover].revenue - rows[hover].expense, { zero: '۰' })}</span></div>
        </div>
      )}
    </div>
  );
}

function compact(v: bigint): string {
  const n = Number(v);
  const fmt = (x: number, u: string) => `${x.toLocaleString('fa-IR', { maximumFractionDigits: 1 })} ${u}`;
  if (n >= 1e12) return fmt(n / 1e12, 'همت');
  if (n >= 1e9) return fmt(n / 1e9, 'میلیارد');
  if (n >= 1e6) return fmt(n / 1e6, 'میلیون');
  return n.toLocaleString('fa-IR');
}
