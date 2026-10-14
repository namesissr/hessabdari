import type { AccountCategory, DimRequirement, NormalSide } from '@prisma/client';

/**
 * قالب چارت حساب‌های مجموعه (گروه ۱ رقم، کل ۲ رقم، معین ۴ رقم).
 * اصل مهم: نام هیچ کسب‌وکاری در کدینگ نمی‌آید — کسب‌وکار «بُعد» روی ردیف سند است.
 */

export type TemplateRule = [dimensionCode: string, requirement: DimRequirement];

export type TemplateAccount = {
  code: string;
  name: string;
  normalSide?: NormalSide;
  tags?: string[];
  systemRole?: string;
  rules?: TemplateRule[];
};

const R = (code: string): TemplateRule => [code, 'REQUIRED'];
const O = (code: string): TemplateRule => [code, 'OPTIONAL'];

export const SYSTEM_DIMENSIONS: { code: string; name: string; isHierarchical?: boolean; description: string }[] = [
  { code: 'BUSINESS', name: 'کسب‌وکار', description: 'مرکز سود: سایت‌ها، خطوط تجاری، پروژه‌های سرمایه‌گذاری و ستاد' },
  { code: 'COST_CENTER', name: 'مرکز هزینه', isHierarchical: true, description: 'واحدهای سازمانی مصرف‌کنندهٔ هزینه' },
  { code: 'PROJECT', name: 'پروژه', isHierarchical: true, description: 'پروژه‌ها و قراردادها' },
  { code: 'PARTY', name: 'طرف حساب', description: 'اشخاص حقیقی و حقوقی: مشتری، تأمین‌کننده، کارمند، سهامدار' },
  { code: 'BANK_ACCOUNT', name: 'بانک و صندوق', description: 'حساب‌های بانکی، صندوق‌ها و تنخواه‌ها' },
  { code: 'INSTRUMENT', name: 'ابزار سرمایه‌گذاری', description: 'سهام، صندوق، طلا، رمزارز، سپرده، سهم شرکت' },
  { code: 'CUSTODY', name: 'محل نگهداری', description: 'کارگزار، صرافی، کیف پول، گاوصندوق' },
  { code: 'LOAN', name: 'قرارداد تسهیلات', description: 'وام‌ها و تسهیلات دریافتی و پرداختی' },
  { code: 'FIXED_ASSET', name: 'دارایی ثابت', description: 'کارت اموال' },
  { code: 'INTERCOMPANY', name: 'شرکت طرف معامله', description: 'برای حذف معاملات بین شرکت‌های گروه در تلفیق' },
];

const PL_REV: TemplateRule[] = [R('BUSINESS'), O('PROJECT'), O('PARTY')];
const PL_COST: TemplateRule[] = [R('BUSINESS'), O('COST_CENTER'), O('PROJECT'), O('PARTY')];
const PL_OPEX: TemplateRule[] = [R('BUSINESS'), R('COST_CENTER'), O('PROJECT'), O('PARTY')];

