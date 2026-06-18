// 改造自原 src/app/api/share/[token]/revoke/route.ts。
import { NextResponse } from 'next/server';
import { prismaClient } from '@/utils/db';
import { validateUserAndToken } from '@/utils/access';
import { hashShareToken, isValidShareToken } from '@/libs/shareServer';

interface RouteParams { params: Promise<{ token: string }> }

export async function POST(request: Request, { params }: RouteParams) {
  const { token } = await params;
  if (!isValidShareToken(token)) return NextResponse.json({ error: 'Invalid share token' }, { status: 400 });

  const { user, token: jwt } = await validateUserAndToken(request.headers.get('authorization'));
  if (!user || !jwt) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const tokenHash = await hashShareToken(token);
  const share = await prismaClient.bookShare.findUnique({ where: { tokenHash }, select: { id: true, userId: true, revokedAt: true } });
  if (!share) return NextResponse.json({ error: 'Share not found' }, { status: 404 });
  if (share.userId !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (share.revokedAt) return new NextResponse(null, { status: 204 });

  await prismaClient.bookShare.update({ where: { id: share.id }, data: { revokedAt: new Date() } });
  return new NextResponse(null, { status: 204 });
}
