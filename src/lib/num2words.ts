/**
 * تبدیل عدد به حروف فارسی — برای چاپ چک و اسناد رسمی.
 * مبنا: گروه‌های سه‌رقمی با نام‌های هزار/میلیون/میلیارد/بیلیون…
 */

const ONES = ['', 'یک', 'دو', 'سه', 'چهار', 'پنج', 'شش', 'هفت', 'هشت', 'نه'];
const TEENS = ['ده', 'یازده', 'دوازده', 'سیزده', 'چهارده', 'پانزده', 'شانزده', 'هفده', 'هجده', 'نوزده'];
const TENS = ['', '', 'بیست', 'سی', 'چهل', 'پنجاه', 'شصت', 'هفتاد', 'هشتاد', 'نود'];
const HUNDREDS = ['', 'یکصد', 'دویست', 'سیصد', 'چهارصد', 'پانصد', 'ششصد', 'هفتصد', 'هشتصد', 'نهصد'];
const SCALES = ['', 'هزار', 'میلیون', 'میلیارد', 'بیلیون', 'بیلیارد', 'تریلیون'];

function threeDigits(n: number): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h) parts.push(HUNDREDS[h]);
  if (rest >= 10 && rest <= 19) parts.push(TEENS[rest - 10]);
  else {
    const t = Math.floor(rest / 10);
    const o = rest % 10;
    if (t) parts.push(TENS[t]);
    if (o) parts.push(ONES[o]);
  }
  return parts.join(' و ');
}

/** ۱۲٬۵۰۰٬۰۰۰ → «دوازده میلیون و پانصد هزار» */
export function numberToWords(value: bigint | number | string): string {
  let n = typeof value === 'bigint' ? value : BigInt(String(value).replace(/[^\d-]/g, '') || '0');
  if (n === 0n) return 'صفر';
  const negative = n < 0n;
  if (negative) n = -n;

  const groups: number[] = [];
  while (n > 0n) {
    groups.push(Number(n % 1000n));
    n /= 1000n;
  }
  if (groups.length > SCALES.length) return '';

  const parts: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i];
    if (!g) continue;
    parts.push(`${threeDigits(g)}${SCALES[i] ? ' ' + SCALES[i] : ''}`.trim());
  }
  return (negative ? 'منفی ' : '') + parts.join(' و ');
}

/** متن مبلغ برای چک: «دوازده میلیون و پانصد هزار ریال» */
export function amountToWords(value: bigint | number | string, unit = 'ریال'): string {
  const w = numberToWords(value);
  return w ? `${w} ${unit}` : '';
}

/** معادل تومان (تقسیم بر ۱۰) برای نمایش کمکی */
export function rialToToman(value: bigint): { toman: bigint; remainder: bigint } {
  return { toman: value / 10n, remainder: value % 10n };
}
