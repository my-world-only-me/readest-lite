/**
 * Readest Lite — 从 pnpm monorepo 中提取运行时最小依赖
 *
 * 只提取 entrypoint.sh 需要的生产依赖（prisma / argon2 / @prisma-client / jsonwebtoken
 * 及其传递依赖），输出扁平 node_modules 供生产镜像使用。
 *
 * 用法（在 build 阶段、pnpm build-web 完成后）：
 *   node /app/docker/extract-runtime-deps.js
 */

const fs = require('fs');
const path = require('path');

const NM = '/app/apps/readest-app/node_modules';
const PNPM = '/app/node_modules/.pnpm';
const OUT = '/app/deploy/node_modules';

// 运行时需要的包名（standalone 产物不包含这些）
const KEEP = [
  'prisma',           // CLI: db push
  'argon2',           // 密码哈希（native addon）
  'jsonwebtoken',     // JWT 签发/验证
  '@prisma/client',   // ORM client
  '.prisma',          // 生成的 Prisma Client
];

// ── 辅助函数 ──────────────────────────────────────────────────────────

/** 找出包的真正路径（跟随 pnpm symlink） */
function realPkg(name) {
  const p = path.join(NM, name);
  try {
    const s = fs.lstatSync(p);
    if (s.isSymbolicLink()) {
      return path.resolve(path.dirname(NM), fs.readlinkSync(p));
    }
    if (s.isDirectory()) return p;
  } catch (e) {
    console.warn(`[extract] SKIP: ${name} — ${e.message}`);
  }
  return null;
}

/** 计算扁平化后的目标路径 */
function flatDst(pkgDir) {
  if (pkgDir.startsWith(PNPM)) {
    const rel = path.relative(PNPM, pkgDir);
    const parts = rel.split(path.sep);
    const nmIdx = parts.indexOf('node_modules');
    if (nmIdx >= 0 && nmIdx < parts.length - 1) {
      return parts.slice(nmIdx + 1).join(path.sep);
    }
    return parts.slice(1).join(path.sep);
  }
  if (pkgDir.startsWith(NM)) {
    return path.relative(NM, pkgDir);
  }
  return null;
}

/**
 * pnpm 的结构：包和它的依赖在同一个 .pnpm/X/node_modules/ 目录下。
 * 例如 prisma@5.22.0/node_modules/ 下同时有：
 *   prisma/        ← 包本身
 *   @prisma/       ← 它的依赖（symlink 到其他 .pnpm 包）
 *
 * 此函数返回同一目录下的所有包。
 */
function siblingDeps(pkgDir) {
  const parent = path.dirname(pkgDir); // .pnpm/prisma@5.22.0/node_modules/
  const deps = [];
  if (!fs.existsSync(parent)) return deps;
  for (const name of fs.readdirSync(parent)) {
    if (name.startsWith('.')) continue;
    const fp = path.join(parent, name);
    try {
      const s = fs.lstatSync(fp);
      let real = fp;
      if (s.isSymbolicLink()) {
        real = path.resolve(path.dirname(fp), fs.readlinkSync(fp));
      }
      if (fs.existsSync(real) && (fs.statSync(real).isDirectory() || s.isDirectory())) {
        const fn = flatDst(real);
        if (fn) deps.push({ src: real, dstName: fn });
      }
    } catch {}
  }
  return deps;
}

// ── 主逻辑 ────────────────────────────────────────────────────────────

fs.mkdirSync(OUT, { recursive: true });
const collected = [];   // { src, dstName }

for (const name of KEEP) {
  const rp = realPkg(name);
  if (!rp) continue;

  if (rp.startsWith(PNPM)) {
    // 从 .pnpm 提取：复制此包及其同级依赖
    const siblings = siblingDeps(rp);
    for (const sib of siblings) collected.push(sib);
  } else {
    // 非 .pnpm 路径（如 .prisma），直接复制
    const fn = flatDst(rp);
    if (fn) collected.push({ src: rp, dstName: fn });
  }
}

// 去重拷贝
const seen = new Set();
let copied = 0;
for (const { src, dstName } of collected) {
  if (seen.has(dstName)) continue;
  seen.add(dstName);
  const dst = path.join(OUT, dstName);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  try {
    fs.cpSync(src, dst, { recursive: true, force: true });
    copied++;
  } catch (e) {
    console.warn(`[extract] CP FAILED: ${dstName}: ${e.message}`);
  }
}

// 清理 .map 文件
let mapDel = 0;
try {
  for (const f of fs.readdirSync(OUT, { recursive: true })) {
    if (f.endsWith('.map')) {
      try { fs.rmSync(path.join(OUT, f)); mapDel++; } catch {}
    }
  }
} catch {}

// 统计大小
let totalBytes = 0;
(function walk(d) {
  for (const e of fs.readdirSync(d)) {
    const fp = path.join(d, e);
    const s = fs.statSync(fp);
    if (s.isFile()) totalBytes += s.size;
    else if (s.isDirectory()) walk(fp);
  }
})(OUT);

console.log(`[extract] Done!`);
console.log(`[extract]   Packages kept:    ${KEEP.length}`);
console.log(`[extract]   Dirs resolved:     ${collected.length}`);
console.log(`[extract]   Dirs copied:       ${copied}`);
console.log(`[extract]   .map deleted:      ${mapDel}`);
console.log(`[extract]   Output size:       ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);

// Top 10 largest
const pkgs = fs.readdirSync(OUT).filter(n => !n.startsWith('.'));
const sizes = pkgs.map(n => {
  let s = 0;
  (function walk(d) { try { for (const e of fs.readdirSync(d)) { const fp = path.join(d, e); const st = fs.statSync(fp); if (st.isFile()) s += st.size; else if (st.isDirectory()) walk(fp); } } catch {} })(path.join(OUT, n));
  return { n, sizeMB: (s / 1024 / 1024).toFixed(1) };
}).sort((a, b) => parseFloat(b.sizeMB) - parseFloat(a.sizeMB));
console.log(`[extract] Top packages:`);
for (const p of sizes.slice(0, 10)) {
  console.log(`  ${p.n}: ${p.sizeMB} MB`);
}
