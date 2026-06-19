import { stubTranslation as _ } from '@/utils/misc';
import { normalizeToShortLang } from '@/utils/lang';
import { getAPIBaseUrl } from '@/services/environment';
import { getAccessToken } from '@/utils/access';
import { TranslationProvider } from '../types';

// Readest Lite — Google 翻译走服务器代理
// 客户端调 /api/translate/google，服务器代理到 translate.googleapis.com
// 这样国外服务器可以访问 Google，国内客户端通过服务器中转
export const googleProvider: TranslationProvider = {
  name: 'google',
  label: _('Google Translate'),
  translate: async (text: string[], sourceLang: string, targetLang: string): Promise<string[]> => {
    if (!text.length) return [];

    const token = await getAccessToken();
    if (!token) throw new Error('Not authenticated');

    const url = `${getAPIBaseUrl()}/translate/google`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        text,
        sourceLang: normalizeToShortLang(sourceLang).toLowerCase() || 'auto',
        targetLang: normalizeToShortLang(targetLang).toLowerCase(),
      }),
    });

    if (!response.ok) {
      throw new Error(`Google translate proxy failed: ${response.status}`);
    }

    const data = await response.json();
    return data.translations || text;
  },
};
