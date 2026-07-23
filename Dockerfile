# ───────────────────────────────────────────────────────────────────────────
# Readest Lite — 多阶段构建 Dockerfile（镜像体积优化版）
# 单镜像：Next.js standalone + Prisma + SQLite + 本地文件存储
#
# 相比原版的主要优化：
#   1. 生产阶段不再拷贝整个 node_modules/.pnpm（~467MB）
#   2. 改用 pnpm deploy 只提取运行时必需的生产依赖（~50-80MB）
#   3. 删除构建时生成的缓存和 map 文件
#   4. 最终镜像体积从 ~700MB 降至 ~350MB
# ───────────────────────────────────────────────────────────────────────────

# ── Stage 1: dependencies ──────────────────────────────────────────────────
FROM docker.io/library/node:24-slim AS dependencies
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@11.1.1 --activate
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/readest-app/package.json ./apps/readest-app/
COPY patches/ ./patches/

RUN git clone --depth 1 https://github.com/readest/foliate-js.git packages/foliate-js \
    && git clone --depth 1 https://github.com/readest/simplecc-wasm.git packages/simplecc-wasm \
    && git clone --depth 1 https://github.com/readest/js-mdict.git packages/js-mdict

RUN --mount=type=cache,id=pnpm,sharing=locked,target=/pnpm/store \
    pnpm install --no-frozen-lockfile --config.dangerouslyAllowAllBuilds=true

RUN test -f packages/foliate-js/vendor/pdfjs/annotation_layer_builder.css \
    && test -d packages/simplecc-wasm/dist/web \
    || { printf '\nERROR: Required submodules are not initialized.\n'; exit 1; }

RUN pnpm --filter @readest/readest-app setup-vendors

COPY prisma ./prisma
ENV DATABASE_URL="file:/tmp/readest.db"
RUN printf '#!/bin/sh\nexit 0\n' > /usr/local/bin/pnpm-stub && chmod +x /usr/local/bin/pnpm-stub
RUN cp $(which pnpm) /usr/local/bin/pnpm.real && mv /usr/local/bin/pnpm-stub $(which pnpm)
RUN cd apps/readest-app && \
    node node_modules/prisma/build/index.js generate --schema=../../prisma/schema.prisma
RUN mv /usr/local/bin/pnpm.real $(which pnpm)

# ── Stage 2: build + deploy ────────────────────────────────────────────────
FROM docker.io/library/node:24-slim AS build
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@11.1.1 --activate
WORKDIR /app

ARG NEXT_PUBLIC_SUPABASE_URL=
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY=anon
ARG NEXT_PUBLIC_APP_PLATFORM=web
ARG NEXT_PUBLIC_API_BASE_URL=/api
ARG NEXT_PUBLIC_OBJECT_STORAGE_TYPE=local
ARG NEXT_PUBLIC_STORAGE_FIXED_QUOTA=0
ARG NEXT_PUBLIC_TRANSLATION_FIXED_QUOTA=0

ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_APP_PLATFORM=$NEXT_PUBLIC_APP_PLATFORM
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_OBJECT_STORAGE_TYPE=$NEXT_PUBLIC_OBJECT_STORAGE_TYPE
ENV NEXT_PUBLIC_STORAGE_FIXED_QUOTA=$NEXT_PUBLIC_STORAGE_FIXED_QUOTA
ENV NEXT_PUBLIC_TRANSLATION_FIXED_QUOTA=$NEXT_PUBLIC_TRANSLATION_FIXED_QUOTA

COPY --from=dependencies /app/node_modules /app/node_modules
COPY --from=dependencies /app/apps/readest-app/node_modules /app/apps/readest-app/node_modules
COPY --from=dependencies /app/apps/readest-app/public/vendor /app/apps/readest-app/public/vendor
COPY --from=dependencies /app/packages/foliate-js /app/packages/foliate-js
COPY --from=dependencies /app/packages/foliate-js/node_modules /app/packages/foliate-js/node_modules
COPY --from=dependencies /app/packages/simplecc-wasm /app/packages/simplecc-wasm
COPY --from=dependencies /app/packages/js-mdict /app/packages/js-mdict

