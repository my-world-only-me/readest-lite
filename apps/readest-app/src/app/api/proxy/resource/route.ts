// 服务器端通用资源代理
// 不强制登录
import { NextRequest, NextResponse } from 'next/server';
import { validateUserAndToken } from '@/utils/access';

const ALLOWED_HOSTS = [
  'wikipedia.org', 'wikimedia.org', 'wiktionary.org', 'upload.wikimedia.org',
  'fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net',
  'cdnjs.cloudflare.com', 'db.onlinewebfonts.com', 'translate.googleapis.com',
];

const isAllowedHost = (hostname: string): boolean =>
  ALLOWED_HOSTS.some(h => hostname === h || hostname.endsWith('.' + h));

export async function GET(req: NextRequest) {
  // 可选 auth
  const authHeader = req.headers.get('authorization');
  if (authHeader) {
    const { user, token } = await validateUserAndToken(authHeader);
    if (!user || !token) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
  }

  const targetUrl = req.nextUrl.searchParams.get('url');
  if (!targetUrl) return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });

  let parsed: URL;
  try { parsed = new URL(targetUrl); } catch { return NextResponse.json({ error: 'Invalid URL' }, { status: 400 }); }
  if (!isAllowedHost(parsed.hostname)) return NextResponse.json({ error: 'Host not allowed' }, { status: 403 });

  try {
    const resp = await fetch(targetUrl, {
      headers: { 'User-Agent': 'ReadestLite/1.0' },
      signal: AbortSignal.timeout(15000),
    });
    const contentType = resp.headers.get('content-type') || 'application/octet-stream';
    const buffer = await resp.arrayBuffer();
    return new NextResponse(buffer, {
      status: resp.status,
      headers: { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=86400', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Proxy failed' }, { status: 502 });
  }
}
