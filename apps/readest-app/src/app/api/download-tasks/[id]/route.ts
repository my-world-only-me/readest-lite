// v8.9: 单个下载任务操作
// DELETE /api/download-tasks/[id] — 删除任务（同时清理日志）
// POST   /api/download-tasks/[id] — 重试/暂停/恢复 (body: { action: "retry" | "pause" | "resume" })
import { NextRequest, NextResponse } from 'next/server';
import { validateUserAndToken } from '@/utils/access';
import { prismaClient } from '@/utils/db';
import { runDownloadTask } from '@/utils/downloadRunner';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const { user, token } = await validateUserAndToken(req.headers.get('authorization'));
  if (!user || !token) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

  const { id } = await params;
  const task = await prismaClient.downloadTask.findUnique({ where: { id } });
  if (!task || task.userId !== user.id) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  }

  // 删除任务（关联的 DownloadLog 通过 onDelete: Cascade 自动清理）
  await prismaClient.downloadTask.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const { user, token } = await validateUserAndToken(req.headers.get('authorization'));
  if (!user || !token) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const action = body.action as string;

  const task = await prismaClient.downloadTask.findUnique({ where: { id } });
  if (!task || task.userId !== user.id) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  }

  if (action === 'pause') {
    if (task.status !== 'in_progress' && task.status !== 'pending') {
      return NextResponse.json({ error: 'Can only pause pending/in_progress tasks' }, { status: 400 });
    }
    await prismaClient.downloadTask.update({
      where: { id },
      data: { status: 'paused', speedBps: 0, etaSeconds: null },
    });
    return NextResponse.json({ ok: true, status: 'paused' });
  }

  if (action === 'resume' || action === 'retry') {
    // 重置状态 + 清空旧日志（保留任务记录本身）
    await prismaClient.downloadTask.update({
      where: { id },
      data: {
        status: 'pending',
        error: null,
        startedAt: null,
        completedAt: null,
        progress: 0,
        downloadedBytes: BigInt(0),
        totalBytes: null,
        speedBps: 0,
        etaSeconds: null,
      },
    });
    await prismaClient.downloadLog.deleteMany({ where: { taskId: id } });

    // 后台重新执行下载
    void runDownloadTask({ taskId: id });

    return NextResponse.json({ ok: true, status: 'pending' });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
