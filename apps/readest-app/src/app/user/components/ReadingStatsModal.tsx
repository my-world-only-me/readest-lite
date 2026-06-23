'use client';

import { useState, useMemo } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { IoCloseOutline, IoRefreshOutline, IoSearchOutline, IoArrowUpOutline, IoArrowDownOutline, IoTimeOutline, IoBookOutline } from 'react-icons/io5';

interface BookStat {
  bookHash: string;
  title: string;
  authors: string;
  totalTime: number;
  lastReadAt: string | null;
  page: number;
  totalPages: number;
  progressPercent: number;
}

interface StatsData {
  total: { totalTime: number; booksCount: number; avgPerDay: number };
  today: { totalTime: number; booksCount: number };
  week: { totalTime: number; booksCount: number };
  books: BookStat[];
}

interface ReadingStatsModalProps {
  data: StatsData;
  onClose: () => void;
  onRefresh: () => void;
}

type Tab = 'today' | 'week' | 'total';
type SortOrder = 'desc' | 'asc';

const formatDuration = (seconds: number): string => {
  if (!seconds || seconds < 0) return '0m';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return remM > 0 ? `${h}h ${remM}m` : `${h}h`;
};

// 进度条颜色：根据进度返回渐变 class
const progressGradient = (percent: number): string => {
  if (percent >= 80) return 'from-success to-primary';
  if (percent >= 50) return 'from-info to-success';
  if (percent >= 25) return 'from-warning to-info';
  return 'from-error to-warning';
};

export default function ReadingStatsModal({ data, onClose, onRefresh }: ReadingStatsModalProps) {
  const _ = useTranslation();
  const [tab, setTab] = useState<Tab>('today');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [search, setSearch] = useState('');

  const currentTab = tab === 'today' ? data.today : tab === 'week' ? data.week : data.total;

  // 过滤 + 排序书榜
  const filteredBooks = useMemo(() => {
    let result = data.books;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter((b) =>
        b.title.toLowerCase().includes(q) || b.authors.toLowerCase().includes(q),
      );
    }
    return [...result].sort((a, b) =>
      sortOrder === 'desc' ? b.totalTime - a.totalTime : a.totalTime - b.totalTime,
    );
  }, [data.books, search, sortOrder]);

  // 最大时长（用于进度条相对宽度）
  const maxTime = useMemo(() => {
    return filteredBooks.length > 0 ? Math.max(...filteredBooks.map((b) => b.totalTime)) : 1;
  }, [filteredBooks]);

  return (
    <div className='fixed inset-0 z-[100] flex items-center justify-center bg-black/60'>
      <div className='bg-base-100 rounded-lg shadow-2xl w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col'>
        {/* Header */}
        <div className='flex items-center justify-between p-4 border-b border-base-200'>
          <h2 className='text-lg font-bold'>{_('Reading Statistics')}</h2>
          <div className='flex items-center gap-2'>
            <button
              onClick={onRefresh}
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

        {/* Tabs */}
        <div className='flex gap-1 p-2 bg-base-200/30 border-b border-base-200'>
          {(['today', 'week', 'total'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 px-3 py-2 text-sm rounded-md transition ${
                tab === t ? 'bg-base-100 shadow-sm font-medium' : 'text-base-content/60'
              }`}
            >
              {t === 'today' ? _('Today') : t === 'week' ? _('This Week') : _('All Time')}
            </button>
          ))}
        </div>

        {/* Summary */}
        <div className='p-4 border-b border-base-200'>
          <div className='grid grid-cols-3 gap-3'>
            <div className='text-center'>
              <div className='text-xs text-base-content/50 mb-1 flex items-center justify-center gap-1'>
                <IoTimeOutline className='w-3 h-3' />
                {tab === 'today' ? _('Today') : tab === 'week' ? _('This Week') : _('Total Time')}
              </div>
              <div className='text-xl font-bold text-primary'>
                {formatDuration(currentTab.totalTime)}
              </div>
            </div>
            <div className='text-center'>
              <div className='text-xs text-base-content/50 mb-1 flex items-center justify-center gap-1'>
                <IoBookOutline className='w-3 h-3' />
                {tab === 'today' ? _('Books Today') : tab === 'week' ? _('Books This Week') : _('Books Read')}
              </div>
              <div className='text-xl font-bold text-info'>
                {currentTab.booksCount}
              </div>
            </div>
            <div className='text-center'>
              <div className='text-xs text-base-content/50 mb-1'>
                {_('Average per Day')}
              </div>
              <div className='text-xl font-bold text-success'>
                {formatDuration(data.total.avgPerDay)}
              </div>
            </div>
          </div>
        </div>

        {/* Search + Sort */}
        <div className='flex items-center gap-2 p-3 border-b border-base-200'>
          <div className='flex-1 relative'>
            <IoSearchOutline className='w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-base-content/40' />
            <input
              type='text'
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={_('Search books...')}
              className='input input-bordered input-sm w-full pl-9'
            />
          </div>
          <button
            onClick={() => setSortOrder((s) => s === 'desc' ? 'asc' : 'desc')}
            className='btn btn-ghost btn-sm gap-1'
            title={sortOrder === 'desc' ? _('Sort: High to Low') : _('Sort: Low to High')}
          >
            {sortOrder === 'desc' ? <IoArrowDownOutline className='w-4 h-4' /> : <IoArrowUpOutline className='w-4 h-4' />}
            <span className='text-xs'>{sortOrder === 'desc' ? _('Sort: High to Low') : _('Sort: Low to High')}</span>
          </button>
        </div>

        {/* Book ranking */}
        <div className='flex-1 overflow-y-auto p-3'>
          {filteredBooks.length === 0 ? (
            <div className='text-center py-8 text-base-content/40'>
              <p>{_('No reading data yet')}</p>
            </div>
          ) : (
            <div className='space-y-2'>
              {filteredBooks.map((book, idx) => {
                const widthPercent = maxTime > 0 ? Math.max(5, (book.totalTime / maxTime) * 100) : 0;
                return (
                  <div key={book.bookHash} className='bg-base-200/30 rounded-lg p-3'>
                    <div className='flex items-start gap-3 mb-2'>
                      <span className='text-base-content/40 text-sm font-mono w-6 flex-shrink-0'>
                        #{idx + 1}
                      </span>
                      <div className='flex-1 min-w-0'>
                        <div className='font-medium text-sm truncate'>{book.title}</div>
                        {book.authors && (
                          <div className='text-xs text-base-content/50 truncate'>{book.authors}</div>
                        )}
                      </div>
                      <div className='text-right flex-shrink-0'>
                        <div className='font-mono text-sm font-bold text-primary'>
                          {formatDuration(book.totalTime)}
                        </div>
                        {book.progressPercent > 0 && (
                          <div className='text-xs text-base-content/50'>
                            {book.page}/{book.totalPages} · {book.progressPercent}%
                          </div>
                        )}
                      </div>
                    </div>
                    {/* 渐变进度条 — 相对宽度表示该书在榜中的时长占比 */}
                    <div className='h-2 bg-base-300 rounded-full overflow-hidden'>
                      <div
                        className={`h-full bg-gradient-to-r ${progressGradient(book.progressPercent)} rounded-full transition-all`}
                        style={{ width: `${widthPercent}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className='px-4 py-2 border-t border-base-200 text-xs text-base-content/50 text-center'>
          {filteredBooks.length} {_('books')} · {_('Auto-refresh every 30s')}
        </div>
      </div>
    </div>
  );
}
