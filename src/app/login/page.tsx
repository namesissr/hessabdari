import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { ActionForm } from '@/components/action-form';
import { loginAction } from './actions';

export const metadata = { title: 'ورود' };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect('/');
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-slate-50 to-blue-50 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-white p-7 shadow-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-xl font-bold text-white">ح</div>
          <h1 className="text-lg font-bold">سیستم مالی و حسابداری</h1>
          <p className="mt-1 text-sm text-muted">مجموعه رایانش ابری ایرانیان</p>
        </div>
        <ActionForm action={loginAction} submitLabel="ورود" className="[&>button]:w-full">
          <div>
            <label className="label">ایمیل</label>
            <input name="email" type="email" required dir="ltr" className="input" autoComplete="username" />
          </div>
          <div>
            <label className="label">رمز عبور</label>
            <input name="password" type="password" required dir="ltr" className="input" autoComplete="current-password" />
          </div>
        </ActionForm>
      </div>
    </main>
  );
}
