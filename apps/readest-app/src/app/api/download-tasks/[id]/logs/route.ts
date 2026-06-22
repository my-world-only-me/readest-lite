// v8.9: 获取单个下载任务的完整日志
// GET /api/download-tasks/[id]/logs
// query: ?limit=500&offset=0&level=info|warn|error
import { NextRequest, NextResponse } from 'next/server';
import { validateUserAndToken } from '@/utils/access';
import { prismaClient } from '@/utils/db';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  const { user, token } = await validateUserAndToken(req.headers.get('authorization'));
  if (!user || !token) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const { id } = await params;
  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '500', 10), 2000);
  const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10), 0);
  const level = url.searchParams.get('level'); // info|warn|error|undefined(全部)

  const task = await prismaClient.downloadTask.findUnique({ where: { id } });
  if (!task || task.userId !== user.id) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  }

  const where: { taskId: string; level?: string } = { taskId: id };
  if (level === 'info' || level === 'warn' || level === 'error') {
    where.level = level;
  }

  const [logs, totalCount] = await Promise.all([
    prismaClient.downloadLog.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      take: limit,
      skip: offset,
    }),
    prismaClient.downloadLog.count({ where }),
  ]);

  return NextResponse.json({
    taskId: id,
    logs: logs.map((l) => ({
      id: l.id,
      level: l.level,
      message: l.message,
      createdAt: l.createdAt.toISOString(),
    })),
    totalCount,
    offset,
    limit,
  });
}
