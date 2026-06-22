// v8.9: 智能文件名识别 — 处理 URL/Content-Disposition/base64/中文文件名等场景
//
// 用户场景：
// 1. 直接明文下载：https://example.com/books/my-book.epub → "my-book.epub"
// 2. URL 编码的中文：https://example.com/books/%E4%B8%AD%E6%96%87.epub → "中文.epub"
// 3. 带查询参数：https://example.com/download?file=book.epub&token=xyz
//    → 从 Content-Disposition 或 file= query 提取
// 4. Base64 编码：https://example.com/Zm9vYmFyLmVwdWI= → 解码尝试 "foobar.epub"
// 5. 完全无扩展名/乱码：https://example.com/d/a1b2c3d4 → 用 Content-Type 推断扩展名
// 6. 各种奇怪匹配符：book.epub?file=abc → "book.epub"
//
// 优先级：Content-Disposition > URL path > URL query file= > base64 decode > fallback

const KNOWN_EXTENSIONS = [
  'epub', 'pdf', 'mobi', 'azw', 'azw3', 'fb2', 'txt', 'zip', 'cbz',
];

interface DetectOptions {
  // HTTP 响应头（可选）
  contentDisposition?: string | null;
  contentType?: string | null;
}

interface DetectResult {
  filename: string;
  ext: string;
  source: 'content-disposition' | 'url-path' | 'url-query' | 'base64' | 'content-type' | 'fallback';
}

