import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { QuotaType, UserPlan } from '@/types/quota';
import { useTranslation } from './useTranslation';

// Readest Lite — Pro 体系删除后，配额恒为无限。
// 仍保留 hooks 形态以兼容调用方（SettingsMenu / useUserActions 等）。
export const useQuotaStats = (briefName = false) => {
  const _ = useTranslation();
  const { token, user } = useAuth();
  const [quotas, setQuotas] = useState<QuotaType[]>([]);
  const [userProfilePlan, setUserProfilePlan] = useState<UserPlan | undefined>(undefined);

  useEffect(() => {
    if (!user || !token) return;

    // Pro 体系删除 — 永远显示无限配额
    const storageQuota: QuotaType = {
      name: briefName ? _('Storage') : _('Cloud Sync Storage'),
      tooltip: _('Unlimited storage'),
      used: 0,
      total: 1,
      unit: _('Unlimited'),
    };
    const now = new Date();
    const translationResetAt = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
    );
    const translationQuota: QuotaType = {
      name: briefName ? _('Translation') : _('Translation Characters'),
      tooltip: _('Unlimited daily translation'),
      used: 0,
      total: 1,
      unit: _('Unlimited'),
      resetAt: translationResetAt,
    };
    setUserProfilePlan('pro');
    setQuotas([storageQuota, translationQuota]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return {
    quotas,
    userProfilePlan,
  };
};
