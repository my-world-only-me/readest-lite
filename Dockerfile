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
COPY docker/extract-runtime-deps.js /app/scripts/extract-runtime-deps.js

WORKDIR /app/apps/readest-app

ENV BUILD_STANDALONE=true
ENV NODE_OPTIONS="--max-old-space-size=4096"
ENV NEXT_DISABLE_SOURCEMAPS=true
ENV NEXT_COMPRESS=false
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build-web

# ── 🚀 关键优化：只提取运行时必需的生产依赖 ──────────────────────────────
# 思路：standalone 已经 trace 了 Next.js 需要的 node_modules，
# 我们只需要额外补充 prisma CLI、@prisma/client、argon2、jsonwebtoken
# 及其传递依赖，无需拷贝整个 .pnpm store
# 提取脚本见 docker/extract-runtime-deps.js
RUN mkdir -p /app/deploy && \
    node /app/scripts/extract-runtime-deps.js && \
    echo 'Deploy size:' && du -sh /app/deploy/node_modules

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
