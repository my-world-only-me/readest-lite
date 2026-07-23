/**
 * Readest Lite — 从 pnpm monorepo 中提取运行时最小依赖
 *
 * 工作原理：
 *   1. 扫描 .next/standalone/apps/readest-app/node_modules/ 中所有被追踪的包
 *      （都是 pnpm symlink）
 *   2. 从 .pnpm store 中定位到真实路径，用 cp -rL 扁平化复制
 *   3. 额外加入 entrypoint 需要的 prisma CLI（带所有同级依赖，如 @prisma/engines）
 *
 * 输出是一个完整的、扁平的 node_modules，可直接替换 standalone 的 symlink 树。
 *
 * 用法（在 build 阶段、pnpm build-web 完成后）：
 *   node /app/docker/extract-runtime-deps.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const NM_APP = '/app/apps/readest-app/node_modules';
const PNPM = '/app/node_modules/.pnpm';
const STANDALONE_NM = '/app/apps/readest-app/.next/standalone/apps/readest-app/node_modules';
const OUT = '/app/deploy/node_modules';

// ── Helpers ──────────────────────────────────────────────────────────

function flatCopy(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  try {
    execSync(`cp -rL '${src}' '${dst}'`, { stdio: 'ignore', timeout: 60000 });
    return true;
  } catch (e) {
    console.warn(`  CP FAILED: ${path.basename(src)}: ${e.message}`);
    return false;
  }
}

function pnpmRealPath(symlinkPath) {
  try {
    return path.resolve(path.dirname(symlinkPath), fs.readlinkSync(symlinkPath));
  } catch { return null; }
}

function findPnpmEntries(pkgName) {
  const entries = [];
  if (!fs.existsSync(PNPM)) return entries;
  const prefix = pkgName.replace(/\//g, '+');
  for (const entry of fs.readdirSync(PNPM)) {
    const entryPkg = entry.replace(/@[^@]+$/, '');
    if (entryPkg === prefix) entries.push(path.join(PNPM, entry));
  }
  return entries;
}

/**
 * 从 .pnpm 条目的 node_modules/ 复制所有包（含包自身及所有同级依赖）。
 * 这是处理 prisma CLI 这类需要完整依赖树的关键函数。
 */
function copyPnpmEntrySiblings(entryPath, copiedSet) {
  const entryNM = path.join(entryPath, 'node_modules');
  if (!fs.existsSync(entryNM)) return 0;

  let count = 0;
  for (const dep of fs.readdirSync(entryNM)) {
    if (dep.startsWith('.')) continue;
    const depDst = path.join(OUT, dep);
    if (copiedSet.has(depDst)) continue;

    const depSrc = path.join(entryNM, dep);
    let realSrc = depSrc;
    try {
      const st = fs.lstatSync(depSrc);
      if (st.isSymbolicLink()) {
        realSrc = path.resolve(path.dirname(depSrc), fs.readlinkSync(depSrc));
        if (!fs.existsSync(realSrc)) continue;
      }
    } catch { continue; }

    if (flatCopy(realSrc, depDst)) {
      copiedSet.add(depDst);
      count++;
    }
  }
  return count;
}

// ── 主逻辑 ────────────────────────────────────────────────────────────

fs.mkdirSync(OUT, { recursive: true });
console.log('[extract] === Step 1: scan standalone traced packages ===');

const tracedNames = []; // 收集所有被追踪的包名

if (fs.existsSync(STANDALONE_NM)) {
  for (const name of fs.readdirSync(STANDALONE_NM)) {
    if (name.startsWith('.')) continue;
    tracedNames.push(name);
    // scoped 包：读取子目录（@scope/name）
    if (name.startsWith('@')) {
      const appScope = path.join(NM_APP, name);
      if (fs.existsSync(appScope)) {
        for (const sub of fs.readdirSync(appScope)) {
          if (!sub.startsWith('.')) tracedNames.push(`${name}/${sub}`);
        }
      }
    }
  }
}

console.log(`[extract] Found ${tracedNames.length} traced packages`);

// ── Step 2: 从 .pnpm store 复制每个包 ─────────────────────────────
console.log('[extract] === Step 2: copy packages from .pnpm store ===');

const copied = new Set();

for (const pkgName of tracedNames) {
  const dst = path.join(OUT, pkgName);
  if (copied.has(dst)) continue;

  // 尝试 1: 从 standalone 的 symlink 解析真实路径
  const standalonePath = path.join(STANDALONE_NM, pkgName);
  const realPath = fs.existsSync(standalonePath) ? pnpmRealPath(standalonePath) : null;
  if (realPath && fs.existsSync(realPath) && flatCopy(realPath, dst)) {
    copied.add(dst);
    continue;
  }

  // 尝试 2: 直接从完整 node_modules 复制
  const appPath = path.join(NM_APP, pkgName);
  if (fs.existsSync(appPath)) {
    try {
      const st = fs.lstatSync(appPath);
      if (st.isSymbolicLink()) {
        const rp = pnpmRealPath(appPath);
        if (rp && fs.existsSync(rp) && flatCopy(rp, dst)) {
          copied.add(dst); continue;
        }
      } else if (st.isDirectory() && flatCopy(appPath, dst)) {
        copied.add(dst); continue;
      }
    } catch {}
  }

  // 尝试 3: 在 .pnpm store 中按包名查找
  const pnpmEntries = findPnpmEntries(pkgName);
  for (const entry of pnpmEntries) {
    const entryNM = path.join(entry, 'node_modules');
    if (!fs.existsSync(entryNM)) continue;
    const pkgDir = path.join(entryNM, pkgName);
    if (fs.existsSync(pkgDir) && fs.statSync(pkgDir).isDirectory() && flatCopy(pkgDir, dst)) {
      copied.add(dst); break;
    }
  }
}

console.log(`[extract] Copied ${copied.size} packages from trace`);

// ── Step 3: 额外添加 entrypoint 需要的包（带所有同级依赖） ──────────
console.log('[extract] === Step 3: add entrypoint-only deps ===');

const EXTRA = ['prisma'];

for (const name of EXTRA) {
  if (copied.has(path.join(OUT, name))) {
    console.log(`[extract] Extra: ${name} already copied`);
    continue;
  }

  const entries = findPnpmEntries(name);
  let ok = false;
  for (const entry of entries) {
    const c = copyPnpmEntrySiblings(entry, copied);
    if (c > 0) {
      console.log(`[extract] Extra: ${name} -> ${c} packages (incl. siblings)`);
      ok = true;
      break;
    }
  }
  if (!ok) console.warn(`[extract] Extra: ${name} NOT FOUND`);
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

const topPkgs = fs.readdirSync(OUT).filter(n => !n.startsWith('.')).map(n => {
  let s = 0;
  (function walk(d) { try { for (const e of fs.readdirSync(d)) { const fp = path.join(d, e); const st = fs.statSync(fp); if (st.isFile()) s += st.size; else if (st.isDirectory()) walk(fp); } } catch {} })(path.join(OUT, n));
  return { n, s };
}).sort((a, b) => b.s - a.s);

console.log(`[extract] Output size: ${(bytes / 1024 / 1024).toFixed(1)} MB`);
console.log(`[extract] Total packages: ${copied.size}`);
console.log('[extract] Top 15 packages:');
for (const p of topPkgs.slice(0, 15)) {
  console.log(`  ${p.n}: ${(p.s/1024/1024).toFixed(1)} MB`);
}
