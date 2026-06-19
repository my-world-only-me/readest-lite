// 服务器端 Google 翻译代理
// 客户端调 /api/translate/google，服务器代理到 translate.googleapis.com
// 这样国外服务器可以访问 Google，国内客户端通过服务器中转
import { NextRequest, NextResponse } from 'next/server';
import { validateUserAndToken } from '@/utils/access';

export async function POST(req: NextRequest) {
  const { user, token } = await validateUserAndToken(req.headers.get('authorization'));
  if (!user || !token) return NextResponse.json({ error: 'Not authenticated' }, { status: 403 });

  try {
    const { text, sourceLang, targetLang } = await req.json();
    if (!text || !Array.isArray(text)) {
      return NextResponse.json({ error: 'text must be an array' }, { status: 400 });
    }

    const results: string[] = [];
    const sl = sourceLang?.toLowerCase() || 'auto';
    const tl = targetLang?.toLowerCase();

    await Promise.all(text.map(async (line: string, index: number) => {
      if (!line?.trim().length) {
        results[index] = line;
        return;
      }
      const url = new URL('https://translate.googleapis.com/translate_a/single');
      url.searchParams.append('client', 'gtx');
      url.searchParams.append('dt', 't');
      url.searchParams.append('sl', sl);
      url.searchParams.append('tl', tl);
      url.searchParams.append('q', line);

      const resp = await fetch(url.toString(), {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) {
        results[index] = line;
        return;
      }
      const data = await resp.json();
      if (Array.isArray(data) && Array.isArray(data[0])) {
        results[index] = data[0]
          .filter((s: unknown) => Array.isArray(s) && s[0])
          .map((s: unknown[]) => s[0])
          .join('') || line;
      } else {
        results[index] = line;
      }
    }));

    return NextResponse.json({ translations: results });
  } catch (error) {
    console.error('Google translate proxy error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Translation failed' },
      { status: 500 },
    );
  }
}
