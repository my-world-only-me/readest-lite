# 前端改造清单（精确到文件与行）

> 改造原则：**除"删除 Pro 付费体系、移除注册入口"外，任何业务代码、同步逻辑、阅读器内核、UI 交互一律不准修改**。
> 以下所有改动仅删除 Pro/注册相关代码，不重构、不优化、不调整任何其他逻辑。

---

## A. 删除整个目录/文件

| 路径 | 说明 |
|---|---|
| `src/app/api/stripe/check/route.ts` | Stripe 支付校验 |
| `src/app/api/stripe/checkout/route.ts` | Stripe 检出 |
| `src/app/api/stripe/plans/route.ts` | Stripe 方案 |
| `src/app/api/stripe/portal/route.ts` | Stripe 客户门户 |
| `src/app/api/stripe/webhook/route.ts` | Stripe webhook |
| `src/app/api/apple/iap-verify/route.ts` | Apple IAP |
| `src/app/api/google/iap-verify/route.ts` | Google IAP |
| `src/libs/payment/` | 整个 payment 库（stripe + iap + storage） |
| `src/app/user/components/PlanActionButton.tsx` | 升级按钮 |
| `src/app/user/components/PlanCard.tsx` | 方案卡片 |
| `src/app/user/components/PlanIndicators.tsx` | 方案指示 |
| `src/app/user/components/PlanNavigation.tsx` | 方案切换 |
| `src/app/user/components/PlansComparison.tsx` | 方案对比 |
| `src/app/user/components/PurchaseCallToActions.tsx` | 购买 CTA |
| `src/app/user/components/Checkout.tsx` | Stripe embedded checkout |
| `src/app/user/utils/plan.ts` | 方案详情 |
| `src/app/user/subscription/` | 订阅成功页 |
| `src/types/payment.ts` | 支付类型（仅 Pro 用） |

执行命令：
```bash
rm -rf src/app/api/stripe src/app/api/apple src/app/api/google
rm -rf src/libs/payment
rm -f src/app/user/components/{PlanActionButton,PlanCard,PlanIndicators,PlanNavigation,PlansComparison,PurchaseCallToActions,Checkout}.tsx
rm -f src/app/user/utils/plan.ts
rm -rf src/app/user/subscription
rm -f src/types/payment.ts
```

---

## B. 文件内部删除（精确到行）

### B.1 `src/app/library/components/SettingsMenu.tsx`

**删除行 441-444**（"Upgrade to Readest Premium" 菜单项）：
```tsx
// 删除：
      <hr aria-hidden='true' className='border-base-200 my-1' />
      {user && userProfilePlan === 'free' && (
        <MenuItem label={_('Upgrade to Readest Premium')} onClick={handleUpgrade} />
      )}
```
保留：`<hr>` 之后的 Download/About 项。

**删除行 161-164**（`handleUpgrade` 函数）：
```tsx
// 删除：
  const handleUpgrade = () => {
    navigateToProfile(router);
    setIsDropdownOpen?.(false);
  };
```

**保留**：`userProfilePlan` 仍由 `useQuotaStats` 返回，但其值在新系统中恒为 'pro'，不会触发任何分支。

### B.2 `src/components/settings/integrations/SendToReadestForm.tsx`

**删除行 53-54**（`canUseEmailIn` 状态）：
```tsx
// 删除：
  const [userPlan, setUserPlan] = useState<UserPlan | null>(null);
  const canUseEmailIn = userPlan !== null && isEmailInPlan(userPlan);
```

**删除行 71-79**（plan 解析分支，仅保留 API 调用）：
```tsx
// 原代码：
      const token = await getAccessToken();
      const plan: UserPlan = token ? getUserProfilePlan(token) : 'free';
      setUserPlan(plan);
      if (!isEmailInPlan(plan)) {
        setLoading(false);
        return;
      }
// 改为：
      // Pro 体系删除 — 直接加载
```

**删除行 226-253**（升级卡片 UI，把 `!canUseEmailIn ? (...) :` 改为直接渲染表单）：
```tsx
// 原代码：
      ) : !canUseEmailIn ? (
        <div className='card eink-bordered ...'>
          ... 升级卡片 ...
        </div>
      ) : (
        <div className='space-y-6'>
// 改为：
      ) : (
        <div className='space-y-6'>
```

**删除 import**：行 10 的 `getAccessToken, getUserProfilePlan, isEmailInPlan` 改为只保留 `getAccessToken`（如其他地方仍用）。
**删除 import**：行 14 的 `UserPlan` 类型 import。

### B.3 `src/app/auth/page.tsx` — 登录页改造

**整体替换**：原文件 453 行包含 OAuth、Magic Link、Apple Sign-In、社交登录按钮，全部删除。改为只保留邮箱密码表单。

