// Readest Lite — 翻译用量统计。
// 替代原 Supabase RPC increment_daily_usage / get_current_usage。
// 数据落到 SQLite UsageStat 表（由 prisma 管理）。
// 由于此文件既被客户端 deepl.ts（浏览器侧）又被服务端 deepl/translate.ts 引用，
// 客户端调用改为 no-op（实际统计由服务端 deepl/translate.ts 完成）。
import { prismaClient } from './db';

export const USAGE_TYPES = {
  TRANSLATION_CHARS: 'translation_chars',
} as const;

export const QUOTA_TYPES = {
  DAILY: 'daily',
  MONTHLY: 'monthly',
  YEARLY: 'yearly',
} as const;

// 服务端调用：从 prismaClient 查询/写入 UsageStat 表
// 客户端调用（typeof window !== 'undefined'）：no-op，因为 prismaClient 在客户端不可用
export class UsageStatsManager {
  static async trackUsage(
    userId: string,
    usageType: string,
    increment: number = 1,
    metadata: Record<string, string | number> = {},
  ): Promise<number> {
    if (typeof window !== 'undefined') return 0;
    try {
      const today = new Date().toISOString().split('T')[0]!;
      await prismaClient.usageStat.create({
        data: {
          userId,
          usageType,
          usageDate: today,
          increment,
          metadata: JSON.stringify(metadata),
        },
      });
      return await UsageStatsManager.getCurrentUsage(userId, usageType, 'daily');
    } catch (error) {
      console.error('Usage tracking failed:', error);
      return 0;
    }
  }

  static async getCurrentUsage(
    userId: string,
    usageType: string,
    _period: 'daily' | 'monthly' = 'daily',
  ): Promise<number> {
    if (typeof window !== 'undefined') return 0;
    try {
      const today = new Date().toISOString().split('T')[0]!;
      const rows = await prismaClient.usageStat.findMany({
        where: { userId, usageType, usageDate: today },
        select: { increment: true },
      });
      return rows.reduce((s, r) => s + r.increment, 0);
    } catch (error) {
      console.error('Get current usage failed:', error);
      return 0;
    }
  }
}
