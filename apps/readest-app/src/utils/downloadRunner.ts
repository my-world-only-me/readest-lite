// v8.9: 下载任务执行器 — 共享给 POST create、retry、batch retry_failed 使用
//
// 功能：
// - 流式下载，实时计算 progress/speed/ETA，每 1 秒 throttle 写库
// - 写 DownloadLog 表（info/warn/error）
// - 支持 cookies + customHeaders（高级选项）
// - 用 filenameDetect 智能识别文件名（Content-Disposition/base64/中文）
// - 写 File + Book 表，更新 task 状态
// - 完整的错误捕获 + 日志记录
import { prismaClient } from '@/utils/db';
import { putObject, isSafeObjectKeyName } from '@/utils/object';
import { createHash } from 'crypto';
import { detectFilename, sanitizeOutputFilename, KNOWN_EXTENSIONS_LIST } from '@/utils/filenameDetect';

const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200MB
const FETCH_TIMEOUT_MS = 180_000; // 3 分钟总超时
const PROGRESS_THROTTLE_MS = 1000; // 1 秒写一次库

type LogLevel = 'info' | 'warn' | 'error';

interface RunnerOptions {
  taskId: string;
}

interface RunResult {
  ok: boolean;
  error?: string;
  bookHash?: string;
  fileSize?: number;
  filename?: string;
}

const log = async (taskId: string, level: LogLevel, message: string) => {
  try {
    await prismaClient.downloadLog.create({
      data: { taskId, level, message: message.slice(0, 4000) },
    });
  } catch (err) {
    // 日志写入失败不能影响主流程
    console.error(`[downloadRunner] Failed to write log for task ${taskId}:`, err);
  }
};

const parseCookies = (raw: string | null | undefined): string | null => {
  if (!raw || !raw.trim()) return null;
  return raw.trim();
};

const parseCustomHeaders = (raw: string | null | undefined): Record<string, string> => {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const result: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string' || typeof v === 'number') {
          result[k] = String(v);
        }
      }
      return result;
    }
  } catch {
    // JSON 解析失败，返回空
  }
  return {};
};

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`;
};

const formatSpeed = (bps: number): string => {
  return `${formatBytes(bps)}/s`;
};

const formatDuration = (seconds: number): string => {
  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m${Math.floor(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h${Math.floor((seconds % 3600) / 60)}m`;
};

