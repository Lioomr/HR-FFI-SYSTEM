import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  // 1. Check if the user has a token in their cookies
  const token = request.cookies.get('access_token')?.value;
  const { pathname } = request.nextUrl;

  // 2. If NO token, and they are trying to go to a protected page -> Kick to Login
  if (!token && pathname !== '/login') {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // 3. If they HAVE a token, and try to go to Login -> Kick to Dashboard
  if (token && pathname === '/login') {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return NextResponse.next();
}

// Only run this logic on these paths (ignore images, api, etc.)
export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};