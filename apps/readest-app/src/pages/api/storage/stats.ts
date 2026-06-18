// 改造自原 src/pages/api/storage/stats.ts。
// quota 改为无限；byBookHash 走 prisma 聚合。
import type { NextApiRequest, NextApiResponse } from 'next';
import { corsAllMethods, runMiddleware } from '@/utils/cors';
import { validateUserAndToken } from '@/utils/access';
import { prismaClient } from '@/utils/db';

interface StorageStats {
  totalFiles: number; totalSize: number; usage: number; quota: number; usagePercentage: number;
  byBookHash: Array<{ bookHash: string | null; fileCount: number; totalSize: number }>;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await runMiddleware(req, res, corsAllMethods);
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { user, token } = await validateUserAndToken(req.headers['authorization']);
    if (!user || !token) return res.status(403).json({ error: 'Not authenticated' });

    const files = await prismaClient.file.findMany({
      where: { userId: user.id, deletedAt: null },
      select: { fileSize: true, bookHash: true },
    });

    const totalFiles = files.length;
    const totalSize = files.reduce((sum, f) => sum + Number(f.fileSize), 0);
    const usage = totalSize;
    const quota = Number.MAX_SAFE_INTEGER;
    const usagePercentage = 0;

    const grouped = new Map<string | null, { count: number; size: number }>();
    files.forEach((f) => {
      const key = f.bookHash;
      const cur = grouped.get(key) ?? { count: 0, size: 0 };
      grouped.set(key, { count: cur.count + 1, size: cur.size + Number(f.fileSize) });
    });
    const byBookHash = Array.from(grouped.entries())
      .map(([bookHash, s]) => ({ bookHash, fileCount: s.count, totalSize: s.size }))
      .sort((a, b) => b.totalSize - a.totalSize);

    const response: StorageStats = { totalFiles, totalSize, usage, quota, usagePercentage, byBookHash };
    return res.status(200).json(response);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Something went wrong' });
  }
}
