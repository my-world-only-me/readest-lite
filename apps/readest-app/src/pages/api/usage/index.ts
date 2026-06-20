// v8.5: 用户用量查询接口
// GET /api/usage — 返回 storage + translation 用量 + 配额
import { NextApiRequest, NextApiResponse } from 'next';
import { corsAllMethods, runMiddleware } from '@/utils/cors';
import { validateUserAndToken, getActualStorageUsage } from '@/utils/access';
import { prismaClient } from '@/utils/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await runMiddleware(req, res, corsAllMethods);
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { user, token } = await validateUserAndToken(req.headers['authorization']);
  if (!user || !token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const today = new Date().toISOString().split('T')[0]!;
    const usageRows = await prismaClient.usageStat.findMany({
      where: { userId: user.id, usageType: 'translation_chars', usageDate: today },
      select: { increment: true },
    });
    const translationUsed = usageRows.reduce((s, r) => s + r.increment, 0);

    const storageUsed = await getActualStorageUsage(user.id);
    const storageQuotaMB = user.storageQuotaMB ?? 0;
    const translationQuotaKB = user.translationQuotaKB ?? 0;

    return res.status(200).json({
      storage: {
        used: storageUsed,
        quotaBytes: storageQuotaMB > 0 ? storageQuotaMB * 1024 * 1024 : 100 * 1024 * 1024 * 1024 * 1024,
        quotaMB: storageQuotaMB,
        unlimited: storageQuotaMB === 0,
      },
      translation: {
        usedChars: translationUsed,
        quotaChars: translationQuotaKB > 0 ? translationQuotaKB * 1024 : 0,
        quotaKB: translationQuotaKB,
        unlimited: translationQuotaKB === 0,
        resetAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      },
    });
  } catch (error) {
    console.error('Usage query error:', error);
    return res.status(500).json({ error: 'Failed to fetch usage' });
  }
}