**新文件内容**（约 100 行）：
```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useThemeStore } from '@/store/themeStore';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/utils/supabase';
import { IoArrowBack } from 'react-icons/io5';
import { navigateToLibrary } from '@/utils/nav';

export default function AuthPage() {
  const _ = useTranslation();
  const router = useRouter();
  const { login } = useAuth();
  const { isDarkMode } = useThemeStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (data.session && data.user) {
        login(data.session.access_token, data.session.user as never);
        router.push('/library');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : _('Login failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: '420px', margin: 'auto', padding: '2rem', paddingTop: '4rem' }}>
      <button onClick={() => router.back()} className='btn btn-ghost fixed left-6 top-6 h-8 min-h-8 w-8 p-0'>
        <IoArrowBack className='text-base-content' />
      </button>
      <h1 className='text-2xl font-bold mb-6 text-center'>{_('Sign in to Readest')}</h1>
      <form onSubmit={handleSubmit} className='space-y-4'>
        <div>
          <label className='block text-sm mb-1'>{_('Email')}</label>
          <input
            type='email' value={email} required disabled={loading}
            onChange={(e) => setEmail(e.target.value)}
            className='input input-bordered w-full'
          />
        </div>
        <div>
          <label className='block text-sm mb-1'>{_('Password')}</label>
          <input
            type='password' value={password} required disabled={loading}
            onChange={(e) => setPassword(e.target.value)}
            className='input input-bordered w-full'
          />
        </div>
        {error && <div className='text-sm text-red-500'>{error}</div>}
        <button type='submit' disabled={loading} className='btn btn-primary w-full'>
          {loading ? _('Signing in...') : _('Sign in')}
        </button>
      </form>
      <p className='text-xs text-center mt-6 opacity-60'>
        {_('Contact the administrator if you need an account.')}
      </p>
    </div>
  );
}
```

**删除 import**（原行 1-29）：所有 OAuth、Apple Sign-In、Tauri 相关 import 全部删除。

### B.4 `src/app/auth/callback/page.tsx`

**整体保留**（仍处理 hash 中的 access_token / refresh_token）。无需改动 — supabase-js 已替换为本地实现，`handleAuthCallback` 调用 `supabase.auth.setSession` 仍可工作。

### B.5 `src/app/auth/update/page.tsx` 与 `src/app/auth/recovery/page.tsx`

**保留**（仍可调用 supabase.auth.updateUser，但本地实现返回 403）。或在登录页移除"忘记密码"链接（如有）。**最小化改动：保留文件，用户访问时显示错误提示即可**。

### B.6 `src/app/user/page.tsx`

**删除 import**（原行 1-35 中的 plan/checkout/IAP 相关）：
```tsx
// 删除：
import { useAvailablePlans } from '@/hooks/useAvailablePlans';
import { getPlanDetails } from './utils/plan';
import { purchaseIAPProduct, restoreIAPPurchases } from '@/libs/payment/iap/client';
import { isPurchaseProduct } from '@/libs/payment/iap/utils';
import { createStripeCheckoutSession, redirectToStripeCheckout, createStripePortalSession, redirectToStripePortal, handleStripeCheckoutError } from '@/libs/payment/stripe/client';
import PlansComparison from './components/PlansComparison';
import Checkout from './components/Checkout';
```

**删除组件状态**（约行 50-80 中的 checkoutState、showEmbeddedCheckout 等）。

**删除 JSX**（约行 320-380 中的 `<PlansComparison>` 与 `<Checkout>` 块）。

**保留**：`UserInfo`、`UsageStats`、`AccountActions`、`StorageManager`、`SharedLinksSection`、`SyncPassphraseSection`、`SyncCategoriesSection`。

### B.7 `src/hooks/useQuotaStats.ts`

**整体替换**（简化为返回无限配额）：
```ts
import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { QuotaType, UserPlan } from '@/types/quota';
import { useTranslation } from './useTranslation';

export const useQuotaStats = (briefName = false) => {
  const _ = useTranslation();
  const { token, user } = useAuth();
  const [quotas, setQuotas] = useState<QuotaType[]>([]);
  const [userProfilePlan, setUserProfilePlan] = useState<UserPlan | undefined>(undefined);

  useEffect(() => {
    if (!user || !token) return;
    setUserProfilePlan('pro');
    setQuotas([
      { name: briefName ? _('Storage') : _('Cloud Sync Storage'),
        tooltip: _('Unlimited'), used: 0, total: 1, unit: '' },
      { name: briefName ? _('Translation') : _('Translation Characters'),
        tooltip: _('Unlimited'), used: 0, total: 1, unit: '', resetAt: 0 },
    ]);
  }, [token, user, _, briefName]);

  return { quotas, userProfilePlan };
};
```

### B.8 `src/services/constants.ts`

