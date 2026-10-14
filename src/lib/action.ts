import { revalidatePath } from 'next/cache';
import { errorMessage } from './errors';

export type ActionResult = { ok: true; message?: string; redirect?: string; data?: unknown } | { ok: false; error: string };

/** اجرای امن server action: خطاها به پیام فارسی تبدیل می‌شوند */
export async function run(fn: () => Promise<void | Partial<Extract<ActionResult, { ok: true }>>>): Promise<ActionResult> {
  try {
    const r = (await fn()) || {};
    revalidatePath('/', 'layout');
    return { ok: true, ...r };
  } catch (err) {
    if (err && typeof err === 'object' && 'digest' in err && String((err as { digest: string }).digest).startsWith('NEXT_REDIRECT')) throw err;
    return { ok: false, error: errorMessage(err) };
  }
}

export function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? '').trim();
}

export function optStr(fd: FormData, key: string): string | null {
  const v = str(fd, key);
  return v ? v : null;
}