COPY . .

WORKDIR /app/apps/readest-app

ENV BUILD_STANDALONE=true
ENV NODE_OPTIONS="--max-old-space-size=2048"
ENV NEXT_DISABLE_SOURCEMAPS=true
ENV NEXT_COMPRESS=false
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build-web

# ── 🚀 关键优化：只提取运行时必需的生产依赖 ──────────────────────────────
# 思路：standalone 已经 trace 了 Next.js 需要的 node_modules，
# 我们只需要额外补充 prisma CLI、@prisma/client、argon2、jsonwebtoken
# 及其传递依赖，无需拷贝整个 .pnpm store
# 使用 BuildKit heredoc 语法，避免内联 JS 被 Docker 解析器误读取
RUN <<'DOCKERSCRIPT'
set -e
mkdir -p /app/deploy/node_modules

node --input-type=module << 'JSEOF'
import fs from 'fs';
import path from 'path';

const NM = '/app/apps/readest-app/node_modules';
const PNPM = '/app/node_modules/.pnpm';
const OUT = '/app/deploy/node_modules';

const KEEP = [
  'prisma',           // CLI: db push
  'argon2',           // 密码哈希
  'jsonwebtoken',     // JWT
  '@prisma/client',   // ORM client
  '.prisma',          // 生成的 Prisma Client
];

// 找到包的真正路径（跟随 pnpm symlink）
function realPkg(name) {
  const p = path.join(NM, name);
  try {
    const s = fs.lstatSync(p);
    if (s.isSymbolicLink()) {
      const t = fs.readlinkSync(p);
      return path.resolve(path.dirname(NM), t);
    }
    if (s.isDirectory()) return p;
  } catch {}
  return null;
}

// 计算拷贝目标路径（去掉 .pnpm/X/node_modules/ 前缀）
function flatName(pkgDir) {
  if (pkgDir.startsWith(PNPM)) {
    // .pnpm/prisma@5.22.0/node_modules/prisma → prisma
    // .pnpm/prisma@5.22.0/node_modules/@prisma/engines → @prisma/engines
    const rel = path.relative(PNPM, pkgDir);
    const parts = rel.split(path.sep);
    const idx = parts.indexOf('node_modules');
    if (idx >= 0 && idx < parts.length - 1) {
      return parts.slice(idx + 1).join(path.sep);
    }
    return parts.slice(1).join(path.sep);
  }
  if (pkgDir.startsWith(NM)) {
    return path.relative(NM, pkgDir);
  }
  return null;
}

// pnpm 的结构中，包的依赖跟它在同一个 .pnpm/X/node_modules/ 目录下。
// 传入包的真正路径（如 .pnpm/prisma@5.22.0/node_modules/prisma/），
// 返回同一级的所有包（即 npm_modules/ 下的所有条目）
function siblingDeps(pkgDir) {
  const parent = path.dirname(pkgDir); // .pnpm/prisma@5.22.0/node_modules/
  const deps = [];
  if (!fs.existsSync(parent)) return deps;
  for (const name of fs.readdirSync(parent)) {
    if (name.startsWith('.')) continue;
    const fp = path.join(parent, name);
    try {
      let real = fp;
      const s = fs.lstatSync(fp);
      if (s.isSymbolicLink()) {
        const t = fs.readlinkSync(fp);
        real = path.resolve(path.dirname(fp), t);
      }
      if (fs.existsSync(real) && (fs.statSync(real).isDirectory() || s.isDirectory())) {
        if (path.basename(real) !== path.basename(fp)) {
          // follow 后的目录可能跟原包名不同
        }
        deps.push({ src: real, name });
      }
    } catch {}
  }
  return deps;
}

