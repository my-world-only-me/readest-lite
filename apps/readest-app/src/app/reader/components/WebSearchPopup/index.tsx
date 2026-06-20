'use client';

// v8.0 WebSearchPopup
//
// 设计要点：
// 1. 引擎分两类
//    - **内置引擎**（Google / Bing / Baidu / Wikipedia）：走服务器代理 `/api/proxy/resource` 或 `/api/proxy/wiki`
//      代理路由要求登录（与翻译/词典代理同策略）。结果 HTML 在沙箱 iframe 内渲染，链接自动改写为代理通道。
//    - **自定义引擎**（用户从设置里添加的）：**不走代理**，点击后直接 `window.open` 到目标 URL。
//      因为用户自添加的引擎域名千差万别，代理白名单无法穷举；强制走代理会让"自定义"失去意义。
//      这也是为什么"翻译/词典代理强制登录"不影响自定义搜索引擎——自定义引擎本身不调代理 API。
//
// 2. 自定义引擎持久化到 localStorage（key: `rl-custom-search-engines`），不入库不同步。
//    理由：搜索引擎是个人偏好，跟阅读配置/批注不同；同步会污染其他设备。
//
// 3. 添加 / 删除自定义引擎的 UI 直接内嵌在弹窗里，无需跳设置页。

import { useState, useRef, useCallback, useEffect } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { getAPIBaseUrl } from '@/services/environment';
import { getAccessToken } from '@/utils/access';
import {
  IoClose, IoOpenOutline, IoExpandOutline, IoContractOutline,
  IoSearchOutline, IoArrowBack, IoArrowForward, IoAdd, IoTrashOutline,
} from 'react-icons/io5';

interface WebSearchPopupProps {
  query: string;
  onClose: () => void;
}

interface SearchEngine {
  id: string;
  name: string;
  urlTemplate: string; // 必须包含 `%WORD%` 占位符
  builtin: boolean;     // true = 走代理；false = window.open 直跳
}

// 内置引擎：走服务器代理（域名必须在 /api/proxy/resource 的 ALLOWED_HOSTS 白名单里）
const BUILTIN_ENGINES: SearchEngine[] = [
  { id: 'builtin:google',    name: 'Google',    urlTemplate: 'https://www.google.com/search?q=%WORD%',    builtin: true },
  { id: 'builtin:bing',      name: 'Bing',      urlTemplate: 'https://www.bing.com/search?q=%WORD%',      builtin: true },
  { id: 'builtin:baidu',     name: 'Baidu',     urlTemplate: 'https://www.baidu.com/s?wd=%WORD%',         builtin: true },
  { id: 'builtin:wikipedia', name: 'Wikipedia', urlTemplate: 'https://en.wikipedia.org/w/index.php?search=%WORD%', builtin: true },
];

const STORAGE_KEY = 'rl-custom-search-engines';

// 把 %WORD% 替换为 URL-encoded query
const substituteUrl = (template: string, q: string): string =>
  template.replace(/%WORD%/gi, encodeURIComponent(q));

// 验证 URL 模板合法性
const isValidTemplate = (template: string): boolean =>
  /^https?:\/\//i.test(template.trim()) && /%WORD%/i.test(template);

// 读取自定义引擎
const loadCustomEngines = (): SearchEngine[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as Array<{ id: string; name: string; urlTemplate: string }>;
    return arr
      .filter((e) => e && e.id && e.name && e.urlTemplate)
      .map((e) => ({ ...e, builtin: false }));
  } catch {
    return [];
  }
};

