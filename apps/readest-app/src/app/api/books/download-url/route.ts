// 远程书籍下载 API
// POST /api/books/download-url
// body: { url: string, filename?: string }
// 服务器下载远程书籍文件，存入用户云存储，返回 fileKey
import { NextRequest, NextResponse } from 'next/server';
import { validateUserAndToken } from '@/utils/access';
import { prismaClient } from '@/utils/db';
import { putObject, isSafeObjectKeyName } from '@/utils/object';
import { createHash } from 'crypto';

const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200MB
const ALLOWED_EXTENSIONS = ['epub', 'pdf', 'mobi', 'azw', 'azw3', 'fb2', 'txt', 'zip', 'cbz'];
const FETCH_TIMEOUT = 120000; // 2 分钟

export async function POST(req: NextRequest) {
  const { user, token } = await validateUserAndToken(req.headers.get('authorization'));
  if (!user || !token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const { url, filename } = await req.json();
    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return NextResponse.json({ error: 'Only http(s) URLs are supported' }, { status: 400 });
    }

    // 从 URL 提取文件名
    let bookFilename = filename;
    if (!bookFilename) {
      const urlPath = parsed.pathname.split('/').pop() || 'download.epub';
      bookFilename = decodeURIComponent(urlPath);
    }

    // 验证文件扩展名
    const ext = bookFilename.split('.').pop()?.toLowerCase() || '';
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return NextResponse.json(
        { error: `Unsupported file type: .${ext}. Supported: ${ALLOWED_EXTENSIONS.join(', ')}` },
        { status: 400 },
      );
    }

    // 下载文件
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    let response: Response;
    try {
      response = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'ReadestLite/1.0 (+https://github.com/cshdotcom/readest-lite)' },
        redirect: 'follow',
      });
    } catch (err) {
      clearTimeout(timeout);
      const msg = err instanceof Error ? err.message : 'Download failed';
      return NextResponse.json({ error: `Download failed: ${msg}` }, { status: 502 });
    }
    clearTimeout(timeout);

    if (!response.ok) {
      return NextResponse.json(
        { error: `Remote server returned ${response.status} ${response.statusText}` },
        { status: 502 },
      );
    }

    const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
    if (contentLength > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File too large: ${contentLength} bytes (max ${MAX_FILE_SIZE})` },
        { status: 413 },
      );
    }

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File too large: ${buffer.byteLength} bytes (max ${MAX_FILE_SIZE})` },
        { status: 413 },
      );
    }

    if (buffer.byteLength === 0) {
      return NextResponse.json({ error: 'Downloaded file is empty' }, { status: 400 });
    }

    // 计算 bookHash (MD5)
    const hash = createHash('md5').update(Buffer.from(buffer)).digest('hex');

    // 构造 fileKey
    const fileKey = `${user.id}/Readest/Books/${hash}/${bookFilename}`;
    if (!isSafeObjectKeyName(fileKey)) {
      return NextResponse.json({ error: 'Invalid filename derived from URL' }, { status: 400 });
    }

    // 存入本地文件系统
    await putObject(fileKey, buffer, response.headers.get('content-type') || 'application/octet-stream');

    // 写入数据库
    const existing = await prismaClient.file.findUnique({ where: { fileKey } });
    if (!existing) {
      await prismaClient.file.create({
        data: {
          userId: user.id,
          bookHash: hash,
          fileKey,
          fileSize: BigInt(buffer.byteLength),
        },
      });
    }

    return NextResponse.json({
      bookHash: hash,
      filename: bookFilename,
      fileSize: buffer.byteLength,
      fileKey,
    });
  } catch (error) {
    console.error('Download URL error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal error' },
      { status: 500 },
    );
  }
}
