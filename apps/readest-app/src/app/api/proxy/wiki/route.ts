// 服务器端 Wikipedia/Wiktionary 代理
// v8.0：强制登录
// v8.5.0：移除白名单 + SSRF 黑名单（与 proxy/resource 一致策略）
import { NextRequest, NextResponse } from 'next/server';
import { validateUserAndToken } from '@/utils/access';

const isPrivateHost = (hostname: string): boolean => {
  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower === '::1' || lower === '[::1]') return true;
  if (lower.startsWith('127.')) return true;
  if (lower.startsWith('10.')) return true;
  if (lower.startsWith('192.168.')) return true;
  if (lower.startsWith('169.254.')) return true;
  if (lower.startsWith('172.')) {
    const parts = lower.split('.');
    const second = parseInt(parts[1]!, 10);
    if (second >= 16 && second <= 31) return true;
  }
  if (lower === 'metadata.google.internal' || lower === '169.254.169.254') return true;
  return false;
};

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const { user, token } = await validateUserAndToken(authHeader);
  if (!user || !token) {
    return NextResponse.json({
      ok: false,
      error: 'Authentication required',
      hint: 'This proxy requires login. Use the in-app feature, or test with: curl -H "Authorization: Bearer YOUR_TOKEN" "https://your-host/api/proxy/wiki?url=https://en.wikipedia.org/api/rest_v1/page/summary/Hello"',
    }, { status: 401 });
  }

  const targetUrl = req.nextUrl.searchParams.get('url');
  if (!targetUrl) {
    return NextResponse.json({
      ok: true,
      message: 'Wikipedia/Wiktionary proxy is up',
      user: user.email,
      usage: 'GET with ?url=<target URL> (any public host allowed, private networks blocked)',
    });
  }

  let parsed: URL;
  try { parsed = new URL(targetUrl); } catch { return NextResponse.json({ error: 'Invalid URL' }, { status: 400 }); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return NextResponse.json({ error: 'Only http(s) URLs are supported' }, { status: 400 });
  }
  if (isPrivateHost(parsed.hostname)) {
    return NextResponse.json({ error: 'Private network addresses are not allowed' }, { status: 403 });
  }

  try {
    const resp = await fetch(targetUrl, {
      headers: { 'User-Agent': 'ReadestLite/1.0 (+https://github.com/cshdotcom/readest-lite)' },
      signal: AbortSignal.timeout(15000),
    });
    const contentType = resp.headers.get('content-type') || 'text/html';
    const buffer = await resp.arrayBuffer();
    return new NextResponse(buffer, {
      status: resp.status,
      headers: { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=3600', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Proxy failed' }, { status: 502 });
  }
}
