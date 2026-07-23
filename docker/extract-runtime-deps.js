/**
 * Readest Lite — 从 pnpm monorepo 中提取运行时最小依赖
 *
 * 作用：从 pnpm 的 .pnpm store 中只取出 production 需要的包，
 *      输出扁平化的 node_modules（无 symlink），用于 Docker 生产镜像。
 *
 * 工作原理：
 *   1. 只提取 prisma / argon2 / @prisma/client / jsonwebtoken 及其传递依赖
 *   2. 这些是 standalone 产物不包含、但 entrypoint 脚本需要的包
 *   3. 输出到 /app/deploy/node_modules（扁平结构，自包含）
 *
 * 用法：node docker/extract-runtime-deps.js
 *       在 build 阶段（pnpm build-web 完成后）调用
 */

const fs = require('fs');
const path = require('path');

// ── 配置 ──────────────────────────────────────────────────────────────
const NM = '/app/apps/readest-app/node_modules';
const PNPM = '/app/node_modules/.pnpm';
const OUT = '/app/deploy/node_modules';

// 运行时需要但 standalone 不含的包（白名单）
const KEEP = [
  'prisma',           // CLI: db push
  'argon2',           // 密码哈希（native addon）
  'jsonwebtoken',     // JWT 签发/验证
  '@prisma/client',   // ORM client
  '.prisma',          // 生成的 Prisma Client（包含 schema 类型）
];

// ── 辅助函数 ──────────────────────────────────────────────────────────

/** 解析 pnpm symlink 找到包的真正位置 */
function findRealPath(name) {
  const p = path.join(NM, name);
  try {
    const stat = fs.lstatSync(p);
    if (stat.isSymbolicLink()) {
      const target = fs.readlinkSync(p);
      return path.resolve(path.dirname(NM), target);
    }
    if (stat.isDirectory()) return p;
  } catch (e) {
    console.warn(`[extract] WARN: ${name} not found in ${NM}`, e.message);
  }
  return null;
}

/** 递归收集一个包的所有传递依赖（扫描其 node_modules） */
function resolveDeps(pkgDir, visited) {
  if (visited.has(pkgDir)) return;
  visited.add(pkgDir);
  const nmDir = path.join(pkgDir, 'node_modules');
  if (!fs.existsSync(nmDir)) return;
  for (const name of fs.readdirSync(nmDir)) {
    if (name.startsWith('.')) continue;
    const fullPath = path.join(nmDir, name);
    try {
      const stat = fs.lstatSync(fullPath);
      let realPath;
      if (stat.isSymbolicLink()) {
        const target = fs.readlinkSync(fullPath);
        realPath = path.resolve(path.dirname(fullPath), target);
      } else if (stat.isDirectory()) {
        realPath = fullPath;
      } else continue;
      if (fs.existsSync(realPath) && !visited.has(realPath)) {
        visited.add(realPath);
        resolveDeps(realPath, visited);
      }
    } catch (e) {
      console.warn(`[extract] WARN: skipping ${fullPath}: ${e.message}`);
    }
  }
}

/** 计算从 pnpm store 到扁平 node_modules 的目标路径 */
function computeDst(src) {
  if (src.startsWith(PNPM)) {
    // 输入: /app/node_modules/.pnpm/prisma@5.22.0/node_modules/prisma
    // 输出: prisma
    const rel = path.relative(PNPM, src);
    const parts = rel.split(path.sep);
    const nmIdx = parts.indexOf('node_modules');
    if (nmIdx >= 0 && nmIdx < parts.length - 1) {
      return parts.slice(nmIdx + 1).join(path.sep);
    }
    // 如果没找到 node_modules，直接用第一段（包版本目录）
    return parts.slice(1).join(path.sep);
  }
  if (src.startsWith(NM)) {
    return path.relative(NM, src);
  }
  return null;
}

// ── 主逻辑 ────────────────────────────────────────────────────────────

function main() {
  console.log('[extract] Starting runtime dependency extraction...');
  console.log(`[extract] NM=${NM}`);
  console.log(`[extract] PNPM=${PNPM}`);
  console.log(`[extract] OUT=${OUT}`);

  // 1. 收集所有需要拷贝的路径
  const toCopy = new Set();

  for (const name of KEEP) {
    const realPath = findRealPath(name);
    if (realPath) {
      console.log(`[extract] Collecting ${name} → ${realPath}`);
      toCopy.add(realPath);
      resolveDeps(realPath, toCopy);
    } else {
      console.warn(`[extract] WARN: ${name} not found, skipping`);
    }
  }

  console.log(`[extract] Total unique paths to copy: ${toCopy.size}`);

  // 2. 拷贝到输出目录
  fs.mkdirSync(OUT, { recursive: true });
  let totalBytes = 0;
  let copiedCount = 0;

  for (const src of toCopy) {
    const relPath = computeDst(src);
    if (!relPath) {
      console.warn(`[extract] WARN: cannot compute dst for ${src}, skipping`);
      continue;
    }

    const dst = path.join(OUT, relPath);
    if (!fs.existsSync(path.dirname(dst))) {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
    }

    try {
      fs.cpSync(src, dst, { recursive: true, force: true });
      copiedCount++;

      // 统计文件大小（只统计顶层文件避免重复递归）
      const stat = fs.statSync(dst);
      if (stat.isFile()) {
        totalBytes += stat.size;
      } else if (stat.isDirectory()) {
        // 粗略统计
        try {
          const files = fs.readdirSync(dst, { recursive: true });
          for (const f of files) {
            const fp = path.join(dst, f);
            try { totalBytes += fs.statSync(fp).size; } catch {}
          }
        } catch {}
      }
    } catch (e) {
      console.error(`[extract] ERROR: failed to copy ${src} → ${dst}: ${e.message}`);
    }
  }

  // 3. 清理 map 文件
  const mapDeleted = [];
  try {
    const allFiles = fs.readdirSync(OUT, { recursive: true });
    for (const f of allFiles) {
      if (f.endsWith('.map')) {
        const fp = path.join(OUT, f);
        try {
          fs.rmSync(fp);
          mapDeleted.push(f);
        } catch {}
      }
    }
  } catch {}

  // 4. 报告
  const sizeMB = (totalBytes / 1024 / 1024).toFixed(1);
  console.log(`[extract] Done!`);
  console.log(`[extract]   Packages kept: ${KEEP.length}`);
  console.log(`[extract]   Paths copied:  ${copiedCount}`);
  console.log(`[extract]   .map deleted:  ${mapDeleted.length}`);
  console.log(`[extract]   Output size:   ${sizeMB} MB`);

  // 列出最大的几个包
  const dirSizes = [];
  for (const entry of fs.readdirSync(OUT)) {
    const fp = path.join(OUT, entry);
    try {
      const stat = fs.statSync(fp);
      if (stat.isDirectory()) {
        let dirSize = 0;
        const files = fs.readdirSync(fp, { recursive: true });
        for (const f of files) {
          try { dirSize += fs.statSync(path.join(fp, f)).size; } catch {}
        }
        dirSizes.push({ name: entry, size: dirSize });
      }
    } catch {}
  }
  dirSizes.sort((a, b) => b.size - a.size);
  console.log(`[extract] Top packages by size:`);
  for (const d of dirSizes.slice(0, 10)) {
    console.log(`  ${d.name}: ${(d.size / 1024 / 1024).toFixed(1)} MB`);
  }
}

main();
