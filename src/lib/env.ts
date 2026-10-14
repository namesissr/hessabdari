function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`متغیر محیطی ${name} تنظیم نشده است`);
  return v;
}

const isProd = process.env.NODE_ENV === 'production';

export const env = {
  isProd,
  sessionSecret: required('SESSION_SECRET', isProd ? undefined : 'dev-only-insecure-secret-change-me'),
  sessionDays: Number(process.env.SESSION_DAYS ?? 7),
  cookieName: 'hesabdari_session',
  secureCookie: process.env.SECURE_COOKIE ? process.env.SECURE_COOKIE === 'true' : isProd,
};
