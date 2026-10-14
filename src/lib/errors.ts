/** خطای قابل نمایش به کاربر (پیام فارسی). */
export class AppError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** پیام خطای دیتابیس (trigger) یا AppError را به متن قابل نمایش تبدیل می‌کند. */
export function errorMessage(err: unknown): string {
  if (err instanceof AppError) return err.message;
  const msg = err instanceof Error ? err.message : String(err);
  const m = msg.match(/(LEDGER_[A-Z]+|AUDIT_[A-Z]+): ([^\n"]+)/);
  if (m) return m[2].trim();
  if (msg.includes('Unique constraint')) return 'مقدار تکراری است (کد یا شماره قبلاً ثبت شده).';
  console.error(err);
  return 'خطای غیرمنتظره رخ داد.';
}
