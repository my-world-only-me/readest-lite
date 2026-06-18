// 内部 PUT 端点 — 接收客户端直传的文件字节，写入本地文件系统。
// 替代 R2/S3 预签名 PUT URL 的接收方。
// URL: /api/storage/_put?key=<fileKey>&expires=<epoch>&sig=<hex>
// 流程：校验签名 → 流式写入 BOOKS_DIR/<fileKey>
import type { NextApiRequest, NextApiResponse } from 'next';
import { corsAllMethods, runMiddleware } from '@/utils/cors';
import { verifyPutSig, createWriteStreamForKey, isSafeObjectKeyName } from '@/utils/localStorage';

export const config = { api: { bodyParser: false, responseLimit: false } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await runMiddleware(req, res, corsAllMethods);
  if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });

  const { key, expires, sig } = req.query as { key?: string; expires?: string; sig?: string };
  if (!key || !expires || !sig) return res.status(400).json({ error: 'Missing signature params' });
  if (!isSafeObjectKeyName(key)) return res.status(400).json({ error: 'Invalid fileKey' });

  const exp = parseInt(expires, 10);
  if (!verifyPutSig(key, exp, sig)) return res.status(403).json({ error: 'Invalid or expired signature' });

  try {
    const stream = createWriteStreamForKey(key);
    req.pipe(stream);
    await new Promise<void>((resolve, reject) => {
      stream.on('finish', resolve);
      stream.on('error', reject);
      req.on('error', reject);
    });
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('storage/_put failed:', error);
    return res.status(500).json({ error: 'Could not write file' });
  }
}
