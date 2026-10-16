import { formatJ, toFaDigits } from '@/lib/jalali';
import { formatMoney } from '@/lib/money';
import { amountToWords, numberToWords } from '@/lib/num2words';

/**
 * چاپ چک: هر فیلد یک مختصات میلی‌متری نسبت به گوشهٔ بالا-راست برگهٔ چک دارد.
 * مقیاس چاپ ۱:۱ است (mm در CSS)، پس اگر مرورگر «تنظیم به اندازهٔ صفحه» را خاموش داشته باشد،
 * خروجی دقیقاً روی همان نقطه‌ای می‌نشیند که در تنظیمات تعیین شده است.
 */

export type ChequeFieldKey =
  | 'date'
  | 'dateYear'
  | 'dateMonth'
  | 'dateDay'
  | 'payee'
  | 'amountNumber'
  | 'amountWords'
  | 'description'
  | 'payeeNationalId'
  | 'serial'
  | 'sayadId'
  | 'issuePlace'
  | 'note';

export type ChequeField = {
  key: ChequeFieldKey;
  label: string;
  xMm: number;
  yMm: number;
  fontSize: number; // pt
  bold?: boolean;
  align?: 'right' | 'left' | 'center';
  maxWidthMm?: number;
  /** فاصلهٔ ثابت بین کاراکترها برای چک‌هایی که خانهٔ جدا دارند (مثلاً تاریخ) */
  charSpacingMm?: number;
  enabled: boolean;
};

export const FIELD_LABELS: Record<ChequeFieldKey, string> = {
  date: 'تاریخ (کامل)',
  dateYear: 'سال',
  dateMonth: 'ماه',
  dateDay: 'روز',
  payee: 'در وجه',
  amountNumber: 'مبلغ به عدد',
  amountWords: 'مبلغ به حروف',
  description: 'بابت',
  payeeNationalId: 'شناسه/کد ملی گیرنده',
  serial: 'شمارهٔ چک',
  sayadId: 'شناسهٔ صیاد',
  issuePlace: 'محل صدور',
  note: 'توضیح اضافه',
};

/**
 * قالب پیش‌فرض بر اساس برگهٔ چک صیادی (حدود ۱۹۵×۸۵ میلی‌متر).
 * مختصات‌ها نقطهٔ شروع‌اند و باید یک‌بار با «چاپ آزمایشی» برای هر بانک تنظیم شوند.
 */
export const DEFAULT_FIELDS: ChequeField[] = [
  // xMm همیشه فاصله از لبهٔ راست برگه است. ناحیهٔ تاریخ روی چک‌های ایرانی سمت چپ-بالاست.
  { key: 'dateYear', label: FIELD_LABELS.dateYear, xMm: 158, yMm: 14, fontSize: 11, align: 'center', enabled: true },
  { key: 'dateMonth', label: FIELD_LABELS.dateMonth, xMm: 142, yMm: 14, fontSize: 11, align: 'center', enabled: true },
  { key: 'dateDay', label: FIELD_LABELS.dateDay, xMm: 126, yMm: 14, fontSize: 11, align: 'center', enabled: true },
  { key: 'date', label: FIELD_LABELS.date, xMm: 142, yMm: 14, fontSize: 11, align: 'center', enabled: false },
  { key: 'amountNumber', label: FIELD_LABELS.amountNumber, xMm: 150, yMm: 30, fontSize: 12, bold: true, align: 'center', enabled: true },
  { key: 'payee', label: FIELD_LABELS.payee, xMm: 45, yMm: 29, fontSize: 11, align: 'right', maxWidthMm: 110, enabled: true },
  { key: 'amountWords', label: FIELD_LABELS.amountWords, xMm: 35, yMm: 41, fontSize: 10, align: 'right', maxWidthMm: 150, enabled: true },
  { key: 'payeeNationalId', label: FIELD_LABELS.payeeNationalId, xMm: 150, yMm: 55, fontSize: 10, align: 'center', enabled: true },
  { key: 'description', label: FIELD_LABELS.description, xMm: 45, yMm: 55, fontSize: 10, align: 'right', maxWidthMm: 80, enabled: true },
  { key: 'serial', label: FIELD_LABELS.serial, xMm: 30, yMm: 8, fontSize: 9, align: 'right', enabled: false },
  { key: 'sayadId', label: FIELD_LABELS.sayadId, xMm: 100, yMm: 70, fontSize: 9, align: 'center', enabled: false },
  { key: 'issuePlace', label: FIELD_LABELS.issuePlace, xMm: 60, yMm: 68, fontSize: 10, align: 'center', enabled: false },
  { key: 'note', label: FIELD_LABELS.note, xMm: 100, yMm: 76, fontSize: 9, align: 'center', enabled: false },
];

export const DEFAULT_LAYOUT = {
  name: 'چک صیادی — قالب پیش‌فرض',
  widthMm: 195,
  heightMm: 85,
  offsetXMm: 0,
  offsetYMm: 0,
  fields: DEFAULT_FIELDS,
};

export type ChequePrintData = {
  dueDate: Date;
  amount: bigint;
  payee: string;
  payeeNationalId?: string | null;
  description?: string | null;
  serialNo?: string | null;
  sayadId?: string | null;
  issuePlace?: string | null;
  note?: string | null;
};

/** مقدار نهایی هر فیلد روی چک */
export function fieldValue(key: ChequeFieldKey, data: ChequePrintData): string {
  const j = formatJ(data.dueDate, false).split('/');
  switch (key) {
    case 'date':
      return toFaDigits(formatJ(data.dueDate, false));
    case 'dateYear':
      return toFaDigits(j[0]);
    case 'dateMonth':
      return toFaDigits(j[1]);
    case 'dateDay':
      return toFaDigits(j[2]);
    case 'payee':
      return data.payee;
    case 'amountNumber':
      return formatMoney(data.amount, { zero: '۰' });
    case 'amountWords':
      return amountToWords(data.amount);
    case 'description':
      return data.description ?? '';
    case 'payeeNationalId':
      return data.payeeNationalId ? toFaDigits(data.payeeNationalId) : '';
    case 'serial':
      return data.serialNo ? toFaDigits(data.serialNo) : '';
    case 'sayadId':
      return data.sayadId ? toFaDigits(data.sayadId) : '';
    case 'issuePlace':
      return data.issuePlace ?? '';
    case 'note':
      return data.note ?? '';
  }
}

export const SAMPLE_DATA: ChequePrintData = {
  dueDate: new Date(Date.UTC(2026, 10, 3)),
  amount: 125_400_000n,
  payee: 'شرکت نمونهٔ پارس (سهامی خاص)',
  payeeNationalId: '10101234567',
  description: 'بابت خرید تجهیزات',
  serialNo: '123456/78',
  sayadId: '1234567890123456',
  issuePlace: 'تهران',
  note: '',
};

/** متن چک برای بازبینی قبل از چاپ (کنترل نهایی کاربر) */
export function printSummary(data: ChequePrintData) {
  return {
    date: toFaDigits(formatJ(data.dueDate, false)),
    amountNumber: formatMoney(data.amount),
    amountWords: amountToWords(data.amount),
    amountTomanWords: `${numberToWords(data.amount / 10n)} تومان`,
    payee: data.payee,
  };
}
