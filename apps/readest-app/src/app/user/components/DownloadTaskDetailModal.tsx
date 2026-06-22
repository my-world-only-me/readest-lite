'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { getAPIBaseUrl } from '@/services/environment';
import { getAccessToken } from '@/utils/access';
import { IoCloseOutline, IoRefreshOutline, IoDocumentTextOutline, IoWarningOutline, IoBugOutline } from 'react-icons/io5';

interface DownloadLog {
  id: string;
  level: string;
  message: string;
  createdAt: string;
}

interface DownloadTaskInfo {
  id: string;
  url: string;
  filename: string;
  originalFilename?: string | null;
  status: string;
  error?: string | null;
  hasCookies?: boolean;
  hasCustomHeaders?: boolean;
  createdAt: string;
}

interface DownloadTaskDetailModalProps {
  taskId: string | null;
  onClose: () => void;
  onTaskChanged?: () => void; // 触发外部刷新
}

type LogLevel = 'all' | 'info' | 'warn' | 'error';

export default function DownloadTaskDetailModal({ taskId, onClose, onTaskChanged }: DownloadTaskDetailModalProps) {
  const _ = useTranslation();
  const [logs, setLogs] = useState<DownloadLog[]>([]);
  const [task, setTask] = useState<DownloadTaskInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [level, setLevel] = useState<LogLevel>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const logContainerRef = useRef<HTMLDivElement>(null);

  const fetchTask = useCallback(async (id: string) => {
    const token = await getAccessToken();
    if (!token) return;
    try {
      const resp = await fetch(`${getAPIBaseUrl()}/download-tasks`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (resp.ok) {
        const data = await resp.json();
        const found = (data.tasks as DownloadTaskInfo[]).find((t) => t.id === id);
        if (found) setTask(found);
      }
    } catch (err) {
      console.error('Failed to fetch task info:', err);
    }
  }, []);

  const fetchLogs = useCallback(async (id: string) => {
    const token = await getAccessToken();
    if (!token) return;
    try {
      const params = new URLSearchParams({ limit: '1000' });
      if (level !== 'all') params.set('level', level);
      const resp = await fetch(
        `${getAPIBaseUrl()}/download-tasks/${id}/logs?${params.toString()}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (resp.ok) {
        const data = await resp.json();
        setLogs(data.logs || []);
      }
    } catch (err) {
      console.error('Failed to fetch logs:', err);
    } finally {
      setLoading(false);
    }
  }, [level]);

  useEffect(() => {
    if (!taskId) return;
    setLoading(true);
    setLogs([]);
    setTask(null);
    void fetchTask(taskId);
    void fetchLogs(taskId);

    // 任务进行中时 2 秒轮询日志
    const interval = setInterval(() => {
      void fetchLogs(taskId);
      void fetchTask(taskId);
    }, 2000);
    return () => clearInterval(interval);
  }, [taskId, fetchLogs, fetchTask]);

  // Auto-scroll to bottom on new logs
  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  // Notify parent when task status changes (so they can refresh list)
  // 注意：故意不把 onTaskChanged 放入 deps，否则父组件每次重渲染传入新函数引用
  // 会导致无限循环（onTaskChanged 变 → useEffect 触发 → 父组件 setState → 父组件重渲染 → 新 onTaskChanged → ...）
  // 我们只想在 task.status 真正变化时通知一次
  const onTaskChangedRef = useRef(onTaskChanged);
  onTaskChangedRef.current = onTaskChanged;
  useEffect(() => {
    if (task) {
      onTaskChangedRef.current?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.status]);

  if (!taskId) return null;

  const logIcon = (lvl: string) => {
    if (lvl === 'error') return <IoBugOutline className='w-3.5 h-3.5 text-error inline flex-shrink-0' />;
    if (lvl === 'warn') return <IoWarningOutline className='w-3.5 h-3.5 text-warning inline flex-shrink-0' />;
    return <IoDocumentTextOutline className='w-3.5 h-3.5 text-info inline flex-shrink-0' />;
  };

  const logColor = (lvl: string) => {
    if (lvl === 'error') return 'text-error';
    if (lvl === 'warn') return 'text-warning';
    return 'text-base-content/80';
  };

  return (
    <div className='fixed inset-0 z-[100] flex items-center justify-center bg-black/60'>
      <div className='bg-base-100 rounded-lg shadow-2xl w-full max-w-3xl mx-4 max-h-[85vh] flex flex-col'>
        {/* Header */}
        <div className='flex items-center justify-between p-4 border-b border-base-200'>
          <div className='flex-1 min-w-0'>
            <h2 className='text-lg font-bold truncate'>
              {task?.filename || _('Download Task')}
            </h2>
            {task && (
              <p className='text-xs text-base-content/50 truncate font-mono'>{task.url}</p>
            )}
          </div>
          <div className='flex items-center gap-2'>
            <button
              onClick={() => { if (taskId) { void fetchTask(taskId); void fetchLogs(taskId); } }}
              className='btn btn-ghost btn-sm btn-square'
              title={_('Refresh')}
            >
              <IoRefreshOutline className='w-4 h-4' />
            </button>
            <button onClick={onClose} className='btn btn-ghost btn-sm btn-square' title={_('Close')}>
              <IoCloseOutline className='w-5 h-5' />
            </button>
          </div>
        </div>

        {/* Task meta */}
        {task && (
          <div className='flex flex-wrap gap-2 px-4 py-2 border-b border-base-200 bg-base-200/30 text-xs'>
            <span className='badge badge-sm badge-ghost'>Status: {task.status}</span>
            {task.originalFilename && task.originalFilename !== task.filename && (
              <span className='badge badge-sm badge-info' title={_('auto-renamed')}>
                ↻ {task.originalFilename} → {task.filename}
              </span>
            )}
            {task.hasCookies && <span className='badge badge-sm badge-warning'>Cookie</span>}
            {task.hasCustomHeaders && <span className='badge badge-sm badge-warning'>Custom Headers</span>}
            {task.error && <span className='badge badge-sm badge-error' title={task.error}>Error</span>}
          </div>
        )}

        {/* Filter row */}
        <div className='flex items-center justify-between px-4 py-2 border-b border-base-200 text-xs'>
          <div className='flex gap-1'>
            {(['all', 'info', 'warn', 'error'] as LogLevel[]).map((l) => (
              <button
                key={l}
                onClick={() => setLevel(l)}
                className={`px-2 py-1 rounded ${level === l ? 'bg-base-200 font-medium' : 'text-base-content/60'}`}
              >
                {l === 'all' ? _('All') : l.toUpperCase()}
              </button>
            ))}
          </div>
          <label className='flex items-center gap-1 text-base-content/60'>
            <input
              type='checkbox'
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className='checkbox checkbox-xs'
            />
            {_('Auto-scroll')}
          </label>
        </div>

        {/* Log content */}
        <div
          ref={logContainerRef}
          className='flex-1 overflow-y-auto p-3 font-mono text-xs bg-base-300/30'
        >
          {loading ? (
            <div className='text-center py-8'>
              <span className='loading loading-spinner loading-md' />
            </div>
          ) : logs.length === 0 ? (
            <div className='text-center py-8 text-base-content/40'>
              <p>{_('No logs yet')}</p>
            </div>
          ) : (
            <div className='space-y-0.5'>
              {logs.map((log) => (
                <div key={log.id} className='flex gap-2 items-start'>
                  <span className='text-base-content/40 flex-shrink-0 w-20'>
                    {new Date(log.createdAt).toLocaleTimeString(undefined, { hour12: false })}
                  </span>
                  <span className='flex-shrink-0 mt-0.5'>{logIcon(log.level)}</span>
                  <span className={`whitespace-pre-wrap break-all ${logColor(log.level)}`}>
                    {log.message}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className='flex items-center justify-between px-4 py-2 border-t border-base-200 text-xs text-base-content/50'>
          <span>{logs.length} {_('logs')}</span>
          <span>{_('Auto-refresh every 2s')}</span>
        </div>
      </div>
    </div>
  );
}