// 从 Content-Disposition header 提取 filename
// 支持：attachment; filename="book.epub"
//       attachment; filename*=UTF-8''%E4%B8%AD%E6%96%87.epub
const parseContentDisposition = (cd: string): string | null => {
  if (!cd) return null;
  // 优先 filename*= (RFC 5987)
  const starMatch = cd.match(/filename\*\s*=\s*(?:UTF-8''|utf-8'')([^;]+)/i);
  if (starMatch) {
    try {
      return decodeURIComponent(starMatch[1].trim().replace(/['"]/g, ''));
    } catch {
      // 解码失败，fall through
    }
  }
  // 普通 filename="..."
  const plainMatch = cd.match(/filename\s*=\s*"?([^";]+)"?/i);
  if (plainMatch) {
    return plainMatch[1].trim();
  }
  return null;
};

// 从 Content-Type 推断扩展名
const extFromContentType = (ct: string | null | undefined): string => {
  if (!ct) return '';
  const mime = ct.toLowerCase().split(';')[0].trim();
  const map: Record<string, string> = {
    'application/epub+zip': 'epub',
    'application/pdf': 'pdf',
    'application/x-mobipocket-ebook': 'mobi',
    'application/vnd.amazon.ebook': 'azw',
    'application/x-fictionbook+xml': 'fb2',
    'application/x-fictionbook': 'fb2',
    'text/plain': 'txt',
    'application/zip': 'zip',
    'application/x-cbz': 'cbz',
    'application/octet-stream': '', // 通用二进制，无法推断
  };
  return map[mime] || '';
};

// 尝试 base64 解码（仅当字符串看起来像 base64 时）
const tryBase64Decode = (s: string): string | null => {
  // base64 字符集 + 长度 % 4 == 0 + 长度 >= 8（避免误判短字符串）
  if (!s || s.length < 8 || s.length % 4 !== 0) return null;
  if (!/^[A-Za-z0-9+/=]+$/.test(s)) return null;
  // 必须包含至少一个非字母数字字符（避免把 "abcdefgh" 当 base64）
  if (!/[+/=]/.test(s) && s.length < 16) return null;
  try {
    const decoded = Buffer.from(s, 'base64').toString('utf8');
    // 检查解码结果是否像文件名（无控制字符 + 包含 . 或常见字符）
    if (!decoded || /[\x00-\x1f]/.test(decoded)) return null;
    // 必须包含点号或字母数字（避免解码出二进制垃圾）
    if (!/[a-zA-Z0-9]/.test(decoded)) return null;
    return decoded;
  } catch {
    return null;
  }
};

// 清理文件名：去掉查询串、fragment、奇怪匹配符
const sanitizeFilename = (raw: string): string => {
  let s = raw.trim();
  // 去掉 fragment (#...)
  const hashIdx = s.indexOf('#');
  if (hashIdx >= 0) s = s.slice(0, hashIdx);
  // 去掉 query (?...)
  const qIdx = s.indexOf('?');
  if (qIdx >= 0) s = s.slice(0, qIdx);
  // URL 解码（中文 %E4%B8%AD）
  try {
    const decoded = decodeURIComponent(s);
    if (decoded && !/[\x00-\x1f]/.test(decoded)) s = decoded;
  } catch {
    // 解码失败保留原值
  }
  // 去掉路径分隔符（如果用户用 \ 路径）
  s = s.replace(/\\/g, '/');
  // 取最后一段
  const lastSeg = s.split('/').pop() || s;
  // 去掉首尾空白和点
  return lastSeg.replace(/^[\s.]+|[\s.]+$/g, '');
};

// 从 URL query string 提取 file= 参数
const extractFromQuery = (url: URL): string | null => {
  const candidates = ['file', 'filename', 'name', 'fn', 'f'];
  for (const key of candidates) {
    const val = url.searchParams.get(key);
    if (val) {
      // 去掉可能的前后引号
      const cleaned = val.replace(/^["']|["']$/g, '');
      if (cleaned && /\.[a-zA-Z0-9]{2,5}/.test(cleaned)) {
        return cleaned;
      }
    }
  }
  return null;
};

// 安全的 fallback 文件名
const generateFallback = (ext: string): string => {
  const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return `book-${ts}.${ext || 'epub'}`;
};

export const detectFilename = (
  url: string,
  options: DetectOptions = {},
): DetectResult => {
  const { contentDisposition, contentType } = options;

  // 1. Content-Disposition 优先级最高
  if (contentDisposition) {
    const fromCd = parseContentDisposition(contentDisposition);
    if (fromCd) {
      const cleaned = sanitizeFilename(fromCd);
      if (cleaned) {
        const ext = cleaned.split('.').pop()?.toLowerCase() || '';
        return { filename: cleaned, ext, source: 'content-disposition' };
      }
    }
  }

  let urlObj: URL | null = null;
  try {
    urlObj = new URL(url);
  } catch {
    // URL 解析失败 — 用整个字符串尝试
  }

  // 2. URL path 最后一段
  if (urlObj) {
    const pathSeg = urlObj.pathname.split('/').pop() || '';
    if (pathSeg) {
      const cleaned = sanitizeFilename(pathSeg);
      if (cleaned && /\.[a-zA-Z0-9]{2,5}$/.test(cleaned)) {
        const ext = cleaned.split('.').pop()?.toLowerCase() || '';
        if (KNOWN_EXTENSIONS.includes(ext)) {
          return { filename: cleaned, ext, source: 'url-path' };
        }
      }
    }

    // 3. URL query ?file=book.epub
    const fromQuery = extractFromQuery(urlObj);
    if (fromQuery) {
      const cleaned = sanitizeFilename(fromQuery);
      if (cleaned) {
        const ext = cleaned.split('.').pop()?.toLowerCase() || '';
        return { filename: cleaned, ext, source: 'url-query' };
      }
    }
  }

  // 4. 尝试 base64 解码（针对短链接服务或纯 base64 URL）
  const lastPathSeg = urlObj?.pathname.split('/').pop() || url;
  const b64Decoded = tryBase64Decode(lastPathSeg);
  if (b64Decoded) {
    const cleaned = sanitizeFilename(b64Decoded);
    if (cleaned && /\.[a-zA-Z0-9]{2,5}$/.test(cleaned)) {
      const ext = cleaned.split('.').pop()?.toLowerCase() || '';
      if (KNOWN_EXTENSIONS.includes(ext)) {
        return { filename: cleaned, ext, source: 'base64' };
      }
    }
  }

  // 5. Content-Type 推断扩展名 + fallback 文件名
  const ext = extFromContentType(contentType);
  if (ext) {
    return {
      filename: generateFallback(ext),
      ext,
      source: 'content-type',
    };
  }

  // 6. 最终 fallback
  return {
    filename: generateFallback('epub'),
    ext: 'epub',
    source: 'fallback',
  };
};

// 校验文件名是否合法（去掉路径分隔符 + 控制字符）
export const sanitizeOutputFilename = (raw: string): string => {
  let s = raw.trim();
  // 去掉路径分隔符（防止路径穿越）
  s = s.replace(/[/\\]/g, '_');
  // 去掉控制字符
  s = s.replace(/[\x00-\x1f]/g, '');
  // 去掉首尾点和空格
  s = s.replace(/^[\s.]+|[\s.]+$/g, '');
  if (!s) s = generateFallback('epub');
  return s;
};

export const KNOWN_EXTENSIONS_LIST = KNOWN_EXTENSIONS;
