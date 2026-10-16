import { test } from 'node:test';
import assert from 'node:assert/strict';
import { numberToWords, amountToWords } from '@/lib/num2words';

test('تبدیل عدد به حروف فارسی', () => {
  const cases: [bigint, string][] = [
    [0n, 'صفر'],
    [7n, 'هفت'],
    [10n, 'ده'],
    [15n, 'پانزده'],
    [20n, 'بیست'],
    [21n, 'بیست و یک'],
    [100n, 'یکصد'],
    [101n, 'یکصد و یک'],
    [110n, 'یکصد و ده'],
    [999n, 'نهصد و نود و نه'],
    [1000n, 'یک هزار'],
    [1500n, 'یک هزار و پانصد'],
    [12_500_000n, 'دوازده میلیون و پانصد هزار'],
    [1_000_000_000n, 'یک میلیارد'],
    [1_234_567_890n, 'یک میلیارد و دویست و سی و چهار میلیون و پانصد و شصت و هفت هزار و هشتصد و نود'],
    [900_000_000_000n, 'نهصد میلیارد'],
    [1_000_000_000_000n, 'یک بیلیون'],
  ];
  for (const [n, expected] of cases) assert.equal(numberToWords(n), expected, `عدد ${n}`);
});

test('متن مبلغ چک', () => {
  assert.equal(amountToWords(45_000_000n), 'چهل و پنج میلیون ریال');
  assert.equal(amountToWords(45_000_000n, 'تومان'), 'چهل و پنج میلیون تومان');
  assert.equal(amountToWords('۱۲٬۵۰۰٬۰۰۰'.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))), 'دوازده میلیون و پانصد هزار ریال');
});
