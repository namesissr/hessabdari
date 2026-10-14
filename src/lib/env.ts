function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`متغیر محیطی ${name} تنظیم نشده است`);
  return v;
}

const isProd = process.env.NODE_ENV === 'production';

/**
 * مقادیر حساس با getter خوانده می‌شوند تا فقط هنگام اجرا بررسی شوند؛
 * در زمان build (که هنوز متغیر محیطی وجود ندارد) نباید خطا بدهند.
 */
export const env = {
  isProd,
  get sessionSecret(): string {
    return required('SESSION_SECRET', isProd ? undefined : 'dev-only-insecure-secret-change-me');
  },
  get sessionDays(): number {
    return Number(process.env.SESSION_DAYS ?? 7);
  },
  cookieName: 'hesabdari_session',
  get secureCookie(): boolean {
    return process.env.SECURE_COOKIE ? process.env.SECURE_COOKIE === 'true' : isProd;
  },
};
