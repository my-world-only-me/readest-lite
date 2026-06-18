// 改造自原 src/app/api/share/[token]/download/confirm/route.ts。
// 替代 RPC increment_book_share_download — 用条件 update。
import { NextResponse } from 'next/server';
import { prismaClient } from '@/utils/db';
import { hashShareToken, isValidShareToken } from '@/libs/shareServer';

interface RouteParams { params: Promise<{ token: string }> }

export async function POST(_request: Request, { params }: RouteParams) {
  const { token } = await params;
  if (!isValidShareToken(token)) return new NextResponse(null, { status: 204 });

  const tokenHash = await hashShareToken(token);
  const now = new Date();
  try {
    await prismaClient.bookShare.updateMany({
      where: { tokenHash, revokedAt: null, expiresAt: { gt: now } },
      data: { downloadCount: { increment: 1 } },
    });
  } catch (err) {
    console.error('download confirm failed:', err);
  }
  return new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'private, no-store' } });
}