**修改行 833-845**（DEFAULT_STORAGE_QUOTA / DEFAULT_DAILY_TRANSLATION_QUOTA）：
```ts
// 改为：
export const DEFAULT_STORAGE_QUOTA: UserStorageQuota = {
  free: Number.MAX_SAFE_INTEGER,
  plus: Number.MAX_SAFE_INTEGER,
  pro: Number.MAX_SAFE_INTEGER,
  purchase: Number.MAX_SAFE_INTEGER,
};

export const DEFAULT_DAILY_TRANSLATION_QUOTA: UserDailyTranslationQuota = {
  free: Number.MAX_SAFE_INTEGER,
  plus: Number.MAX_SAFE_INTEGER,
  pro: Number.MAX_SAFE_INTEGER,
  purchase: Number.MAX_SAFE_INTEGER,
};
```

**保留**：`SHARE_MAX_PER_USER = 50`（原版即如此，非 Pro 限制，是反滥用上限，保持不变）。

### B.9 `src/components/Quota.tsx`

**无需改动**（接收 quotas 数组渲染，新数据 `used=0, total=1` 会显示 0% 进度条）。

### B.10 `src/context/AuthContext.tsx`

**整体保留**。`supabase.auth.refreshSession()` / `supabase.auth.onAuthStateChange()` / `supabase.auth.signOut()` 全部由新 `utils/supabase.ts` 的 LocalSupabaseClient 提供等价实现。

### B.11 `src/services/translators/providers/deepl.ts`

**删除行 5, 30-31**（plan 解析）：
```ts
// 原：
import { getSubscriptionPlan, getTranslationQuota } from '@/utils/access';
...
let userPlan: UserPlan = 'free';
if (token) {
  userPlan = getSubscriptionPlan(token);
  headers['Authorization'] = `Bearer ${token}`;
}
// 改为：
if (token) {
  headers['Authorization'] = `Bearer ${token}`;
}
```

**删除行 47-50**（quota 计算）：
```ts
// 原：
const quota = getTranslationQuota(userPlan);
// 删除
```

### B.12 `src/hooks/useTranslator.ts`

**删除行 149 附近的"Upgrade your plan"提示**（改为通用错误）：
```ts
// 原：
'Daily translation quota reached. Upgrade your plan to continue using AI translations.',
// 改为：
'Translation failed. Please try again later.',
```

### B.13 `src/app/auth/page.tsx` 中行 175 的 `getUserProfilePlan` 调用

由于 B.3 整体替换了登录页，此行已不存在。

---

## C. 完全保留的文件（无改动）

- `src/pages/api/sync.ts`（已替换为本地实现，逻辑等价）
- `src/pages/api/sync/{replicas,replica-keys}.ts`
- `src/pages/api/storage/*`（已替换）
- `src/pages/api/send/*`（已替换）
- `src/pages/api/kosync.ts`（透传，无改动）
- `src/pages/api/deepl/translate.ts`（已替换）
- `src/app/api/share/*`（已替换）
- `src/app/api/{ai,tts,metadata,opds,hardcover}/*`（透传，仅 validateUserAndToken 替换）
- `src/app/api/auth/[...path]/route.ts`（新增，Supabase Auth 兼容层）
- `src/utils/{db,localAuth,localStorage,crdt,supabase,access,object}.ts`（新增或替换）
- `src/libs/{sync,shareServer,replicaSyncServer,replicaSchemas}.ts`（保留）
- `src/services/sync/*`（保留，同步客户端逻辑零改动）
- `src/libs/share.ts`（客户端 share API，零改动）
- `src/libs/replicaSyncClient.ts`（零改动）
- `src/components/*`（除 SettingsMenu 与 SendToReadestForm 外，全部保留）
- `src/app/{library,reader,s,o,send,opds,updater,offline,runtime-config.js}/*`（保留）
- `src/middleware.ts`（保留 CORS/COEP）
- `next.config.mjs`（保留）

---

## D. 验证清单

执行完所有改动后，按以下清单验证：

1. `pnpm install && pnpm build-web` 构建无错误
2. 启动后访问 `/auth`，仅显示邮箱密码表单，无社交登录按钮
3. 用 ADMIN_EMAIL/ADMIN_PASSWORD 登录成功
4. 进入 `/library`，设置菜单无"Upgrade to Readest Premium"
5. 进入 `/user`，无方案对比卡片，无 Checkout 组件
6. 上传一本书 → 进入阅读器 → 修改进度 → 刷新页面 → 进度保留
7. 创建分享链接 → 在另一个浏览器打开 → 能看到分享落地页
8. 翻译一段文字 → 不报配额错误
9. Send to Readest 面板无"View plans"升级卡片
10. 同步：设备 A 改笔记 → 设备 B 拉取 → 笔记同步成功
