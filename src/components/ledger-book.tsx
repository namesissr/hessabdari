import Link from 'next/link';
import { formatJ, toFaDigits } from '@/lib/jalali';
import { formatMoney } from '@/lib/money';
import type { BookAccount } from '@/modules/reports/books';
import { Card, Empty, Money } from './ui';

export function BookBalance({ v }: { v: bigint }) {
  return (
    <span className="num whitespace-nowrap">
      {formatMoney(v < 0n ? -v : v, { zero: '۰' })} <span className="text-xs text-muted">{v > 0n ? 'بد' : v < 0n ? 'بس' : ''}</span>
    </span>
  );
}

/** یک «صفحه» از دفتر برای هر حساب */
export function LedgerBook({ accounts, mode, title }: { accounts: BookAccount[]; mode: 'period' | 'voucher'; title: string }) {
  if (!accounts.length) return <Empty>در این بازه گردشی ثبت نشده است.</Empty>;
  const grand = accounts.reduce((s, a) => ({ d: s.d + a.totalDebit, c: s.c + a.totalCredit }), { d: 0n, c: 0n });

  return (
    <div className="space-y-4">
      {accounts.map((a) => (
        <Card
          key={a.id}
          bodyClass="p-0"
          title={
            <span className="flex flex-wrap items-center gap-2">
              <span className="num font-bold">{a.code}</span>
              <span>{a.name}</span>
              {a.parentCode && <span className="text-xs font-normal text-muted">زیرمجموعهٔ {a.parentCode} — {a.parentName}</span>}
            </span>
          }
        >
          <table className="table">
            <thead>
              <tr>
                <th className="w-28">{mode === 'period' ? 'دوره' : 'تاریخ'}</th>
                {mode === 'voucher' && <th className="w-24">شمارهٔ سند</th>}
                <th>شرح</th>
                <th className="w-40">بدهکار</th>
                <th className="w-40">بستانکار</th>
                <th className="w-44">مانده</th>
              </tr>
            </thead>
            <tbody>
              <tr className="bg-slate-50">
                <td colSpan={mode === 'voucher' ? 3 : 2} className="font-medium">ماندهٔ ابتدای دوره</td>
                <td /><td />
                <td><BookBalance v={a.opening} /></td>
              </tr>
              {a.rows.map((r) => (
                <tr key={r.key}>
                  <td className="whitespace-nowrap">{mode === 'period' ? r.label : formatJ(r.date)}</td>
                  {mode === 'voucher' && (
                    <td className="whitespace-nowrap">
                      {r.voucherId ? (
                        <Link className="text-brand-700 hover:underline" href={`/vouchers/${r.voucherId}`}>{toFaDigits(r.number ?? 0)}</Link>
                      ) : '—'}
                    </td>
                  )}
                  <td className="text-sm">{r.description}</td>
                  <td><Money value={r.debit} /></td>
                  <td><Money value={r.credit} /></td>
                  <td><BookBalance v={r.balance} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={mode === 'voucher' ? 3 : 2}>جمع گردش و ماندهٔ پایان دوره</td>
                <td><Money value={a.totalDebit} /></td>
                <td><Money value={a.totalCredit} /></td>
                <td><BookBalance v={a.closing} /></td>
              </tr>
            </tfoot>
          </table>
        </Card>
      ))}
      <Card bodyClass="p-3">
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm font-bold">
          <span>جمع کل {title} — {toFaDigits(accounts.length)} حساب</span>
          <span className="flex gap-6">
            <span>بدهکار: <Money value={grand.d} /></span>
            <span>بستانکار: <Money value={grand.c} /></span>
          </span>
        </div>
      </Card>
    </div>
  );
}
