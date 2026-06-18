// 本地 Prisma 客户端单例（替代 supabase.ts 的 createSupabaseClient / createSupabaseAdminClient）。
// 所有路由通过 prismaClient 访问数据库。
// 兼容点：原代码 createSupabaseClient(token) / createSupabaseAdminClient() 在很多路由里仍被调用，
// utils/supabase.ts 已重新导出为本地伪 supabase 对象，但 db.ts 也提供等价导出以防遗漏。
import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __prismaClient: PrismaClient | undefined;
}

export const prismaClient =
  globalThis.__prismaClient ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.__prismaClient = prismaClient;
}
