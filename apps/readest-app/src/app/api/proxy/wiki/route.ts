// 服务器端 Wikipedia 代理
// 客户端调 /api/proxy/wiki?url=xxx，服务器代理获取内容并返回
// 支持图片等资源的代理缓存
import { NextRequest, NextResponse } from 'next/server';
import { validateUserAndToken } from '@/utils/access';

const ALLOWED_HOSTS = [
  'wikipedia.org',
  'wikimedia.org',
  'wiktionary.org',
  'upload.wikimedia.org',
  'en.wikipedia.org',
  'zh.wikipedia.org',
  'ja.wikipedia.org',
  'en.wiktionary.org',
  'zh.wiktionary.org',
];

const isAllowedHost = (hostname: string): boolean => {
  return ALLOWED_HOSTS.some(h => hostname === h || hostname.endsWith('.' + h));
};

export async function GET(req: NextRequest) {
  const { user, token } = await validateUserAndToken(req.headers.get('authorization'));
  if (!user || !token) return NextResponse.json({ error: 'Not authenticated' }, { status: 403 });

  const targetUrl = req.nextUrl.searchParams.get('url');
  if (!targetUrl) return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });

  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
  }

  if (!isAllowedHost(parsed.hostname)) {
    return NextResponse.json({ error: 'Host not allowed' }, { status: 403 });
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
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('Wiki proxy error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Proxy failed' },
      { status: 502 },
    );
  }
}
