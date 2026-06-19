// 远程书籍下载服务
// 通过服务器代理下载远程 URL 的书籍文件
import { getAPIBaseUrl } from './environment';
import { getAccessToken } from '@/utils/access';

export interface RemoteDownloadResult {
  bookHash: string;
  filename: string;
  fileSize: number;
  fileKey: string;
}

export const downloadBookFromUrl = async (
  url: string,
  filename?: string,
): Promise<RemoteDownloadResult> => {
  const token = await getAccessToken();
  if (!token) throw new Error('Not authenticated');

  const response = await fetch(`${getAPIBaseUrl()}/books/download-url`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ url, filename }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Download failed' }));
    throw new Error(error.error || `Download failed with status ${response.status}`);
  }

  return response.json();
};
