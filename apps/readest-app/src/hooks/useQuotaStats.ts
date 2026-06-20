import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { QuotaType, UserPlan } from '@/types/quota';
import { useTranslation } from './useTranslation';
import { getAPIBaseUrl } from '@/services/environment';

// v8.5: 配额展示改为真实数据
// - 从 GET /api/usage 拉取 storage + translation 用量
// - storageQuotaMB = 0 显示"无限"
// - 60s 轮询刷新
// ⚠️ 不要用 user?.storageQuotaMB——useAuth 返回的是 Supabase User 类型没有这字段
export const useQuotaStats = (briefName = false) => {
  const _ = useTranslation();
  const { token, user } = useAuth();
  const [quotas, setQuotas] = useState<QuotaType[]>([]);
  const [userProfilePlan, setUserProfilePlan] = useState<UserPlan | undefined>(undefined);

  useEffect(() => {
    if (!user || !token) return;

    let cancelled = false;
    const fetchUsage = async () => {
      try {
        const resp = await fetch(`${getAPIBaseUrl()}/usage`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!resp.ok) return;
        const data = await resp.json() as {
          storage: { used: number; quotaBytes: number; quotaMB: number; unlimited: boolean };
          translation: { usedChars: number; quotaChars: number; quotaKB: number; unlimited: boolean; resetAt: string };
        };
        if (cancelled) return;

        const storageQuota: QuotaType = data.storage.unlimited
          ? {
              name: briefName ? _('Storage') : _('Cloud Sync Storage'),
              tooltip: _('Unlimited storage'),
              used: data.storage.used,
              total: 0,
              unit: 'bytes',
            }
          : {
              name: briefName ? _('Storage') : _('Cloud Sync Storage'),
              tooltip: _(`${data.storage.quotaMB} MB storage quota`),
              used: data.storage.used,
              total: data.storage.quotaBytes,
              unit: 'bytes',
            };

        const resetAt = data.translation.resetAt
          ? new Date(data.translation.resetAt).getTime()
          : Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + 1);

        const translationQuota: QuotaType = data.translation.unlimited
          ? {
              name: briefName ? _('Translation') : _('Translation Characters'),
              tooltip: _('Unlimited translation'),
              used: data.translation.usedChars,
              total: 0,
              unit: 'chars',
              resetAt,
            }
          : {
              name: briefName ? _('Translation') : _('Translation Characters'),
              tooltip: _(`${data.translation.quotaKB} KB daily translation`),
              used: data.translation.usedChars,
              total: data.translation.quotaChars,
              unit: 'chars',
              resetAt,
            };

        setUserProfilePlan('pro');
        setQuotas([storageQuota, translationQuota]);
      } catch (err) {
        console.error('useQuotaStats fetch failed', err);
      }
    };

    void fetchUsage();
    const interval = setInterval(fetchUsage, 60000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, user?.id]);

  return { quotas, userProfilePlan };
};
