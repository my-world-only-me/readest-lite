import { useRouter } from 'next/navigation';
import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { deleteUser } from '@/libs/user';
import { eventDispatcher } from '@/utils/event';
import { navigateToLibrary, navigateToResetPassword, navigateToUpdatePassword } from '@/utils/nav';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTransferStore } from '@/store/transferStore';
import {
  DEFAULT_KOSYNC_SETTINGS,
  DEFAULT_READWISE_SETTINGS,
  DEFAULT_HARDCOVER_SETTINGS,
  DEFAULT_WEBDAV_SETTINGS,
} from '@/services/constants';
import { DEFAULT_AI_SETTINGS } from '@/services/ai/constants';

export const useUserActions = () => {
  const router = useRouter();
  const { envConfig } = useEnv();
  const { logout } = useAuth();

  // v8.3.0: 登出时彻底清理当前账号数据，防止跨账号泄露
  // - 清空 library（内存 + 磁盘 library.json）
  // - 重置 sync cursor（lastSyncedAtBooks/Configs/Notes = 0）
  // - 清账号绑定的 settings 字段（WebDAV/KOSync/Readwise/Hardcover/AI/App Lock PIN）
  // - 清 transfer queue（避免上个账号的上传/下载任务继续跑给下个账号）
  // 不删 Books/ 目录下的 <hash>/ 文件夹（文件本体保留，重新登录同账号可复用）
  const handleLogout = async () => {
    try {
      const appService = await envConfig.getAppService();

      // 1. 清空 library（内存 state + 磁盘 library.json）
      //    用 replace: true 覆盖为空数组，防止 merge-floor 保护把书留住
      useLibraryStore.getState().setLibrary([]);
      try {
        await appService.saveLibraryBooks([], { replace: true });
      } catch (err) {
        console.warn('Failed to clear library.json on logout:', err);
      }

      // 2. 清账号绑定的 settings 字段 + 重置 sync cursor
      //    构造新对象（不原地 mutate），避免 replica push subscriber 漏触发
      const { settings, setSettings, saveSettings } = useSettingsStore.getState();
      const clearedSettings = {
        ...settings,
        keepLogin: false,
        // 重置 sync cursor，下次登录走全量 pull
        lastSyncedAtBooks: 0,
        lastSyncedAtConfigs: 0,
        lastSyncedAtNotes: 0,
        // 清账号绑定的第三方服务配置（防止下个账号看到上个账号的凭据）
        kosync: { ...DEFAULT_KOSYNC_SETTINGS },
        readwise: { ...DEFAULT_READWISE_SETTINGS },
        hardcover: { ...DEFAULT_HARDCOVER_SETTINGS },
        webdav: { ...DEFAULT_WEBDAV_SETTINGS },
        aiSettings: { ...DEFAULT_AI_SETTINGS },
        // 清 App Lock PIN（防止下个账号用上个账号的 PIN）
        pinCodeEnabled: false,
        pinCodeHash: undefined,
        pinCodeSalt: undefined,
        // 清 replica 同步状态
        lastSyncedAtReplicas: {},
      };
      setSettings(clearedSettings);
      try {
        await saveSettings(envConfig, clearedSettings);
      } catch (err) {
        console.warn('Failed to save cleared settings on logout:', err);
      }

      // 3. 清 transfer queue（上传/下载队列）
      try {
        useTransferStore.getState().clearAll();
      } catch (err) {
        console.warn('Failed to clear transfer queue on logout:', err);
      }
    } catch (err) {
      console.error('Error during logout cleanup:', err);
    } finally {
      // 4. 最后走原 logout（清 token/user）
      await logout();
      navigateToLibrary(router);
    }
  };

  const handleResetPassword = () => {
    navigateToResetPassword(router);
  };

  const handleUpdateEmail = () => {
    navigateToUpdatePassword(router);
  };

  const handleConfirmDelete = async (errorMessage: string) => {
    try {
      await deleteUser();
      await handleLogout();
    } catch (error) {
      console.error('Error deleting user:', error);
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: errorMessage,
      });
    }
  };

  return {
    handleLogout,
    handleUpdateEmail,
    handleResetPassword,
    handleConfirmDelete,
  };
};
