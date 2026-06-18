// 改造自原 src/app/api/share/[token]/route.ts。
import { NextResponse } from 'next/server';
import { rejectionToHttp, resolveActiveShare } from '@/libs/shareServer';

interface RouteParams { params: Promise<{ token: string }> }

export async function GET(_request: Request, { params }: RouteParams) {
  const { token } = await params;
  const result = await resolveActiveShare(token);
  if (!result.ok) {
    const { status, body } = rejectionToHttp(result.reason);
    return NextResponse.json(body, { status });
  }
  const { share } = result;
  return NextResponse.json(
    {
      title: share.bookTitle, author: share.bookAuthor, format: share.bookFormat,
      size: share.bookSize, expiresAt: share.expiresAt, hasCover: !!share.coverFileKey,
      hasCfi: !!share.cfi, downloadCount: share.downloadCount,
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