export const runDownloadTask = async (opts: RunnerOptions): Promise<RunResult> => {
  const { taskId } = opts;
  const startedAt = new Date();
  let lastProgressUpdate = 0;
  let downloadedBytes = 0;
  let totalBytes: number | null = null;
  let speedSamples: { t: number; bytes: number }[] = [];
  let isPaused = false;

  try {
    // 1. 加载任务
    const task = await prismaClient.downloadTask.findUnique({ where: { id: taskId } });
    if (!task) {
      return { ok: false, error: 'Task not found' };
    }

    await log(taskId, 'info', `开始下载任务: ${task.url}`);
    await log(taskId, 'info', `原始文件名: ${task.filename}`);

    // 2. 标记 in_progress
    await prismaClient.downloadTask.update({
      where: { id: taskId },
      data: {
        status: 'in_progress',
        startedAt,
        progress: 0,
        downloadedBytes: BigInt(0),
        speedBps: 0,
        etaSeconds: null,
        totalBytes: null,
        error: null,
      },
    });

    // 3. 检查是否被暂停
    const current = await prismaClient.downloadTask.findUnique({ where: { id: taskId } });
    if (current?.status === 'paused') {
      await log(taskId, 'warn', '任务在开始前已被暂停');
      isPaused = true;
      return { ok: false, error: 'paused' };
    }

    // 4. 构建请求头
    const headers: Record<string, string> = {
      'User-Agent': 'ReadestLite/1.0 (+https://github.com/cshdotcom/readest-lite)',
      'Accept': '*/*',
      'Accept-Encoding': 'identity', // 避免压缩，便于计算实际字节数
    };

    // 注入 cookies
    const cookies = parseCookies(task.cookies);
    if (cookies) {
      headers['Cookie'] = cookies;
      await log(taskId, 'info', `附加 Cookie: ${cookies.slice(0, 80)}${cookies.length > 80 ? '...' : ''}`);
    }

    // 注入自定义 headers
    const customHeaders = parseCustomHeaders(task.customHeaders);
    for (const [k, v] of Object.entries(customHeaders)) {
      headers[k] = v;
      await log(taskId, 'info', `附加 Header: ${k}: ${v.slice(0, 80)}${v.length > 80 ? '...' : ''}`);
    }

    // 5. 发起 fetch
    await log(taskId, 'info', `发起 HTTP 请求...`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const response = await fetch(task.url, {
      signal: controller.signal,
      headers,
      redirect: 'follow',
    });
    clearTimeout(timeout);

    await log(taskId, 'info', `HTTP ${response.status} ${response.statusText}`);
    await log(taskId, 'info', `响应头 Content-Type: ${response.headers.get('content-type') || 'N/A'}`);
    await log(taskId, 'info', `响应头 Content-Length: ${response.headers.get('content-length') || 'N/A'}`);
    await log(taskId, 'info', `响应头 Content-Disposition: ${response.headers.get('content-disposition') || 'N/A'}`);

    if (!response.ok) {
      const errMsg = `Remote returned ${response.status} ${response.statusText}`;
      await log(taskId, 'error', errMsg);
      throw new Error(errMsg);
    }

    // 6. 智能识别文件名（用 Content-Disposition + Content-Type + URL）
    const detection = detectFilename(task.url, {
      contentDisposition: response.headers.get('content-disposition'),
      contentType: response.headers.get('content-type'),
    });
    await log(taskId, 'info', `文件名识别结果: "${detection.filename}" (来源: ${detection.source})`);

    // 如果识别出来的文件名和原 task.filename 不同，且原文件名是 fallback/乱码 → 用新的
    let finalFilename = task.filename;
    const taskExt = task.filename.split('.').pop()?.toLowerCase() || '';
    if (
      detection.source === 'content-disposition' ||
      (detection.source !== 'fallback' && !KNOWN_EXTENSIONS_LIST.includes(taskExt))
    ) {
      finalFilename = sanitizeOutputFilename(detection.filename);
      await log(taskId, 'info', `采用识别文件名: "${finalFilename}" (原: "${task.filename}")`);
      // 更新 task.filename 以便后续 putObject 用新名字
      await prismaClient.downloadTask.update({
        where: { id: taskId },
        data: {
          filename: finalFilename,
          originalFilename: task.originalFilename || task.filename,
        },
      });
    }

    // 7. 解析总字节数（从 Content-Length）
    const clHeader = response.headers.get('content-length');
    if (clHeader) {
      const parsed = parseInt(clHeader, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        totalBytes = parsed;
        await log(taskId, 'info', `总大小: ${formatBytes(totalBytes)}`);
      }
    }

    // 8. 流式读取响应体，实时统计进度
    if (!response.body) {
      throw new Error('Response body is null');
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    const startTime = Date.now();
    let lastPauseCheck = 0; // 独立于 lastProgressUpdate，确保暂停检查不被进度更新干扰

    // eslint-disable-next-line no-constant-condition
    while (true) {
      // 检查是否被暂停（每 2 秒查一次 DB，独立于进度更新频率）
      const nowForPauseCheck = Date.now();
      if (nowForPauseCheck - lastPauseCheck > 2000) {
        lastPauseCheck = nowForPauseCheck;
        const fresh = await prismaClient.downloadTask.findUnique({ where: { id: taskId } });
        if (fresh?.status === 'paused') {
          isPaused = true;
          await log(taskId, 'warn', '任务被用户暂停');
          break;
        }
      }

      const { done, value } = await reader.read();
      if (done) break;

      if (value) {
        chunks.push(value);
        downloadedBytes += value.length;

        // 计算瞬时速度（最近 5 个样本）
        const now = Date.now();
        speedSamples.push({ t: now, bytes: value.length });
        // 只保留最近 5 秒的样本
        speedSamples = speedSamples.filter((s) => now - s.t < 5000);

        // 每秒写一次进度库
        if (now - lastProgressUpdate > PROGRESS_THROTTLE_MS) {
          lastProgressUpdate = now;
          const recentBytes = speedSamples.reduce((sum, s) => sum + s.bytes, 0);
          const speedBps = speedSamples.length > 0
            ? Math.round(recentBytes / 5) // 5 秒窗口
            : 0;
          const progress = totalBytes
            ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100))
            : 0;
          const etaSeconds = (totalBytes && speedBps > 0)
            ? Math.max(0, Math.round((totalBytes - downloadedBytes) / speedBps))
            : null;

          // 检查文件大小上限
          if (downloadedBytes > MAX_FILE_SIZE) {
            throw new Error(`File too large: ${formatBytes(downloadedBytes)} > ${formatBytes(MAX_FILE_SIZE)}`);
          }

          try {
            await prismaClient.downloadTask.update({
              where: { id: taskId },
              data: {
                progress,
                downloadedBytes: BigInt(downloadedBytes),
                totalBytes: totalBytes !== null ? BigInt(totalBytes) : undefined,
                speedBps,
                etaSeconds,
              },
            });
          } catch (err) {
            // 进度更新失败不影响下载
            console.error(`[downloadRunner] Progress update failed for ${taskId}:`, err);
          }
        }
      }
    }

    if (isPaused) {
      // 暂停状态下保留已下载字节，等恢复
      await prismaClient.downloadTask.update({
        where: { id: taskId },
        data: {
          status: 'paused',
          progress: totalBytes ? Math.round((downloadedBytes / totalBytes) * 100) : 0,
          downloadedBytes: BigInt(downloadedBytes),
          speedBps: 0,
          etaSeconds: null,
        },
      });
      return { ok: false, error: 'paused' };
    }

    if (downloadedBytes === 0) {
      throw new Error('Empty response body');
    }

    await log(taskId, 'info', `下载完成: ${formatBytes(downloadedBytes)} 用时 ${formatDuration((Date.now() - startTime) / 1000)}`);

    // 9. 合并 chunks → buffer
    const buffer = new ArrayBuffer(downloadedBytes);
    const view = new Uint8Array(buffer);
    let offset = 0;
    for (const chunk of chunks) {
      view.set(chunk, offset);
      offset += chunk.length;
    }

    // 10. 计算 hash + 写入存储
    const hash = createHash('md5').update(Buffer.from(buffer)).digest('hex');
    await log(taskId, 'info', `文件 MD5: ${hash}`);

    const fileKey = `${task.userId}/Readest/Books/${hash}/${finalFilename}`;
    if (!isSafeObjectKeyName(fileKey)) {
      throw new Error(`Invalid fileKey generated: ${fileKey}`);
    }
    await log(taskId, 'info', `写入存储: ${fileKey}`);
    await putObject(
      fileKey,
      buffer,
      response.headers.get('content-type') || 'application/octet-stream',
    );

    // 11. 写 File 表
    const existing = await prismaClient.file.findUnique({ where: { fileKey } });
    if (!existing) {
      await prismaClient.file.create({
        data: {
          userId: task.userId,
          bookHash: hash,
          fileKey,
          fileSize: BigInt(downloadedBytes),
        },
      });
      await log(taskId, 'info', `File 记录已创建`);
    } else {
      await log(taskId, 'info', `File 记录已存在，跳过`);
    }

    // 12. 写 Book 表
    const ext = finalFilename.split('.').pop()?.toUpperCase() || '';
    const title = finalFilename.replace(/\.[^.]+$/, '');
    await prismaClient.book.upsert({
      where: { userId_bookHash: { userId: task.userId, bookHash: hash } },
      create: {
        userId: task.userId,
        bookHash: hash,
        title,
        format: ext,
        uploadedAt: new Date(),
        updatedAt: new Date(),
        createdAt: new Date(),
      },
      update: { deletedAt: null, uploadedAt: new Date(), updatedAt: new Date() },
    });
    await log(taskId, 'info', `Book 记录已 upsert: "${title}" (${ext})`);

    // 13. 标记完成
    await prismaClient.downloadTask.update({
      where: { id: taskId },
      data: {
        status: 'completed',
        completedAt: new Date(),
        bookHash: hash,
        fileSize: BigInt(downloadedBytes),
        progress: 100,
        downloadedBytes: BigInt(downloadedBytes),
        totalBytes: BigInt(downloadedBytes),
        speedBps: 0,
        etaSeconds: 0,
      },
    });
    await log(taskId, 'info', `任务完成 ✓`);

    return {
      ok: true,
      bookHash: hash,
      fileSize: downloadedBytes,
      filename: finalFilename,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Unknown error';
    await log(taskId, 'error', `任务失败: ${errMsg}`);
    if (err instanceof Error && err.stack) {
      await log(taskId, 'error', `Stack: ${err.stack.slice(0, 1000)}`);
    }
    try {
      await prismaClient.downloadTask.update({
        where: { id: taskId },
        data: {
          status: 'failed',
          error: errMsg,
          completedAt: new Date(),
          speedBps: 0,
          etaSeconds: null,
        },
      });
    } catch (updateErr) {
      console.error(`[downloadRunner] Failed to mark task ${taskId} as failed:`, updateErr);
    }
    return { ok: false, error: errMsg };
  }
};

// 工具函数导出（供 UI / 测试使用）
export { formatBytes, formatSpeed, formatDuration };
