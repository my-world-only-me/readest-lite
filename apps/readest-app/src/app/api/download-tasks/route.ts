// v8.9: 远程下载任务 API
// GET  /api/download-tasks — 列出当前用户所有任务（含 progress/speed/eta）
// POST /api/download-tasks — 创建任务（异步下载）
//   body: { url, filename?, cookies?, headers?, batch? }
//     batch: string[] — 一组 URL，每行一个，会创建多个 task
import { NextRequest, NextResponse } from 'next/server';
import { validateUserAndToken } from '@/utils/access';
import { prismaClient } from '@/utils/db';
import { runDownloadTask } from '@/utils/downloadRunner';
import { sanitizeOutputFilename } from '@/utils/filenameDetect';

const MAX_BATCH_SIZE = 20;

// GET — 列出所有任务
export async function GET(req: NextRequest) {
  const { user, token } = await validateUserAndToken(req.headers.get('authorization'));
  if (!user || !token) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const tasks = await prismaClient.downloadTask.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: 200, // 限制返回数避免拉爆
  });

  return NextResponse.json({
    tasks: tasks.map((t) => ({
      id: t.id,
      url: t.url,
      filename: t.filename,
      originalFilename: t.originalFilename,
      status: t.status,
      error: t.error,
      bookHash: t.bookHash,
      fileSize: t.fileSize ? Number(t.fileSize) : null,
      // v8.9: 进度/速度/ETA
      progress: t.progress,
      downloadedBytes: Number(t.downloadedBytes),
      totalBytes: t.totalBytes ? Number(t.totalBytes) : null,
      speedBps: t.speedBps,
      etaSeconds: t.etaSeconds,
      // v8.9: 自定义参数（脱敏后回显给前端）
      hasCookies: !!t.cookies,
      hasCustomHeaders: !!t.customHeaders,
      createdAt: t.createdAt.toISOString(),
      startedAt: t.startedAt?.toISOString() ?? null,
      completedAt: t.completedAt?.toISOString() ?? null,
    })),
  });
}

// POST — 创建下载任务（单个或批量）
export async function POST(req: NextRequest) {
  const { user, token } = await validateUserAndToken(req.headers.get('authorization'));
  if (!user || !token) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { url, filename, cookies, headers, batch } = body as {
      url?: string;
      filename?: string;
      cookies?: string;
      headers?: Record<string, string>;
      batch?: string[];
    };

    // ── 批量模式 ─────────────────────────────────────────────────────────
    if (Array.isArray(batch) && batch.length > 0) {
      if (batch.length > MAX_BATCH_SIZE) {
        return NextResponse.json(
          { error: `Batch too large: max ${MAX_BATCH_SIZE} URLs` },
          { status: 400 },
        );
      }
      const urls = batch
        .map((u) => typeof u === 'string' ? u.trim() : '')
        .filter((u) => u.length > 0);
      if (urls.length === 0) {
        return NextResponse.json({ error: 'No valid URLs in batch' }, { status: 400 });
      }

      // 校验所有 URL
      for (const u of urls) {
        try {
          const parsed = new URL(u);
          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return NextResponse.json(
              { error: `Only http(s) URLs allowed: ${u}` },
              { status: 400 },
            );
          }
        } catch {
          return NextResponse.json({ error: `Invalid URL: ${u}` }, { status: 400 });
        }
      }

      // 序列化自定义参数
      const customHeadersJson = headers && Object.keys(headers).length > 0
        ? JSON.stringify(headers)
        : null;
      const cookiesStr = cookies && cookies.trim() ? cookies.trim() : null;

      // 批量创建任务
      const created = await Promise.all(urls.map(async (u) => {
        // 自动推断文件名（如果用户没指定）
        const fallbackName = filename
          ? sanitizeOutputFilename(filename)
          : `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.epub`;
        return prismaClient.downloadTask.create({
          data: {
            userId: user.id,
            url: u,
            originalUrl: u,
            filename: fallbackName,
            status: 'pending',
            cookies: cookiesStr,
            customHeaders: customHeadersJson,
          },
        });
      }));

      // 后台异步执行（不阻塞响应）
      for (const task of created) {
        void runDownloadTask({ taskId: task.id });
      }

      return NextResponse.json({
        tasks: created.map((t) => ({ id: t.id, url: t.url, status: 'pending' })),
        count: created.length,
      });
    }

    // ── 单任务模式 ───────────────────────────────────────────────────────
    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    let parsed: URL;
    try { parsed = new URL(url); } catch {
      return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return NextResponse.json({ error: 'Only http(s) URLs' }, { status: 400 });
    }

    // v8.9: 文件名允许任意（auto-detect 在下载时做）；如果用户没指定，先用 placeholder
    const initialFilename = filename && filename.trim()
      ? sanitizeOutputFilename(filename)
      : `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.epub`;

    const customHeadersJson = headers && typeof headers === 'object' && Object.keys(headers).length > 0
      ? JSON.stringify(headers)
      : null;
    const cookiesStr = cookies && typeof cookies === 'string' && cookies.trim()
      ? cookies.trim()
      : null;

    // 创建任务记录
    const task = await prismaClient.downloadTask.create({
      data: {
        userId: user.id,
        url,
        originalUrl: url,
        filename: initialFilename,
        status: 'pending',
        cookies: cookiesStr,
        customHeaders: customHeadersJson,
      },
    });

    // 后台异步执行下载（不阻塞响应）
    void runDownloadTask({ taskId: task.id });

    return NextResponse.json({ taskId: task.id, status: 'pending' });
  } catch (error) {
    console.error('download-tasks POST failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal error' },
      { status: 500 },
    );
  }
}
