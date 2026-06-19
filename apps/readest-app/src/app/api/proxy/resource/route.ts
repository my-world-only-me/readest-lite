// 服务器端通用资源代理
// 客户端调 /api/proxy/resource?url=xxx，服务器代理获取任意资源（图片/CSS/JS等）
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
  const { user, token } = await validateUserAndToken(req.headers.get('authorization'));
  if (!user || !token) return NextResponse.json({ error: 'Not authenticated' }, { status: 403 });

  const targetUrl = req.nextUrl.searchParams.get('url');
  if (!targetUrl) return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });

  let parsed: URL;
  try { parsed = new URL(targetUrl); } catch { return NextResponse.json({ error: 'Invalid URL' }, { status: 400 }); }
  if (!isAllowedHost(parsed.hostname)) return NextResponse.json({ error: 'Host not allowed' }, { status: 403 });

  try {
    const resp = await fetch(targetUrl, { headers: { 'User-Agent': 'ReadestLite/1.0' }, signal: AbortSignal.timeout(15000) });
    const contentType = resp.headers.get('content-type') || 'application/octet-stream';
    const buffer = await resp.arrayBuffer();
    return new NextResponse(buffer, { status: resp.status, headers: { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=86400', 'Access-Control-Allow-Origin': '*' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Proxy failed' }, { status: 502 });
  }
}
