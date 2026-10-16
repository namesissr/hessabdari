import type { Metadata } from 'next';
import '@fontsource/vazirmatn/400.css';
import '@fontsource/vazirmatn/500.css';
import '@fontsource/vazirmatn/700.css';
import '../globals.css';

export const metadata: Metadata = { title: 'چاپ', robots: { index: false, follow: false } };

/** صفحه‌های چاپ بدون منو و حاشیه */
export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-slate-100 font-sans">{children}</div>;
}