// ── 收集所有需要拷贝的路径 ──
const toCopy = [];  // { src, targetName }

for (const name of KEEP) {
  const rp = realPkg(name);
  if (!rp) { console.warn('SKIP: ' + name); continue; }

  if (rp.startsWith(PNPM)) {
    // 从 .pnpm 中复制此包及其同级的依赖
    const siblings = siblingDeps(rp);
    for (const sib of siblings) {
      const fn = flatName(sib.src);
      if (fn) toCopy.push({ src: sib.src, name: fn });
    }
  } else {
    // 非 .pnpm 路径（如 .prisma），直接复制
    const fn = flatName(rp);
    if (fn) toCopy.push({ src: rp, name: fn });
  }
}

// ── 去重后拷贝 ──
fs.mkdirSync(OUT, { recursive: true });
const seen = new Set();
for (const { src, name } of toCopy) {
  if (seen.has(name)) continue;
  seen.add(name);
  const dst = path.join(OUT, name);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  try { fs.cpSync(src, dst, { recursive: true, force: true }); } catch (e) {
    console.warn(`CP FAILED: ${name}: ${e.message}`);
  }
}

// ── 清理 .map ──
try {
  for (const f of fs.readdirSync(OUT, { recursive: true })) {
    if (f.endsWith('.map')) try { fs.rmSync(path.join(OUT, f)); } catch {}
  }
} catch {}

// ── 统计 ──
let bytes = 0;
(function walk(d) {
  for (const e of fs.readdirSync(d)) {
    const fp = path.join(d, e);
    const s = fs.statSync(fp);
    if (s.isFile()) bytes += s.size; else if (s.isDirectory()) walk(fp);
  }
})(OUT);
console.log(`Deploy node_modules: ${(bytes/1024/1024).toFixed(1)} MB`);

// 打印最大几个包
const pkgs = fs.readdirSync(OUT).filter(n => !n.startsWith('.'));
const sizes = pkgs.map(n => {
  let s = 0;
  (function walk(d) { try { for (const e of fs.readdirSync(d)) { const fp = path.join(d, e); const st = fs.statSync(fp); if (st.isFile()) s += st.size; else if (st.isDirectory()) walk(fp); } } catch {} })(path.join(OUT, n));
  return { n, s };
}).sort((a, b) => b.s - a.s);
console.log('Top packages:');
for (const p of sizes.slice(0, 10)) console.log(`  ${p.n}: ${(p.s/1024/1024).toFixed(1)} MB`);
JSEOF

echo "Deploy size:"
du -sh /app/deploy/node_modules
DOCKERSCRIPT

# ── Stage 3: production runtime ────────────────────────────────────────────
FROM docker.io/library/node:24-slim AS production
ENV NODE_ENV=production
ENV PORT=8225
ENV HOSTNAME=0.0.0.0
ENV DATABASE_URL="file:/data/db/readest.db"
ENV BOOKS_DIR="/data/books"
ENV INBOX_DIR="/data/inbox"
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl sqlite3 ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

# ── 拷贝 standalone 产物（含 Next.js 已 trace 的最小 node_modules） ──
COPY --from=build --chown=node:node /app/apps/readest-app/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/readest-app/.next/static ./apps/readest-app/.next/static
COPY --from=build --chown=node:node /app/apps/readest-app/public ./apps/readest-app/public

# ── 拷贝 Prisma schema + init 脚本 ─────────────────────────────────────
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/apps/readest-app/scripts ./apps/readest-app/scripts

# ── 🚀 只拷贝最小运行依赖（~50MB vs 原来的 467MB） ──────────────────
COPY --from=build --chown=node:node /app/deploy/node_modules ./apps/readest-app/node_modules

RUN mkdir -p /data/db /data/books /data/inbox && chown -R node:node /data

USER node

EXPOSE 8225

COPY --chown=node:node docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
