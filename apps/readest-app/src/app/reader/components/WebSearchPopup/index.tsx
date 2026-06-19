'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { getAPIBaseUrl } from '@/services/environment';
import { getAccessToken } from '@/utils/access';
import { IoClose, IoOpenOutline, IoExpandOutline, IoContractOutline, IoSearchOutline, IoArrowBack, IoArrowForward } from 'react-icons/io5';

interface WebSearchPopupProps {
  query: string;
  onClose: () => void;
}

const SEARCH_ENGINES = [
  { name: 'Google', url: 'https://www.google.com/search?q=' },
  { name: 'Bing', url: 'https://www.bing.com/search?q=' },
  { name: 'Baidu', url: 'https://www.baidu.com/s?wd=' },
  { name: 'Wikipedia', url: 'https://en.wikipedia.org/w/index.php?search=' },
];

export default function WebSearchPopup({ query: initialQuery, onClose }: WebSearchPopupProps) {
  const _ = useTranslation();
  const [query, setQuery] = useState(initialQuery);
  const [engineIndex, setEngineIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [content, setContent] = useState<string>('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const search = useCallback(async (q: string, engineIdx: number) => {
    if (!q.trim()) return;
    setLoading(true);
    setContent('');
    const engine = SEARCH_ENGINES[engineIdx]!;
    const searchUrl = `${engine.url}${encodeURIComponent(q)}`;

    // 通过服务器代理获取搜索结果
    try {
      const token = await getAccessToken();
      // Wikipedia 用 wiki 代理，其他用通用代理
      const proxyPath = engine.name === 'Wikipedia' ? '/proxy/wiki' : '/proxy/resource';
      // 对于搜索引擎，直接用 iframe srcdoc 方式
      // 但搜索引擎通常不允许被 iframe 嵌入，所以用代理获取 HTML
      const proxyUrl = `${getAPIBaseUrl()}${proxyPath}?url=${encodeURIComponent(searchUrl)}`;
      const resp = await fetch(proxyUrl, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (resp.ok) {
        const html = await resp.text();
        // 重写 HTML 中的链接，使其通过代理
        const modifiedHtml = html
          // 相对链接改为代理链接
          .replace(/href="\/(?!\/)/g, `href="${new URL(searchUrl).origin}/`)
          .replace(/href="(https?:\/\/[^"]+)"/g, (match, url) => {
            // 不代理同页面的锚点
            if (url.startsWith('#')) return match;
            return `href="${getAPIBaseUrl()}/proxy/resource?url=${encodeURIComponent(url)}"`;
          });
        setContent(modifiedHtml);
      } else {
        setContent(`<html><body><h2>Search failed: ${resp.status}</h2><p>${engine.name} may not allow proxying. Try another engine.</p></body></html>`);
      }
    } catch (err) {
      setContent(`<html><body><h2>Search error</h2><p>${err instanceof Error ? err.message : 'Unknown error'}</p></body></html>`);
    } finally {
      setLoading(false);
    }

    // 更新历史
    setHistory(prev => [...prev.slice(0, historyIndex + 1), searchUrl]);
    setHistoryIndex(prev => prev + 1);
  }, [historyIndex]);

  useEffect(() => {
    if (initialQuery) {
      search(initialQuery, engineIndex);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearch = () => {
    search(query, engineIndex);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const goBack = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      const url = history[newIndex];
      if (url) {
        setLoading(true);
        fetch(`${getAPIBaseUrl()}/proxy/resource?url=${encodeURIComponent(url)}`)
          .then(r => r.text())
          .then(html => setContent(html))
          .catch(() => setContent('<html><body>Navigation failed</body></html>'))
          .finally(() => setLoading(false));
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
        fetch(`${getAPIBaseUrl()}/proxy/resource?url=${encodeURIComponent(url)}`)
          .then(r => r.text())
          .then(html => setContent(html))
          .catch(() => setContent('<html><body>Navigation failed</body></html>'))
          .finally(() => setLoading(false));
      }
    }
  };

  const openInNewTab = () => {
    const engine = SEARCH_ENGINES[engineIndex]!;
    window.open(`${engine.url}${encodeURIComponent(query)}`, '_blank');
  };

  return (
    <div className={`fixed z-[100] flex flex-col bg-base-100 shadow-2xl border border-base-300 rounded-lg overflow-hidden ${
      isFullscreen ? 'inset-4' : 'inset-x-4 top-4 bottom-4 sm:inset-x-20 sm:top-20 sm:bottom-20 md:inset-x-40 md:top-24 md:bottom-24'
    }`}>
      {/* Header */}
      <div className='flex items-center gap-2 p-2 border-b border-base-300 bg-base-200'>
        <button onClick={goBack} disabled={historyIndex <= 0} className='btn btn-ghost btn-sm btn-square'>
          <IoArrowBack className='w-4 h-4' />
        </button>
        <button onClick={goForward} disabled={historyIndex >= history.length - 1} className='btn btn-ghost btn-sm btn-square'>
          <IoArrowForward className='w-4 h-4' />
        </button>

        {/* Search engine selector */}
        <select
          value={engineIndex}
          onChange={(e) => setEngineIndex(Number(e.target.value))}
          className='select select-sm select-bordered w-28'
        >
          {SEARCH_ENGINES.map((engine, i) => (
            <option key={engine.name} value={i}>{engine.name}</option>
          ))}
        </select>

        {/* Search input */}
        <input
          type='text'
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          className='input input-sm input-bordered flex-1'
          placeholder={_('Search...')}
        />
        <button onClick={handleSearch} className='btn btn-sm btn-primary btn-square'>
          <IoSearchOutline className='w-4 h-4' />
        </button>

        <div className='flex gap-1'>
          <button onClick={() => setIsFullscreen(!isFullscreen)} className='btn btn-ghost btn-sm btn-square'>
            {isFullscreen ? <IoContractOutline className='w-4 h-4' /> : <IoExpandOutline className='w-4 h-4' />}
          </button>
          <button onClick={openInNewTab} className='btn btn-ghost btn-sm btn-square' title={_('Open in new tab')}>
            <IoOpenOutline className='w-4 h-4' />
          </button>
          <button onClick={onClose} className='btn btn-ghost btn-sm btn-square' title={_('Close')}>
            <IoClose className='w-4 h-4' />
          </button>
        </div>
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
