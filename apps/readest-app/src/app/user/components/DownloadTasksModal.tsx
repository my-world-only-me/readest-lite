// v8.10: 全部下载任务 Modal — 当 DownloadTasks 卡片折叠时，点击「查看全部」打开
'use client';

import { useTranslation } from '@/hooks/useTranslation';
import { IoCloseOutline, IoRefresh, IoTrashOutline, IoPlayCircle, IoPauseCircle } from 'react-icons/io5';

// 复用 DownloadTasks.tsx 的接口（不导出避免循环依赖，这里重新声明）
interface DownloadTask {
  id: string;
  url: string;
  filename: string;
  originalFilename?: string | null;
  status: string;
  error: string | null;
  bookHash: string | null;
  fileSize: number | null;
  progress: number;
  downloadedBytes: number;
  totalBytes: number | null;
  speedBps: number;
  etaSeconds: number | null;
  hasCookies: boolean;
  hasCustomHeaders: boolean;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

interface DownloadTasksModalProps {
  tasks: DownloadTask[];
  onClose: () => void;
  onSelectTask: (id: string) => void;
  onAction: (taskId: string, action: string) => Promise<void>;
  onDelete: (taskId: string) => Promise<void>;
  onCopyUrl: (e: React.MouseEvent, url: string) => void;
  getElapsedSeconds: (task: DownloadTask) => number;
}

const statusIcon = (status: string) => {
  switch (status) {
    case 'pending': return '⏳';
    case 'in_progress': return '🔄';
    case 'paused': return '⏸';
    case 'completed': return '✅';
    case 'failed': return '❌';
    default: return '❓';
  }
};

const statusColor = (status: string) => {
  switch (status) {
    case 'completed': return 'text-success';
    case 'failed': return 'text-error';
    case 'in_progress': return 'text-info';
    case 'paused': return 'text-warning';
    default: return 'text-base-content/60';
  }
};

const formatBytes = (bytes: number): string => {
  if (!bytes || bytes < 0) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

const formatSpeed = (bps: number): string => {
  if (!bps || bps < 0) return '-';
  return `${formatBytes(bps)}/s`;
};

const formatDuration = (seconds: number): string => {
  if (!seconds || seconds < 0) return '-';
  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m${Math.floor(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h${Math.floor((seconds % 3600) / 60)}m`;
};

export default function DownloadTasksModal({
  tasks,
  onClose,
  onSelectTask,
  onAction,
  onDelete,
  onCopyUrl,
  getElapsedSeconds,
}: DownloadTasksModalProps) {
  const _ = useTranslation();

  return (
    <div className='fixed inset-0 z-[100] flex items-center justify-center bg-black/60'>
      <div className='bg-base-100 rounded-lg shadow-2xl w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col'>
        {/* Header */}
        <div className='flex items-center justify-between p-4 border-b border-base-200'>
          <h2 className='text-lg font-bold'>
            {_('Download Tasks')} ({tasks.length})
          </h2>
          <button onClick={onClose} className='btn btn-ghost btn-sm btn-square' title={_('Close')}>
            <IoCloseOutline className='w-5 h-5' />
          </button>
        </div>

        {/* List — 完整列表，可滚动 */}
        <div className='flex-1 overflow-y-auto p-3 space-y-2'>
          {tasks.map((task) => {
            const elapsed = getElapsedSeconds(task);
            const isActive = task.status === 'pending' || task.status === 'in_progress';
            const showProgress = task.status === 'in_progress' || task.status === 'paused';
            const wasRenamed = task.originalFilename && task.originalFilename !== task.filename;
            return (
              <div
                key={task.id}
                onClick={() => onSelectTask(task.id)}
                className='flex items-start gap-2 p-2 rounded-lg bg-base-200/50 hover:bg-base-200 cursor-pointer transition'
              >
                <span className='text-lg mt-0.5'>{statusIcon(task.status)}</span>
                <div className='flex-1 min-w-0'>
                  <div className='flex items-center gap-2 flex-wrap'>
                    <span className='font-medium text-sm truncate'>{task.filename}</span>
                    <span className={`text-xs font-semibold ${statusColor(task.status)}`}>
                      {_(task.status)}
                    </span>
                    {wasRenamed && (
                      <span className='badge badge-xs badge-info' title={`${task.originalFilename} → ${task.filename}`}>
                        ↻ {_('renamed')}
                      </span>
                    )}
                    {task.hasCookies && <span className='badge badge-xs badge-warning'>{_('cookie')}</span>}
                    {task.hasCustomHeaders && <span className='badge badge-xs badge-warning'>{_('headers')}</span>}
                  </div>

                  {(showProgress || task.status === 'completed') && (
                    <div className='mt-1'>
                      <progress
                        className='progress progress-primary w-full h-1.5'
                        value={task.progress}
                        max='100'
                      />
                      <div className='flex items-center justify-between text-xs text-base-content/50 mt-0.5'>
                        <span>
                          {formatBytes(task.downloadedBytes)}
                          {task.totalBytes ? ` / ${formatBytes(task.totalBytes)}` : ''}
                          {task.progress > 0 && task.progress < 100 ? ` · ${task.progress}%` : ''}
                        </span>
                        {isActive && (
                          <span>
                            {task.speedBps > 0 ? formatSpeed(task.speedBps) : '—'}
                            {task.etaSeconds !== null && task.etaSeconds > 0 ? ` · ETA ${formatDuration(task.etaSeconds)}` : ''}
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  <div
                    className='text-xs text-base-content/50 truncate cursor-pointer hover:text-base-content/80'
                    onClick={(e) => onCopyUrl(e, task.url)}
                    title={task.url}
                  >
                    {task.url}
                  </div>
                  <div className='text-xs text-base-content/40'>
                    {new Date(task.createdAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}
                    {elapsed > 0 && ` · ⏱ ${formatDuration(elapsed)}`}
                    {task.fileSize && task.status === 'completed' && ` · ${formatBytes(task.fileSize)}`}
                    {task.error && (
                      <span className='text-error'> · {task.error.slice(0, 80)}{task.error.length > 80 ? '...' : ''}</span>
                    )}
                  </div>
                </div>

                <div
                  className='flex items-center gap-1 flex-shrink-0'
                  onClick={(e) => e.stopPropagation()}
                >
                  {task.status === 'failed' && (
                    <button onClick={() => void onAction(task.id, 'retry')} className='btn btn-ghost btn-xs btn-square' title={_('Retry')}>
                      <IoRefresh className='w-3.5 h-3.5' />
                    </button>
                  )}
                  {isActive && (
                    <button onClick={() => void onAction(task.id, 'pause')} className='btn btn-ghost btn-xs btn-square' title={_('Pause')}>
                      <IoPauseCircle className='w-3.5 h-3.5' />
                    </button>
                  )}
                  {task.status === 'paused' && (
                    <button onClick={() => void onAction(task.id, 'resume')} className='btn btn-ghost btn-xs btn-square' title={_('Resume')}>
                      <IoPlayCircle className='w-3.5 h-3.5' />
                    </button>
                  )}
                  <button onClick={() => void onDelete(task.id)} className='btn btn-ghost btn-xs btn-square text-error' title={_('Delete')}>
                    <IoTrashOutline className='w-3.5 h-3.5' />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className='px-4 py-2 border-t border-base-200 text-xs text-base-content/50 text-center'>
          {tasks.length} {_('tasks')}
        </div>
      </div>
    </div>
  );
}
