// v8.9: 批量操作
// POST /api/download-tasks/batch
// body: { action: "retry_failed" | "pause_all" | "resume_all" | "clear_completed" | "clear_failed" | "clear_all" }
//   或 { action: "create", urls: string[], cookies?: string, headers?: Record<string,string> }
import { NextRequest, NextResponse } from 'next/server';
import { validateUserAndToken } from '@/utils/access';
import { prismaClient } from '@/utils/db';
import { runDownloadTask } from '@/utils/downloadRunner';
import { sanitizeOutputFilename } from '@/utils/filenameDetect';

const MAX_BATCH_CREATE = 20;

export async function POST(req: NextRequest) {
  const { user, token } = await validateUserAndToken(req.headers.get('authorization'));
  if (!user || !token) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

  const body = await req.json();
  const action = body.action as string;

  // ── 批量创建任务 ─────────────────────────────────────────────────────────
  // v8.10.1: 支持 items 数组（per-URL cookies/headers），向后兼容 urls 数组
  if (action === 'create') {
    // 新格式: items: [{ url, cookies?, headers? }]
    // 旧格式: urls: [string] + 全局 cookies/headers
    interface BatchItem {
      url: string;
      cookies?: string;
      headers?: Record<string, string>;
    }

    let items: BatchItem[] = [];
    if (Array.isArray(body.items)) {
      items = body.items
        .filter((item: unknown): item is BatchItem =>
          typeof item === 'object' && item !== null && typeof (item as BatchItem).url === 'string',
        )
        .map((item: BatchItem) => ({
          url: item.url,
          cookies: typeof item.cookies === 'string' && item.cookies.trim() ? item.cookies.trim() : undefined,
          headers: item.headers && typeof item.headers === 'object' && !Array.isArray(item.headers) ? item.headers : undefined,
        }));
    } else if (Array.isArray(body.urls)) {
      // 向后兼容：urls 数组 + 全局 cookies/headers
      const globalCookies = typeof body.cookies === 'string' && body.cookies.trim() ? body.cookies.trim() : undefined;
      const globalHeaders = body.headers && typeof body.headers === 'object' && !Array.isArray(body.headers)
        ? body.headers as Record<string, string>
        : undefined;
      items = body.urls
        .filter((u: unknown): u is string => typeof u === 'string')
        .map((u: string) => ({
          url: u,
          cookies: globalCookies,
          headers: globalHeaders,
        }));
    }

    if (items.length === 0) {
      return NextResponse.json({ error: 'No URLs provided' }, { status: 400 });
    }
    if (items.length > MAX_BATCH_CREATE) {
      return NextResponse.json(
        { error: `Too many URLs: max ${MAX_BATCH_CREATE}` },
        { status: 400 },
      );
    }

    // 校验所有 URL
    for (const item of items) {
      try {
        const parsed = new URL(item.url.trim());
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          return NextResponse.json({ error: `Only http(s) URLs: ${item.url}` }, { status: 400 });
        }
      } catch {
        return NextResponse.json({ error: `Invalid URL: ${item.url}` }, { status: 400 });
      }
    }

    const created = await Promise.all(items.map(async (item) => {
      const fallbackName = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.epub`;
      const customHeadersJson = item.headers && Object.keys(item.headers).length > 0
        ? JSON.stringify(item.headers)
        : null;
      const cookiesStr = item.cookies || null;
      return prismaClient.downloadTask.create({
        data: {
          userId: user.id,
          url: item.url.trim(),
          originalUrl: item.url.trim(),
          filename: sanitizeOutputFilename(fallbackName),
          status: 'pending',
          cookies: cookiesStr,
          customHeaders: customHeadersJson,
        },
      });
    }));

    // 后台异步执行
    for (const t of created) {
      void runDownloadTask({ taskId: t.id });
    }

    return NextResponse.json({
      ok: true,
      count: created.length,
      tasks: created.map((t) => ({ id: t.id, url: t.url, status: 'pending' })),
    });
  }

  // ── 批量重试 failed ──────────────────────────────────────────────────────
  if (action === 'retry_failed') {
    const failed = await prismaClient.downloadTask.findMany({
      where: { userId: user.id, status: 'failed' },
    });
    await prismaClient.downloadTask.updateMany({
      where: { userId: user.id, status: 'failed' },
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
    // 清旧日志 + 后台重试
    for (const t of failed) {
      await prismaClient.downloadLog.deleteMany({ where: { taskId: t.id } }).catch(() => {});
      void runDownloadTask({ taskId: t.id });
    }
    return NextResponse.json({ ok: true, count: failed.length });
  }

  // ── 批量暂停 ─────────────────────────────────────────────────────────────
  if (action === 'pause_all') {
    const result = await prismaClient.downloadTask.updateMany({
      where: { userId: user.id, status: { in: ['pending', 'in_progress'] } },
      data: { status: 'paused', speedBps: 0, etaSeconds: null },
    });
    return NextResponse.json({ ok: true, count: result.count });
  }

  // ── 批量恢复 ─────────────────────────────────────────────────────────────
  if (action === 'resume_all') {
    const paused = await prismaClient.downloadTask.findMany({
      where: { userId: user.id, status: 'paused' },
    });
    await prismaClient.downloadTask.updateMany({
      where: { userId: user.id, status: 'paused' },
      data: {
        status: 'pending',
        startedAt: null,
        completedAt: null,
        progress: 0,
        downloadedBytes: BigInt(0),
        speedBps: 0,
        etaSeconds: null,
      },
    });
    // 后台重新执行（暂停后已下载字节不保留，从 0 开始重新下载）
    for (const t of paused) {
      void runDownloadTask({ taskId: t.id });
    }
    return NextResponse.json({ ok: true, count: paused.length });
  }

  // ── 清理已完成 ───────────────────────────────────────────────────────────
  if (action === 'clear_completed') {
    const result = await prismaClient.downloadTask.deleteMany({
      where: { userId: user.id, status: 'completed' },
    });
    return NextResponse.json({ ok: true, count: result.count });
  }

  // ── 清理已失败 ───────────────────────────────────────────────────────────
  if (action === 'clear_failed') {
    const result = await prismaClient.downloadTask.deleteMany({
      where: { userId: user.id, status: 'failed' },
    });
    return NextResponse.json({ ok: true, count: result.count });
  }

  // ── 清理所有 ─────────────────────────────────────────────────────────────
  if (action === 'clear_all') {
    const result = await prismaClient.downloadTask.deleteMany({
      where: { userId: user.id },
    });
    return NextResponse.json({ ok: true, count: result.count });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
