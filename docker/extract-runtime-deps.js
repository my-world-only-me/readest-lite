/**
 * Readest Lite — 从 pnpm monorepo 中提取运行时最小依赖
 *
 * 工作原理：直接扫描 .pnpm store 按包名匹配 prisma / argon2 等，
 * 复制整个 node_modules/ 目录（含包本身及其所有同级依赖）。
 * 这样可以正确处理 Docker COPY 扁平化后的 pnpm 结构。
 *
 * 用法（在 build 阶段、pnpm build-web 完成后）：
 *   node /app/docker/extract-runtime-deps.js
 */

const fs = require('fs');
const path = require('path');

const NM = '/app/apps/readest-app/node_modules';
const PNPM = '/app/node_modules/.pnpm';
const OUT = '/app/deploy/node_modules';

// 运行时需要的包名
const KEEP = [
  'prisma',
  'argon2',
  'jsonwebtoken',
  '@prisma/client',
];

// ── 扫描 .pnpm store ────────────────────────────────────────────────

/** 在 .pnpm store 中找到匹配某个包名的所有条目 */
function findPnpmEntries(pkgName) {
  const entries = [];
  if (!fs.existsSync(PNPM)) return entries;

  // 把 @scope/name 转为 @scope+name（pnpm 的 store 命名规则）
  const prefix = pkgName.replace(/\//g, '+');

  for (const entry of fs.readdirSync(PNPM)) {
    // 匹配：prisma@5.22.0 或 @prisma+client@5.22.0
    const entryPkg = entry.replace(/@[^@]+$/, '');
    if (entryPkg === prefix) {
      entries.push(path.join(PNPM, entry));
    }
  }
  return entries;
}

/** 从 .pnpm 条目中复制包及其所有同级依赖 */
function copyFromPnpmEntry(entryPath) {
  const nmDir = path.join(entryPath, 'node_modules');
  if (!fs.existsSync(nmDir)) {
    console.warn(`  no node_modules in ${path.relative(PNPM, entryPath)}`);
    return 0;
  }

  let count = 0;
  for (const name of fs.readdirSync(nmDir)) {
    if (name.startsWith('.')) continue;

    const src = path.join(nmDir, name);
    let realSrc = src;
    try {
      const s = fs.lstatSync(src);
      if (s.isSymbolicLink()) {
        realSrc = path.resolve(path.dirname(src), fs.readlinkSync(src));
        if (!fs.existsSync(realSrc)) continue;
      }
    } catch { continue; }

    // 目标路径：直接用包名（去掉 .pnpm 的版本路径）
    const dst = path.join(OUT, name);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    try {
      fs.cpSync(realSrc, dst, { recursive: true, force: true });
      count++;
    } catch (e) {
      console.warn(`  CP FAILED: ${name}: ${e.message}`);
    }
  }
  return count;
}

// ── 主逻辑 ────────────────────────────────────────────────────────────

fs.mkdirSync(OUT, { recursive: true });
let totalCopied = 0;

console.log('[extract] Scanning .pnpm store...');

for (const name of KEEP) {
  const entries = findPnpmEntries(name);
  if (entries.length === 0) {
    console.warn(`[extract] NOT FOUND in .pnpm: ${name}`);
    // 回退：直接从 node_modules 复制
    const fallback = path.join(NM, name);
    if (fs.existsSync(fallback)) {
      const dst = path.join(OUT, name);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      try {
        fs.cpSync(fallback, dst, { recursive: true, force: true });
        console.log(`[extract] ${name}: copied (fallback)`);
        totalCopied++;
      } catch (e) {
        console.warn(`[extract] FALLBACK FAILED: ${name}: ${e.message}`);
      }
    }
    continue;
  }

  for (const entry of entries) {
    const short = path.relative(PNPM, entry);
    console.log(`[extract] ${name}: found ${short}`);
    const copied = copyFromPnpmEntry(entry);
    console.log(`[extract]   -> copied ${copied} packages`);
    totalCopied += copied;
  }
}

// 单独处理 .prisma（生成的 Prisma Client，不在 .pnpm 中）
const prismaGen = path.join(NM, '.prisma');
if (fs.existsSync(prismaGen)) {
  const dst = path.join(OUT, '.prisma');
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  try {
    fs.cpSync(prismaGen, dst, { recursive: true, force: true });
    console.log('[extract] .prisma: copied');
  } catch (e) {
    console.warn(`[extract] .prisma FAILED: ${e.message}`);
  }
}

// ── 清理 .map ──
let mapDel = 0;
try {
  for (const f of fs.readdirSync(OUT, { recursive: true })) {
    if (f.endsWith('.map')) {
      try { fs.rmSync(path.join(OUT, f)); mapDel++; } catch {}
    }
  }
} catch {}
console.log(`[extract] .map deleted: ${mapDel}`);

// ── 统计 ──
let bytes = 0;
(function walk(d) {
  for (const e of fs.readdirSync(d)) {
    const fp = path.join(d, e);
    const s = fs.statSync(fp);
    if (s.isFile()) bytes += s.size;
    else if (s.isDirectory()) walk(fp);
  }
})(OUT);
console.log(`[extract] Output size: ${(bytes / 1024 / 1024).toFixed(1)} MB`);

// Top packages
const pkgs = fs.readdirSync(OUT).filter(n => !n.startsWith('.'));
const sizes = pkgs.map(n => {
  let s = 0;
  (function walk(d) { try { for (const e of fs.readdirSync(d)) { const fp = path.join(d, e); const st = fs.statSync(fp); if (st.isFile()) s += st.size; else if (st.isDirectory()) walk(fp); } } catch {} })(path.join(OUT, n));
  return { n, s };
}).sort((a, b) => b.s - a.s);
console.log('[extract] Top packages:');
for (const p of sizes.slice(0, 10)) {
  console.log(`  ${p.n}: ${(p.s/1024/1024).toFixed(1)} MB`);
}
