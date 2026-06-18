// 替换原 utils/access.ts。
// 所有 Pro/配额判断改为"无限"返回，前端零判断直接开放所有功能。
// 兼容原 access.ts 的所有导出：getSubscriptionPlan / getUserProfilePlan /
// EMAIL_IN_PLANS / isEmailInPlan / STORAGE_QUOTA_GRACE_BYTES /
// getStoragePlanData / getTranslationQuota / getTranslationPlanData /
// getDailyTranslationPlanData / getAccessToken / getUserID / validateUserAndToken
import { verifyAccessToken, type AuthUser } from './localAuth';
import { prismaClient } from './db';
import type { UserPlan } from '@/types/quota';

// 兼容前端类型；plan 在新系统里恒为 'pro'。
export const getSubscriptionPlan = (_token: string): UserPlan => 'pro';
export const getUserProfilePlan = (_token: string): UserPlan => 'pro';

// Pro 体系删除：所有 plan 都视为可使用 email-in。
export const EMAIL_IN_PLANS: readonly UserPlan[] = ['plus', 'pro', 'purchase'];
export const isEmailInPlan = (_plan: UserPlan): boolean => true;

// 配额：原 Pro 体系下 quota=20GB。改造后无限存储。
// 但前端 useQuotaStats 仍会读取 usage/quota 计算 usagePercentage，
// 我们返回一个非常大的 quota 让百分比永远 ~0%，UI 看上去正常。
export const STORAGE_QUOTA_GRACE_BYTES = 10 * 1024 * 1024 * 1024; // 10 GB（已无意义）

export const getStoragePlanData = (token: string) => {
  // 不再读 JWT 中的 storage_usage_bytes；动态查询本地 files 表总和。
  // 为了避免每个调用都查库，这里读 JWT 内的 storage_usage_bytes（已置 0），
  // 真正的配额 enforcement 在 storage/upload 路由里通过 prismaClient 查询。
  void token;
  return {
    plan: 'pro' as UserPlan,
    usage: 0,
    quota: Number.MAX_SAFE_INTEGER, // 无限
  };
};

export const getTranslationQuota = (_plan: UserPlan): number => Number.MAX_SAFE_INTEGER;

export const getTranslationPlanData = (_token: string) => {
  return {
    plan: 'pro' as UserPlan,
    usage: 0,
    quota: Number.MAX_SAFE_INTEGER,
  };
};

export const getDailyTranslationPlanData = (_token: string) => {
  return {
    plan: 'pro' as UserPlan,
    quota: Number.MAX_SAFE_INTEGER,
  };
};

// ───────────────────────────────────────────────────────────────────────────
// 兼容前端 getAccessToken / getUserID
// ───────────────────────────────────────────────────────────────────────────
export const getAccessToken = async (): Promise<string | null> => {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('token') ?? null;
};

export const getUserID = async (): Promise<string | null> => {
  if (typeof window === 'undefined') return null;
  const user = localStorage.getItem('user') ?? '{}';
  try {
    return (JSON.parse(user) as { id?: string }).id ?? null;
  } catch {
    return null;
  }
};

// ───────────────────────────────────────────────────────────────────────────
// 服务端校验（替代原 supabase.auth.getUser）
// 路由侧调用：const { user, token } = await validateUserAndToken(req.headers.get('authorization'))
// ───────────────────────────────────────────────────────────────────────────
export const validateUserAndToken = async (
  authHeader: string | null | undefined,
): Promise<{ user?: AuthUser; token?: string }> => {
  if (!authHeader) return {};
  const token = authHeader.replace(/^Bearer\s+/i, '');
  const user = verifyAccessToken(token);
  if (!user) return {};
  // 单账号模式：仅允许本地存在的用户
  const dbUser = await prismaClient.user.findUnique({ where: { id: user.id } });
  if (!dbUser) return {};
  return { user, token };
};

// 服务端实际查 files 表算真实 usage（供 storage/upload 与 share/import 使用）
export const getActualStorageUsage = async (userId: string): Promise<number> => {
  const agg = await prismaClient.file.aggregate({
    where: { userId, deletedAt: null },
    _sum: { fileSize: true },
  });
  return Number(agg._sum.fileSize ?? 0);
};
