import { getAccessToken } from './access';

export const fetchWithTimeout = (url: string, options: RequestInit = {}, timeout = 10000) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort('Request timed out'), timeout);

  return fetch(url, {
    ...options,
    signal: controller.signal,
  }).finally(() => clearTimeout(id));
};

export const fetchWithAuth = async (url: string, options: RequestInit) => {
  const token = await getAccessToken();
  if (!token) {
    throw new Error('Not authenticated');
  }
  const headers = {
    ...options.headers,
    Authorization: `Bearer ${token}`,
  };

  const response = await fetch(url, { ...options, headers });

  if (!response.ok) {
    // 安全解析错误响应 — 如果不是 JSON（如 HTML 错误页），用 statusText
    let errorMessage = response.statusText || 'Request failed';
    try {
      const errorData = await response.json();
      if (errorData && errorData.error) {
        errorMessage = errorData.error;
      } else if (typeof errorData === 'string') {
        errorMessage = errorData;
      } else if (errorData && errorData.message) {
        errorMessage = errorData.message;
      }
    } catch {
      // response body 不是 JSON，用 statusText
    }
    console.error('Fetch error:', errorMessage, 'URL:', url, 'Status:', response.status);
    throw new Error(errorMessage);
  }

  return response;
};
