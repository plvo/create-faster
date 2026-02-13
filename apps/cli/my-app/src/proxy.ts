import { type NextRequest, NextResponse } from 'next/server';

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  console.log(`PROXY "${pathname}"`);

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Exclude API routes, static files, image optimizations, and .png files
    '/((?!api|_next/static|manifest.webmanifest|_next/image|.*\\.png$).*)',
  ],
};
