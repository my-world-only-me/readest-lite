import { NextRequest, NextResponse } from 'next/server';

// Readest Lite — 简化 CORS：允许所有来源
const corsOptions = {
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

export function middleware(request: NextRequest) {
  const isApi = request.nextUrl.pathname.startsWith('/api/');

  if (isApi) {
    const origin = request.headers.get('origin') ?? '*';

    if (request.method === 'OPTIONS') {
      return new NextResponse(null, {
        status: 200,
        headers: {
          ...corsOptions,
          'Access-Control-Allow-Origin': origin,
        },
      });
    }

    const response = NextResponse.next();
    response.headers.set('Access-Control-Allow-Origin', origin);
    Object.entries(corsOptions).forEach(([key, value]) => {
      response.headers.set(key, value);
    });
    return response;
  }

  // Readest Lite — 使用 credentialless COEP（所有页面）
  // require-corp 会阻止本地字体 CSS 和 Google Fonts 等跨域资源
  // credentialless 允许跨域隔离（SharedArrayBuffer）同时不阻止无 CORP 头的资源
  const response = NextResponse.next();
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  response.headers.set('Cross-Origin-Embedder-Policy', 'credentialless');
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.json).*)'],
};
