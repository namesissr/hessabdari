import { NextResponse, type NextRequest } from 'next/server';

/** محافظ سبک: بدون کوکی نشست → صفحهٔ ورود (اعتبارسنجی کامل در سرور انجام می‌شود) */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith('/login') || pathname.startsWith('/api/health')) return NextResponse.next();
  if (!req.cookies.get('hesabdari_session')) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ['/((?!_next|favicon.ico|.*\.(?:png|svg|ico|woff2?)$).*)'] };
