// 内部 GET 端点 — 流式返回本地文件，支持 Range。
// 替代 R2/S3 预签名 GET URL 的接收方。
// URL: /api/storage/_get?key=<fileKey>&expires=<epoch>&sig=<hex>&bucket=<optional>
import type { NextApiRequest, NextApiResponse } from 'next';
import { corsAllMethods, runMiddleware } from '@/utils/cors';
import { verifyGetSig, openReadStream, getFileSize, isSafeObjectKeyName } from '@/utils/localStorage';

export const config = { api: { bodyParser: false, responseLimit: false } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await runMiddleware(req, res, corsAllMethods);
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { key, expires, sig, bucket } = req.query as { key?: string; expires?: string; sig?: string; bucket?: string };
  if (!key || !expires || !sig) return res.status(400).json({ error: 'Missing signature params' });
  if (!isSafeObjectKeyName(key)) return res.status(400).json({ error: 'Invalid fileKey' });

  const exp = parseInt(expires, 10);
  if (!verifyGetSig(key, exp, sig, bucket)) return res.status(403).json({ error: 'Invalid or expired signature' });

  try {
    const size = await getFileSize(key, bucket);
    const range = req.headers['range'];
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=600');

    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      if (m) {
        const start = m[1] ? parseInt(m[1], 10) : 0;
        const end = m[2] ? parseInt(m[2], 10) : size - 1;
        if (start > end || end >= size) {
          res.status(416).setHeader('Content-Range', `bytes */${size}`);
          return res.end();
        }
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
        res.setHeader('Content-Length', end - start + 1);
        if (req.method === 'HEAD') return res.end();
        const stream = openReadStream(key, bucket);
        stream.on('open', () => stream.pipe(res));
        stream.on('error', () => res.status(500).end());
        return;
      }
    }

    res.setHeader('Content-Length', size);
    if (req.method === 'HEAD') return res.end();
    const stream = openReadStream(key, bucket);
    stream.on('open', () => stream.pipe(res));
    stream.on('error', () => res.status(500).end());
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return res.status(404).json({ error: 'File not found' });
    console.error('storage/_get failed:', err);
    return res.status(500).json({ error: 'Could not read file' });
  }
}
