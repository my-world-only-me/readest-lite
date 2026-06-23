// v8.10: 阅读统计聚合 API
// GET /api/stats/aggregate — 返回当前用户的阅读统计
//   - total: { totalTime, booksCount, avgPerDay }
//   - today: { totalTime, booksCount }
//   - week:  { totalTime, booksCount }
//   - books: [{ bookHash, title, authors, totalTime, lastReadAt, page, totalPages, progressPercent }] 按时间降序
//
// 数据源：StatPage 表（每条记录是一次 page-read 事件，含 startTime + duration）
// 时间窗口：
//   - today: startTime >= 今日 0:00 本地时区
//   - week:  startTime >= 本周周一 0:00 本地时区（周一为一周开始）
//   - total: 全部
import { NextRequest, NextResponse } from 'next/server';
import { validateUserAndToken } from '@/utils/access';
import { prismaClient } from '@/utils/db';

// 计算今日 0:00 的 Unix 秒（本地时区）
const todayStartSec = (): number => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.floor(today.getTime() / 1000);
};

// 计算本周周一 0:00 的 Unix 秒（本地时区，周一为一周开始）
const weekStartSec = (): number => {
  const now = new Date();
  const dayOfWeek = now.getDay() === 0 ? 6 : now.getDay() - 1; // 周日=6, 周一=0
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek);
  return Math.floor(monday.getTime() / 1000);
};

// 计算注册日期（用于算 avgPerDay，避免除以 0）
// AuthUser.created_at 是 ISO 字符串
const getUserAgeDays = (createdAt: string): number => {
  const created = new Date(createdAt).getTime();
  if (!Number.isFinite(created)) return 1;
  const ageMs = Date.now() - created;
  return Math.max(1, Math.floor(ageMs / (24 * 60 * 60 * 1000)));
};

export async function GET(req: NextRequest) {
  const { user, token } = await validateUserAndToken(req.headers.get('authorization'));
  if (!user || !token) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    const todayStart = BigInt(todayStartSec());
    const weekStart = BigInt(weekStartSec());

    // 1. 拉取该用户全部 StatPage 记录
    const allPages = await prismaClient.statPage.findMany({
      where: { userId: user.id, deletedAt: null },
      select: {
        bookHash: true,
        startTime: true,
        duration: true,
        page: true,
        totalPages: true,
      },
      orderBy: { startTime: 'asc' },
    });

    // 2. 聚合：今日 / 本周 / 总计 + 每本书时长
    let todayTime = 0;
    let weekTime = 0;
    let totalTime = 0;
    const todayBooks = new Set<string>();
    const weekBooks = new Set<string>();
    const allBooks = new Set<string>();
    const bookTimes = new Map<string, number>();
    const bookLastRead = new Map<string, number>();
    const bookProgress = new Map<string, { page: number; totalPages: number }>();

    for (const p of allPages) {
      const start = Number(p.startTime);
      const dur = p.duration;
      totalTime += dur;
      allBooks.add(p.bookHash);

      // 取每本书的最大页码进度
      const prevProgress = bookProgress.get(p.bookHash);
      if (!prevProgress || p.page > prevProgress.page) {
        bookProgress.set(p.bookHash, { page: p.page, totalPages: p.totalPages });
      }

      // 更新该书最大时间
      const prevLast = bookLastRead.get(p.bookHash);
      if (!prevLast || start > prevLast) {
        bookLastRead.set(p.bookHash, start);
      }

      // 累计该书时长
      bookTimes.set(p.bookHash, (bookTimes.get(p.bookHash) || 0) + dur);

      if (p.startTime >= todayStart) {
        todayTime += dur;
        todayBooks.add(p.bookHash);
      }
      if (p.startTime >= weekStart) {
        weekTime += dur;
        weekBooks.add(p.bookHash);
      }
    }

    // 3. 拉取每本书的 metadata (title/authors)
    const bookHashes = Array.from(allBooks);
    const statBooks = await prismaClient.statBook.findMany({
      where: {
        userId: user.id,
        bookHash: { in: bookHashes },
        deletedAt: null,
      },
      select: { bookHash: true, title: true, authors: true },
    });
    interface BookMeta { title: string; authors: string }
    const bookMeta = new Map<string, BookMeta>(
      statBooks.map((b) => [b.bookHash, { title: b.title, authors: b.authors }]),
    );

    // 4. 组装 books 数组（按时间降序）
    const books = bookHashes
      .map((hash) => {
        const meta = bookMeta.get(hash) ?? { title: '', authors: '' };
        const time = bookTimes.get(hash) || 0;
        const lastRead = bookLastRead.get(hash) || 0;
        const progress = bookProgress.get(hash) || { page: 0, totalPages: 0 };
        return {
          bookHash: hash,
          title: meta.title || 'Unknown',
          authors: meta.authors || '',
          totalTime: time,
          lastReadAt: lastRead > 0 ? new Date(lastRead * 1000).toISOString() : null,
          page: progress.page,
          totalPages: progress.totalPages,
          progressPercent: progress.totalPages > 0
            ? Math.min(100, Math.round((progress.page / progress.totalPages) * 100))
            : 0,
        };
      })
      .sort((a, b) => b.totalTime - a.totalTime);

    // 5. 算 avgPerDay（总时间 / 注册天数）
    const userAgeDays = getUserAgeDays(user.created_at);
    const avgPerDay = Math.round(totalTime / userAgeDays);

    return NextResponse.json({
      total: {
        totalTime,
        booksCount: allBooks.size,
        avgPerDay,
      },
      today: {
        totalTime: todayTime,
        booksCount: todayBooks.size,
      },
      week: {
        totalTime: weekTime,
        booksCount: weekBooks.size,
      },
      books,
    });
  } catch (error) {
    console.error('stats/aggregate failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal error' },
      { status: 500 },
    );
  }
}
