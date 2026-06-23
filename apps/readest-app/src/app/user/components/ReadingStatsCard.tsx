'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuth } from '@/context/AuthContext';
import { getAPIBaseUrl } from '@/services/environment';
import { getAccessToken } from '@/utils/access';
import { IoTimeOutline, IoTodayOutline, IoCalendarOutline, IoStatsChartOutline, IoChevronForwardOutline } from 'react-icons/io5';
import ReadingStatsModal from './ReadingStatsModal';

interface StatsData {
  total: { totalTime: number; booksCount: number; avgPerDay: number };
  today: { totalTime: number; booksCount: number };
  week: { totalTime: number; booksCount: number };
  books: Array<{
    bookHash: string;
    title: string;
    authors: string;
    totalTime: number;
    lastReadAt: string | null;
    page: number;
    totalPages: number;
    progressPercent: number;
  }>;
}

// 格式化时长（秒 → "1h 5m" / "45m" / "30s"）
const formatDuration = (seconds: number): string => {
  if (!seconds || seconds < 0) return '0m';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return remM > 0 ? `${h}h ${remM}m` : `${h}h`;
};

export default function ReadingStatsCard() {
  const _ = useTranslation();
  const { user } = useAuth();
  const [data, setData] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  const fetchStats = useCallback(async () => {
    if (!user) return;
    const token = await getAccessToken();
    if (!token) return;
    try {
      const resp = await fetch(`${getAPIBaseUrl()}/stats/aggregate`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (resp.ok) {
        const json = await resp.json();
        setData(json);
      }
    } catch (err) {
      console.error('Failed to fetch reading stats:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void fetchStats();
    // 30 秒轮询（用户可能正在阅读，数据会变）
    const interval = setInterval(() => void fetchStats(), 30_000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  if (loading) {
    return (
      <div className='card bg-base-100 border-base-200 shadow-sm border rounded-lg p-4'>
        <div className='flex items-center gap-2 mb-3'>
          <IoStatsChartOutline className='w-5 h-5' />
          <h3 className='text-lg font-bold'>{_('Reading Statistics')}</h3>
        </div>
        <div className='text-center py-4'>
          <span className='loading loading-spinner loading-md' />
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className='card bg-base-100 border-base-200 shadow-sm border rounded-lg p-4'>
        <div className='flex items-center gap-2 mb-3'>
          <IoStatsChartOutline className='w-5 h-5' />
          <h3 className='text-lg font-bold'>{_('Reading Statistics')}</h3>
        </div>
        <div className='text-center py-4 text-base-content/50'>
          <p>{_('No reading data yet')}</p>
        </div>
      </div>
    );
  }

  // 卡片数据：总时间 / 今日 / 本周 / 日均
  const cards = [
    {
      icon: <IoTimeOutline className='w-4 h-4' />,
      label: _('Total Time'),
      value: formatDuration(data.total.totalTime),
      sub: `${data.total.booksCount} ${_('Books Read')}`,
      color: 'text-primary',
    },
    {
      icon: <IoTodayOutline className='w-4 h-4' />,
      label: _('Today'),
      value: formatDuration(data.today.totalTime),
      sub: `${data.today.booksCount} ${_('Books Today')}`,
      color: 'text-info',
    },
    {
      icon: <IoCalendarOutline className='w-4 h-4' />,
      label: _('This Week'),
      value: formatDuration(data.week.totalTime),
      sub: `${data.week.booksCount} ${_('Books This Week')}`,
      color: 'text-success',
    },
    {
      icon: <IoStatsChartOutline className='w-4 h-4' />,
      label: _('Average per Day'),
      value: formatDuration(data.total.avgPerDay),
      sub: `${data.total.booksCount} ${_('Books Read')}`,
      color: 'text-warning',
    },
  ];

  return (
    <>
      <div
        className='card bg-base-100 border-base-200 shadow-sm border rounded-lg p-4 cursor-pointer hover:shadow-md transition'
        onClick={() => setShowModal(true)}
      >
        <div className='flex items-center justify-between mb-3'>
          <h3 className='text-lg font-bold flex items-center gap-2'>
            <IoStatsChartOutline className='w-5 h-5' />
            {_('Reading Statistics')}
          </h3>
          <IoChevronForwardOutline className='w-4 h-4 text-base-content/40' />
        </div>

        {/* 横向滚动卡片 */}
        <div className='flex gap-3 overflow-x-auto pb-2 -mx-1 px-1'>
          {cards.map((card, idx) => (
            <div
              key={idx}
              className='flex-shrink-0 w-32 bg-base-200/50 rounded-lg p-3'
            >
              <div className={`flex items-center gap-1 text-xs ${card.color} mb-1`}>
                {card.icon}
                <span className='font-medium'>{card.label}</span>
              </div>
              <div className={`text-xl font-bold ${card.color}`}>
                {card.value}
              </div>
              <div className='text-xs text-base-content/50 mt-0.5'>
                {card.sub}
              </div>
            </div>
          ))}
        </div>

        {/* 前 3 本书的迷你榜 */}
        {data.books.length > 0 && (
          <div className='mt-3 border-t border-base-200 pt-2'>
            <div className='text-xs text-base-content/50 mb-1.5'>{_('Book Ranking')}</div>
            <div className='space-y-1'>
              {data.books.slice(0, 3).map((book, idx) => (
                <div key={book.bookHash} className='flex items-center gap-2 text-xs'>
                  <span className='text-base-content/40 w-4'>#{idx + 1}</span>
                  <span className='flex-1 truncate'>{book.title}</span>
                  <span className='text-base-content/60 font-mono'>
                    {formatDuration(book.totalTime)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {showModal && (
        <ReadingStatsModal
          data={data}
          onClose={() => setShowModal(false)}
          onRefresh={() => void fetchStats()}
        />
      )}
    </>
  );
}