// 写入自定义引擎
const saveCustomEngines = (engines: SearchEngine[]): void => {
  try {
    const payload = engines.map(({ id, name, urlTemplate }) => ({ id, name, urlTemplate }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // localStorage 配额或被禁用 — 静默失败，本会话仍可用
  }
};

export default function WebSearchPopup({ query: initialQuery, onClose }: WebSearchPopupProps) {
  const _ = useTranslation();
  const [query, setQuery] = useState(initialQuery);
  const [customEngines, setCustomEngines] = useState<SearchEngine[]>([]);
  const [engineId, setEngineId] = useState<string>('builtin:google');
  const [loading, setLoading] = useState(false);
  const [content, setContent] = useState<string>('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // 首次挂载：加载自定义引擎
  useEffect(() => {
    setCustomEngines(loadCustomEngines());
  }, []);

  const allEngines: SearchEngine[] = [...BUILTIN_ENGINES, ...customEngines];
  const currentEngine = allEngines.find((e) => e.id === engineId) ?? BUILTIN_ENGINES[0]!;

  // 内置引擎：走服务器代理；自定义引擎：window.open 直跳
  const search = useCallback(async (q: string, eng: SearchEngine) => {
    if (!q.trim()) return;

    // 自定义引擎：直接新窗口打开，不走代理
    if (!eng.builtin) {
      const targetUrl = substituteUrl(eng.urlTemplate, q);
      window.open(targetUrl, '_blank', 'noopener,noreferrer');
      // 不更新 history，因为内容仍在弹窗里展示
      return;
    }

    // 内置引擎：走代理
    setLoading(true);
    setContent('');
    const searchUrl = substituteUrl(eng.urlTemplate, q);
    try {
      const token = await getAccessToken();
      const proxyPath = eng.id === 'builtin:wikipedia' ? '/proxy/wiki' : '/proxy/resource';
      const proxyUrl = `${getAPIBaseUrl()}${proxyPath}?url=${encodeURIComponent(searchUrl)}`;
      const resp = await fetch(proxyUrl, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (resp.ok) {
        const html = await resp.text();
        // 重写 HTML 中的链接，使其通过代理
        const modifiedHtml = html
          .replace(/href="\/(?!\/)/g, `href="${new URL(searchUrl).origin}/`)
          .replace(/href="(https?:\/\/[^"]+)"/g, (match, url: string) => {
            if (url.startsWith('#')) return match;
            return `href="${getAPIBaseUrl()}/proxy/resource?url=${encodeURIComponent(url)}"`;
          });
        setContent(modifiedHtml);
      } else if (resp.status === 401) {
        setContent(`<html><body style="font-family:sans-serif;padding:2rem"><h2>需要登录</h2><p>翻译和词典代理（含内置搜索引擎）需要登录后使用。请先登录再试。</p></body></html>`);
      } else {
        setContent(`<html><body style="font-family:sans-serif;padding:2rem"><h2>搜索失败: ${resp.status}</h2><p>${eng.name} 可能不允许代理。尝试换个引擎，或使用自定义搜索引擎（直接打开）。</p></body></html>`);
      }
    } catch (err) {
      setContent(`<html><body style="font-family:sans-serif;padding:2rem"><h2>搜索错误</h2><p>${err instanceof Error ? err.message : 'Unknown error'}</p></body></html>`);
    } finally {
      setLoading(false);
    }

    // 更新 history
    setHistory((prev) => [...prev.slice(0, historyIndex + 1), searchUrl]);
    setHistoryIndex((prev) => prev + 1);
  }, [historyIndex]);

  // 首次挂载：用初始 query + 默认引擎搜一次
  useEffect(() => {
    if (initialQuery) {
      void search(initialQuery, BUILTIN_ENGINES[0]!);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearch = () => {
    void search(query, currentEngine);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

  const handleEngineChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newId = e.target.value;
    setEngineId(newId);
    // 切引擎后立即用当前 query 重搜
    const eng = allEngines.find((x) => x.id === newId);
    if (eng) void search(query, eng);
  };

  const goBack = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      const url = history[newIndex];
      if (url) {
        setLoading(true);
        void (async () => {
          try {
            const token = await getAccessToken();
            const resp = await fetch(`${getAPIBaseUrl()}/proxy/resource?url=${encodeURIComponent(url)}`, {
              headers: token ? { Authorization: `Bearer ${token}` } : {},
            });
            const html = await resp.text();
            setContent(html);
          } catch {
            setContent('<html><body>Navigation failed</body></html>');
          } finally {
            setLoading(false);
          }
        })();
      }
    }
  };

  const goForward = () => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      const url = history[newIndex];
      if (url) {
        setLoading(true);
        void (async () => {
          try {
            const token = await getAccessToken();
            const resp = await fetch(`${getAPIBaseUrl()}/proxy/resource?url=${encodeURIComponent(url)}`, {
              headers: token ? { Authorization: `Bearer ${token}` } : {},
            });
            const html = await resp.text();
            setContent(html);
          } catch {
            setContent('<html><body>Navigation failed</body></html>');
          } finally {
            setLoading(false);
          }
        })();
      }
    }
  };

  const openInNewTab = () => {
    const targetUrl = substituteUrl(currentEngine.urlTemplate, query);
    window.open(targetUrl, '_blank', 'noopener,noreferrer');
  };

  // 添加自定义引擎
  const handleAddEngine = () => {
    const name = newName.trim();
    const url = newUrl.trim();
    if (!name || !url) return;
    if (!isValidTemplate(url)) {
      alert(_('URL must start with http:// or https:// and contain %WORD% placeholder'));
      return;
    }
    const newEngine: SearchEngine = {
      id: `custom:${Date.now()}`,
      name,
      urlTemplate: url,
      builtin: false,
    };
    const next = [...customEngines, newEngine];
    setCustomEngines(next);
    saveCustomEngines(next);
    setNewName('');
    setNewUrl('');
    setShowAddForm(false);
    setEngineId(newEngine.id);
  };

  // 删除自定义引擎
  const handleRemoveEngine = (id: string) => {
    const next = customEngines.filter((e) => e.id !== id);
    setCustomEngines(next);
    saveCustomEngines(next);
    if (engineId === id) setEngineId('builtin:google');
  };

  return (
    <div
      className={`fixed z-[100] flex flex-col bg-base-100 shadow-2xl border border-base-300 rounded-lg overflow-hidden ${
        isFullscreen ? 'inset-4' : 'inset-x-4 top-4 bottom-4 sm:inset-x-20 sm:top-20 sm:bottom-20 md:inset-x-40 md:top-24 md:bottom-24'
      }`}
    >
      {/* Header */}
      <div className='flex items-center gap-2 p-2 border-b border-base-300 bg-base-200 flex-wrap'>
        <button
          onClick={goBack}
          disabled={historyIndex <= 0}
          className='btn btn-ghost btn-sm btn-square'
          title={_('Back')}
        >
          <IoArrowBack className='w-4 h-4' />
        </button>
        <button
          onClick={goForward}
          disabled={historyIndex >= history.length - 1}
          className='btn btn-ghost btn-sm btn-square'
          title={_('Forward')}
        >
          <IoArrowForward className='w-4 h-4' />
        </button>

        {/* Search engine selector */}
        <select
          value={engineId}
          onChange={handleEngineChange}
          className='select select-sm select-bordered w-36'
          title={currentEngine.builtin ? _('Built-in engine (proxied)') : _('Custom engine (opens in new tab)')}
        >
          <optgroup label={_('Built-in')}>
            {BUILTIN_ENGINES.map((engine) => (
              <option key={engine.id} value={engine.id}>{engine.name}</option>
            ))}
          </optgroup>
          {customEngines.length > 0 && (
            <optgroup label={_('Custom')}>
              {customEngines.map((engine) => (
                <option key={engine.id} value={engine.id}>{engine.name}</option>
              ))}
            </optgroup>
          )}
        </select>

        {/* Search input */}
        <input
          type='text'
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          className='input input-sm input-bordered flex-1 min-w-[120px]'
          placeholder={_('Search...')}
        />
        <button onClick={handleSearch} className='btn btn-sm btn-primary btn-square'>
          <IoSearchOutline className='w-4 h-4' />
        </button>

        <div className='flex gap-1'>
          <button
            onClick={() => setShowAddForm((v) => !v)}
            className='btn btn-ghost btn-sm btn-square'
            title={_('Add custom search engine')}
          >
            <IoAdd className='w-4 h-4' />
          </button>
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className='btn btn-ghost btn-sm btn-square'
            title={_('Toggle fullscreen')}
          >
            {isFullscreen ? <IoContractOutline className='w-4 h-4' /> : <IoExpandOutline className='w-4 h-4' />}
          </button>
          <button
            onClick={openInNewTab}
            className='btn btn-ghost btn-sm btn-square'
            title={_('Open in new tab')}
          >
            <IoOpenOutline className='w-4 h-4' />
          </button>
          <button
            onClick={onClose}
            className='btn btn-ghost btn-sm btn-square'
            title={_('Close')}
          >
            <IoClose className='w-4 h-4' />
          </button>
        </div>

        {/* 添加自定义引擎表单 */}
        {showAddForm && (
          <div className='w-full flex items-center gap-2 p-2 border-t border-base-300 bg-base-100 flex-wrap'>
            <input
              type='text'
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={_('Engine name (e.g. DuckDuckGo)')}
              className='input input-sm input-bordered w-40'
            />
            <input
              type='text'
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder={_('URL with %WORD% placeholder (e.g. https://duckduckgo.com/?q=%WORD%)')}
              className='input input-sm input-bordered flex-1 min-w-[200px]'
            />
            <button
              onClick={handleAddEngine}
              className='btn btn-sm btn-primary'
              disabled={!newName.trim() || !isValidTemplate(newUrl.trim())}
            >
              {_('Add')}
            </button>
            <button
              onClick={() => setShowAddForm(false)}
              className='btn btn-sm btn-ghost'
            >
              {_('Cancel')}
            </button>
            <span className='text-xs opacity-60 w-full'>
              {_('Custom engines open in a new tab (not proxied). Built-in engines use the server proxy.')}
            </span>
          </div>
        )}

        {/* 自定义引擎管理（删除） */}
        {customEngines.length > 0 && !showAddForm && (
          <div className='w-full flex items-center gap-2 p-1 border-t border-base-300 bg-base-100 flex-wrap'>
            <span className='text-xs opacity-60'>{_('Custom engines:')}</span>
            {customEngines.map((engine) => (
              <span
                key={engine.id}
                className='inline-flex items-center gap-1 px-2 py-1 bg-base-200 rounded text-xs'
              >
                {engine.name}
                <button
                  onClick={() => handleRemoveEngine(engine.id)}
                  className='btn btn-ghost btn-xs btn-square'
                  title={_('Remove')}
                >
                  <IoTrashOutline className='w-3 h-3' />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Content */}
      <div className='flex-1 overflow-hidden relative'>
        {loading && (
          <div className='absolute inset-0 flex items-center justify-center bg-base-100/80 z-10'>
            <span className='loading loading-spinner loading-lg' />
          </div>
        )}
        <iframe
          ref={iframeRef}
          srcDoc={content}
          className='w-full h-full border-0'
          sandbox='allow-scripts allow-same-origin allow-popups'
          title={_('Web Search')}
        />
      </div>
    </div>
  );
}