export const CHART_TEMPLATE: TemplateAccount[] = [
  { code: '1', name: 'دارایی‌های جاری', tags: ['CURRENT'] },
  { code: '11', name: 'موجودی نقد', tags: ['CASH'], rules: [R('BANK_ACCOUNT'), O('BUSINESS')] },
  { code: '1101', name: 'موجودی نزد بانک‌ها' },
  { code: '1102', name: 'صندوق' },
  { code: '1103', name: 'تنخواه‌گردان' },
  { code: '1104', name: 'وجوه در راه (تسویهٔ درگاه‌های پرداخت)', rules: [O('BANK_ACCOUNT'), O('BUSINESS')] },
  { code: '12', name: 'سرمایه‌گذاری‌های کوتاه‌مدت', tags: ['INVESTMENT'], rules: [R('INSTRUMENT'), O('CUSTODY')] },
  { code: '1201', name: 'سهام شرکت‌های بورسی و فرابورسی' },
  { code: '1202', name: 'واحدهای صندوق‌های سرمایه‌گذاری' },
  { code: '1203', name: 'طلا، سکه و شمش' },
  { code: '1204', name: 'رمزارزها' },
  { code: '1205', name: 'سپرده‌های سرمایه‌گذاری بانکی', rules: [R('BANK_ACCOUNT'), O('INSTRUMENT')] },
  { code: '1206', name: 'اوراق بدهی و سایر اوراق بهادار' },
  { code: '13', name: 'دریافتنی‌های تجاری', tags: ['RECEIVABLE'], rules: [R('PARTY'), O('BUSINESS')] },
  { code: '1301', name: 'حساب‌های دریافتنی تجاری' },
  { code: '1302', name: 'اسناد دریافتنی (چک‌های دریافتی)' },
  { code: '1303', name: 'چک‌های در جریان وصول', rules: [R('PARTY'), O('BANK_ACCOUNT'), O('BUSINESS')] },
  { code: '1304', name: 'ذخیرهٔ مطالبات مشکوک‌الوصول', normalSide: 'CREDIT', rules: [O('PARTY'), O('BUSINESS')] },
  { code: '14', name: 'سایر دریافتنی‌ها', tags: ['RECEIVABLE'], rules: [R('PARTY'), O('BUSINESS')] },
  { code: '1401', name: 'وام و مساعدهٔ کارکنان' },
  { code: '1402', name: 'حساب جاری شرکت‌های گروه', rules: [R('INTERCOMPANY')] },
  { code: '1403', name: 'تسهیلات اعطایی به دیگران', rules: [R('PARTY'), O('LOAN')] },
  { code: '1404', name: 'سود دریافتنی', rules: [O('PARTY'), O('INSTRUMENT'), O('BANK_ACCOUNT')] },
  { code: '1405', name: 'سایر حساب‌های دریافتنی' },
  { code: '15', name: 'پیش‌پرداخت‌ها', rules: [O('PARTY'), O('BUSINESS')] },
  { code: '1501', name: 'پیش‌پرداخت هزینه‌ها' },
  { code: '1502', name: 'پیش‌پرداخت خرید کالا و خدمات' },
  { code: '1503', name: 'مالیات بر ارزش افزودهٔ خرید' },
  { code: '1504', name: 'پیش‌پرداخت مالیات عملکرد' },
  { code: '16', name: 'موجودی کالا', rules: [O('BUSINESS'), O('PROJECT')] },
  { code: '1601', name: 'موجودی کالای تجاری' },
  { code: '1602', name: 'کالای در راه' },

  { code: '2', name: 'دارایی‌های غیرجاری', tags: ['NON_CURRENT'] },
  { code: '21', name: 'دارایی‌های ثابت مشهود', tags: ['FIXED_ASSET'], rules: [O('FIXED_ASSET'), O('BUSINESS')] },
  { code: '2101', name: 'زمین' },
  { code: '2102', name: 'ساختمان' },
  { code: '2103', name: 'تجهیزات سرور و شبکه' },
  { code: '2104', name: 'رایانه و تجهیزات اداری' },
  { code: '2105', name: 'اثاثه و منصوبات' },
  { code: '2106', name: 'وسایط نقلیه' },
  { code: '2107', name: 'دارایی‌های در جریان تکمیل' },
  { code: '22', name: 'استهلاک انباشتهٔ دارایی‌های ثابت', normalSide: 'CREDIT', tags: ['FIXED_ASSET'], rules: [O('FIXED_ASSET'), O('BUSINESS')] },
  { code: '2201', name: 'استهلاک انباشتهٔ ساختمان', normalSide: 'CREDIT' },
  { code: '2202', name: 'استهلاک انباشتهٔ تجهیزات سرور و شبکه', normalSide: 'CREDIT' },
  { code: '2203', name: 'استهلاک انباشتهٔ رایانه و تجهیزات اداری', normalSide: 'CREDIT' },
  { code: '2204', name: 'استهلاک انباشتهٔ اثاثه و منصوبات', normalSide: 'CREDIT' },
  { code: '2205', name: 'استهلاک انباشتهٔ وسایط نقلیه', normalSide: 'CREDIT' },
  { code: '23', name: 'دارایی‌های نامشهود', rules: [O('FIXED_ASSET'), O('BUSINESS')] },
  { code: '2301', name: 'نرم‌افزار و پلتفرم‌ها' },
  { code: '2302', name: 'دامنه، برند و علائم تجاری' },
  { code: '2303', name: 'سرقفلی' },
  { code: '2304', name: 'استهلاک انباشتهٔ دارایی‌های نامشهود', normalSide: 'CREDIT' },
  { code: '24', name: 'سرمایه‌گذاری‌های بلندمدت', tags: ['INVESTMENT'], rules: [R('INSTRUMENT'), O('CUSTODY'), O('INTERCOMPANY')] },
  { code: '2401', name: 'سرمایه‌گذاری در شرکت‌های فرعی' },
  { code: '2402', name: 'سرمایه‌گذاری در شرکت‌های وابسته' },
  { code: '2403', name: 'سایر سرمایه‌گذاری‌ها در سهام شرکت‌ها' },
  { code: '2404', name: 'سرمایه‌گذاری در املاک' },
  { code: '2405', name: 'سپرده‌های بلندمدت بانکی', rules: [R('BANK_ACCOUNT'), O('INSTRUMENT')] },
  { code: '25', name: 'سایر دارایی‌های غیرجاری', rules: [O('PARTY'), O('BUSINESS')] },
  { code: '2501', name: 'سپرده‌ها و ودایع نزد دیگران' },
  { code: '2502', name: 'تسهیلات اعطایی بلندمدت', rules: [R('PARTY'), O('LOAN')] },

  { code: '3', name: 'بدهی‌های جاری', tags: ['CURRENT'] },
  { code: '31', name: 'پرداختنی‌های تجاری', tags: ['PAYABLE'], rules: [R('PARTY'), O('BUSINESS')] },
  { code: '3101', name: 'حساب‌های پرداختنی تجاری' },
  { code: '3102', name: 'اسناد پرداختنی (چک‌های پرداختی)' },
  { code: '32', name: 'سایر پرداختنی‌ها', tags: ['PAYABLE'], rules: [O('PARTY'), O('BUSINESS')] },
  { code: '3201', name: 'مالیات بر ارزش افزودهٔ فروش' },
  { code: '3202', name: 'مالیات‌های تکلیفی پرداختنی' },
  { code: '3203', name: 'حق بیمهٔ پرداختنی' },
  { code: '3204', name: 'حقوق و دستمزد پرداختنی' },
  { code: '3205', name: 'حساب جاری شرکت‌های گروه', rules: [R('INTERCOMPANY')] },
  { code: '3206', name: 'سپرده‌ها و ودایع دریافتی', rules: [R('PARTY'), O('BUSINESS')] },
  { code: '3207', name: 'حساب جاری شرکا و سهامداران', rules: [R('PARTY')] },
  { code: '3208', name: 'سایر حساب‌های پرداختنی', rules: [R('PARTY'), O('BUSINESS')] },
  { code: '33', name: 'پیش‌دریافت‌ها و درآمدهای انتقالی', tags: ['DEFERRED_REVENUE'], rules: [R('BUSINESS'), O('PARTY')] },
  { code: '3301', name: 'پیش‌دریافت از مشتریان' },
  { code: '3302', name: 'موجودی کیف پول کاربران' },
  { code: '3303', name: 'درآمد اشتراک مربوط به دوره‌های آتی' },
  { code: '34', name: 'تسهیلات مالی جاری', tags: ['LOAN'], rules: [R('LOAN'), O('PARTY')] },
  { code: '3401', name: 'تسهیلات بانکی کوتاه‌مدت' },
  { code: '3402', name: 'بخش جاری تسهیلات بلندمدت' },
  { code: '3403', name: 'وام دریافتی از اشخاص' },
  { code: '3404', name: 'سود تسهیلات پرداختنی' },
  { code: '35', name: 'ذخایر', rules: [O('PARTY'), O('BUSINESS')] },
  { code: '3501', name: 'ذخیرهٔ مالیات عملکرد' },
  { code: '3502', name: 'ذخیرهٔ هزینه‌های تحقق‌یافته پرداخت‌نشده' },
  { code: '36', name: 'سود سهام پرداختنی', rules: [R('PARTY')] },
  { code: '3601', name: 'سود سهام پرداختنی' },

  { code: '4', name: 'بدهی‌های غیرجاری', tags: ['NON_CURRENT'] },
  { code: '41', name: 'تسهیلات مالی بلندمدت', tags: ['LOAN'], rules: [R('LOAN'), O('PARTY')] },
  { code: '4101', name: 'تسهیلات بانکی بلندمدت' },
  { code: '4102', name: 'وام بلندمدت از اشخاص' },
  { code: '42', name: 'ذخیرهٔ مزایای پایان خدمت کارکنان', rules: [O('PARTY')] },
  { code: '4201', name: 'ذخیرهٔ مزایای پایان خدمت کارکنان' },
  { code: '43', name: 'سایر بدهی‌های بلندمدت', rules: [O('PARTY')] },
  { code: '4301', name: 'سایر بدهی‌های بلندمدت' },

  { code: '5', name: 'حقوق مالکانه' },
  { code: '51', name: 'سرمایه', rules: [O('PARTY')] },
  { code: '5101', name: 'سرمایهٔ ثبت‌شده' },
  { code: '5102', name: 'افزایش سرمایه در جریان' },
  { code: '52', name: 'اندوخته‌ها' },
  { code: '5201', name: 'اندوختهٔ قانونی' },
  { code: '5202', name: 'سایر اندوخته‌ها' },
  { code: '53', name: 'سود (زیان) انباشته', rules: [O('BUSINESS')] },
  { code: '5301', name: 'سود (زیان) انباشته', systemRole: 'RETAINED_EARNINGS' },
  { code: '5302', name: 'تعدیلات سنواتی' },
  { code: '54', name: 'مازاد تجدید ارزیابی دارایی‌ها', rules: [O('FIXED_ASSET'), O('INSTRUMENT')] },
  { code: '5401', name: 'مازاد تجدید ارزیابی دارایی‌ها' },

  { code: '6', name: 'درآمدها', rules: PL_REV },
  { code: '61', name: 'درآمدهای عملیاتی', tags: ['OPERATING_REVENUE'] },
  { code: '6101', name: 'درآمد فروش اشتراک' },
  { code: '6102', name: 'درآمد فروش خدمات' },
  { code: '6103', name: 'درآمد کارمزد و خدمات تراکنش' },
  { code: '6104', name: 'درآمد تبلیغات' },
  { code: '6105', name: 'درآمد فروش کالا' },
  { code: '6106', name: 'سایر درآمدهای عملیاتی' },
  { code: '62', name: 'برگشت از فروش و تخفیفات', normalSide: 'DEBIT', tags: ['CONTRA_REVENUE'] },
  { code: '6201', name: 'برگشت از فروش', normalSide: 'DEBIT' },
  { code: '6202', name: 'تخفیفات فروش', normalSide: 'DEBIT' },
  { code: '63', name: 'سایر درآمدها', tags: ['OTHER_INCOME'], rules: [R('BUSINESS'), O('INSTRUMENT'), O('BANK_ACCOUNT'), O('PARTY')] },
  { code: '6301', name: 'سود سپرده‌های بانکی' },
  { code: '6302', name: 'سود سهام و صندوق‌های سرمایه‌گذاری' },
  { code: '6303', name: 'سود تحقق‌یافتهٔ فروش سرمایه‌گذاری‌ها' },
  { code: '6304', name: 'سود تحقق‌نیافتهٔ ارزش‌گذاری سرمایه‌گذاری‌ها' },
  { code: '6305', name: 'سود تسعیر ارز' },
  { code: '6306', name: 'سود فروش دارایی‌های ثابت' },
  { code: '6307', name: 'سایر درآمدهای غیرعملیاتی' },

  { code: '7', name: 'بهای تمام‌شده', tags: ['COGS'], rules: PL_COST },
  { code: '71', name: 'بهای تمام‌شدهٔ خدمات' },
  { code: '7101', name: 'هزینهٔ سرور و زیرساخت ابری' },
  { code: '7102', name: 'هزینهٔ پهنای باند و CDN' },
  { code: '7103', name: 'کارمزد درگاه‌های پرداخت' },
  { code: '7104', name: 'لایسنس و محتوای خریداری‌شده' },
  { code: '7105', name: 'هزینهٔ پیامک و ایمیل' },
  { code: '7106', name: 'سایر هزینه‌های مستقیم خدمات' },
  { code: '72', name: 'بهای تمام‌شدهٔ کالای فروش‌رفته' },
  { code: '7201', name: 'بهای تمام‌شدهٔ کالای فروش‌رفته' },

  { code: '8', name: 'هزینه‌ها', rules: PL_OPEX },
  { code: '81', name: 'حقوق و دستمزد', tags: ['OPEX'] },
  { code: '8101', name: 'حقوق و دستمزد' },
  { code: '8102', name: 'اضافه‌کار، پاداش و عیدی' },
  { code: '8103', name: 'بیمهٔ سهم کارفرما' },
  { code: '8104', name: 'مزایای پایان خدمت' },
  { code: '8105', name: 'سایر مزایای کارکنان' },
  { code: '8106', name: 'هزینهٔ پیمانکاران و فریلنسرها' },
  { code: '82', name: 'هزینه‌های اداری و عمومی', tags: ['OPEX'] },
  { code: '8201', name: 'اجارهٔ محل' },
  { code: '8202', name: 'آب، برق، گاز، تلفن و اینترنت' },
  { code: '8203', name: 'ملزومات اداری' },
  { code: '8204', name: 'حمل‌ونقل و ایاب‌وذهاب' },
  { code: '8205', name: 'هزینه‌های حقوقی و مشاوره' },
  { code: '8206', name: 'حسابرسی و خدمات مالی' },
  { code: '8207', name: 'تعمیر و نگهداری' },
  { code: '8208', name: 'عوارض و هزینه‌های ثبتی' },
  { code: '8209', name: 'پذیرایی و آبدارخانه' },
  { code: '8210', name: 'سایر هزینه‌های اداری' },
  { code: '83', name: 'هزینه‌های بازاریابی و فروش', tags: ['OPEX'] },
  { code: '8301', name: 'تبلیغات آنلاین' },
  { code: '8302', name: 'همکاری در فروش (افیلیت)' },
  { code: '8303', name: 'سئو و تولید محتوا' },
  { code: '8304', name: 'رویدادها و حمایت مالی' },
  { code: '8305', name: 'سایر هزینه‌های بازاریابی' },
  { code: '84', name: 'هزینه‌های فناوری و نرم‌افزار', tags: ['OPEX'] },
  { code: '8401', name: 'اشتراک نرم‌افزارها و سرویس‌ها' },
  { code: '8402', name: 'دامنه و گواهی امنیتی' },
  { code: '8403', name: 'ابزارهای توسعه و تست' },
  { code: '85', name: 'هزینهٔ استهلاک', tags: ['OPEX'], rules: [R('BUSINESS'), O('COST_CENTER'), O('FIXED_ASSET')] },
  { code: '8501', name: 'استهلاک دارایی‌های ثابت مشهود' },
  { code: '8502', name: 'استهلاک دارایی‌های نامشهود' },
  { code: '86', name: 'هزینه‌های مالی', tags: ['FINANCE'], rules: [R('BUSINESS'), O('COST_CENTER'), O('LOAN'), O('BANK_ACCOUNT')] },
  { code: '8601', name: 'سود و کارمزد تسهیلات' },
  { code: '8602', name: 'کارمزد خدمات بانکی' },
  { code: '8603', name: 'زیان تسعیر ارز' },
  { code: '8604', name: 'جرائم و خسارت دیرکرد' },
  { code: '87', name: 'سایر هزینه‌ها', tags: ['OTHER_EXPENSE'], rules: [R('BUSINESS'), O('COST_CENTER'), O('INSTRUMENT'), O('PARTY')] },
  { code: '8701', name: 'زیان فروش سرمایه‌گذاری‌ها' },
  { code: '8702', name: 'زیان کاهش ارزش سرمایه‌گذاری‌ها' },
  { code: '8703', name: 'هزینهٔ مطالبات مشکوک‌الوصول' },
  { code: '8704', name: 'زیان فروش دارایی‌های ثابت' },
  { code: '8705', name: 'سایر هزینه‌های غیرعملیاتی' },
  { code: '88', name: 'مالیات بر درآمد', tags: ['TAX'], rules: [R('BUSINESS')] },
  { code: '8801', name: 'هزینهٔ مالیات عملکرد' },

  { code: '9', name: 'حساب‌های انتظامی', rules: [O('PARTY'), O('BUSINESS')] },
  { code: '91', name: 'حساب‌های انتظامی' },
  { code: '9101', name: 'اسناد تضمینی ما نزد دیگران' },
  { code: '9102', name: 'اسناد تضمینی دیگران نزد ما' },
  { code: '92', name: 'طرف حساب‌های انتظامی', normalSide: 'CREDIT' },
  { code: '9201', name: 'طرف اسناد تضمینی ما نزد دیگران', normalSide: 'CREDIT' },
  { code: '9202', name: 'طرف اسناد تضمینی دیگران نزد ما', normalSide: 'CREDIT' },
];

export function categoryForCode(code: string): AccountCategory {
  const g = code[0];
  if (g === '1' || g === '2') return 'ASSET';
  if (g === '3' || g === '4') return 'LIABILITY';
  if (g === '5') return 'EQUITY';
  if (g === '6') return 'REVENUE';
  if (g === '7' || g === '8') return 'EXPENSE';
  return 'MEMO';
}

export function defaultNormalSide(category: AccountCategory): NormalSide {
  return category === 'ASSET' || category === 'EXPENSE' || category === 'MEMO' ? 'DEBIT' : 'CREDIT';
}

export function levelForCode(code: string) {
  return code.length === 1 ? 'GROUP' : code.length === 2 ? 'GL' : 'SUBSIDIARY';
}

/** والد بر اساس پیشوند کد: 1101 → 11 → 1 */
export function parentCode(code: string): string | null {
  if (code.length === 1) return null;
  if (code.length === 2) return code[0];
  return code.slice(0, 2);
}
