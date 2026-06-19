# Readest Lite

> Single-container, self-hostable fork of [Readest](https://github.com/readest/readest) — Supabase + R2/S3 replaced with SQLite + local filesystem, Pro/paywall removed, signup disabled.

[![CI](https://github.com/cshdotcom/readest-lite/actions/workflows/ci.yml/badge.svg)](https://github.com/cshdotcom/readest-lite/actions/workflows/ci.yml)
[![Docker](https://github.com/cshdotcom/readest-lite/actions/workflows/docker-image.yml/badge.svg)](https://github.com/cshdotcom/readest-lite/actions/workflows/docker-image.yml)

📚 **完整部署教程**：https://cshdotcom.github.io/readestl/deploy.html

## 快速开始

```bash
# 一条命令拉起
docker run -d \
  --name readest-lite \
  -p 8225:8225 \
  -v readest-data:/data \
  -e ADMIN_EMAIL=admin@example.com \
  -e ADMIN_PASSWORD=changeme \
  ghcr.io/cshdotcom/readest-lite:latest

# 30 秒后访问 http://localhost:8225
```

**请务必修改默认密码**，生产环境使用 16 位以上随机字符串。

## Docker Compose 部署（推荐）

```bash
git clone https://github.com/cshdotcom/readest-lite.git
cd readest-lite
cp .env.example .env
# 编辑 .env：设置 ADMIN_EMAIL / ADMIN_PASSWORD
docker compose up -d
```

详细配置见 [部署教程](https://cshdotcom.github.io/readestl/deploy.html)。

## 环境变量

| 变量 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `ADMIN_EMAIL` | ✅ | — | 管理员邮箱，首次启动自动创建账号 |
| `ADMIN_PASSWORD` | ✅ | — | 管理员密码，建议 16+ 位随机字符 |
| `PORT` | 可选 | 8225 | 容器内监听端口 |
| `JWT_SECRET` | 可选 | 派生值 | JWT 签名密钥，不设时由 ADMIN_EMAIL+ADMIN_PASSWORD 派生 |
| `PUBLIC_BASE_URL` | 可选 | http://localhost:8225 | 对外访问 URL，反向代理场景下必填 |
| `DEEPL_FREE_API_KEYS` | 可选 | — | DeepL Free API key，逗号分隔 |
| `DEEPL_PRO_API_KEYS` | 可选 | — | DeepL Pro API key，逗号分隔 |
| `AI_GATEWAY_API_KEY` | 可选 | — | AI 聊天网关 key |

完整说明见 [部署教程 - 环境变量](https://cshdotcom.github.io/readestl/deploy.html#env)。

## 数据持久化

所有数据存储在容器 `/data` 目录：

```
data/
├── db/             SQLite 数据库（用户、书籍、进度、批注）
│   └── readest.db
├── books/          书籍文件
│   ├── uploads/    上传的电子书
│   └── covers/     自动生成的封面
├── inbox/          Send to Readest 入站文件
└── config.json     运行时配置（自动生成）
```

通过卷挂载（`-v ./data:/data` 或 `-v readest-data:/data`）确保容器重建不丢失。

## What changed vs upstream

| 关注点 | 上游 Readest | Readest Lite |
|---|---|---|
| 数据库 | Supabase Postgres + RLS | SQLite via Prisma |
| 对象存储 | R2/S3 预签名 URL | 本地文件系统 + HMAC 签名 URL |
| 鉴权 | Supabase GoTrue（邮箱/OAuth/Magic Link） | 本地 JWT，单管理员账号，`/auth/v1/*` 兼容 shim |
| Pro/付费 | Stripe + Apple IAP + Google IAP | 完全删除，所有功能无条件开放 |
| 注册 | 开放 | 禁用 — 一个管理员由 env 指定 |
| 同步协议 | — | 1:1 复刻（books/configs/notes/stats + CRDT replicas） |
| 分享协议 | — | 1:1 复刻（create/list/import/revoke/download/cover/og） |
| 阅读器内核 | foliate-js | 完全一致（零改动） |
| 前端业务代码 | — | 仅删除 Pro/注册入口，其余原样保留 |

## 文档

- 📚 [部署教程](https://cshdotcom.github.io/readestl/deploy.html) — 完整部署指南
- 📄 [DEPLOY.md](./DEPLOY.md) — 部署细节与验证
- 📝 [FRONTEND_CHANGES.md](./FRONTEND_CHANGES.md) — 前端改造清单（精确到行）
- 🗂️ [PROJECT_STRUCTURE.md](./PROJECT_STRUCTURE.md) — 改造后目录结构
- 📦 [CHANGELOG.md](./CHANGELOG.md) — 详细变更日志

## 架构

```
┌──────────────────────────────────────────────────────────┐
│ Browser (Next.js web app, port 8225)                     │
│  └── utils/supabase.ts → pseudo client → /auth/v1/*      │
└──────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────┐
│ Next.js standalone server (single container)             │
│  ├── /auth/v1/*           — Supabase Auth compat shim    │
│  ├── /api/sync            — books/configs/notes/stats    │
│  ├── /api/sync/replicas   — CRDT replicas (HLC merge)    │
│  ├── /api/sync/replica-keys — PBKDF2 salts               │
│  ├── /api/storage/*       — files + HMAC-signed PUT/GET  │
│  ├── /api/share/*         — book shares + OG image       │
│  ├── /api/send/*          — Send to Readest inbox        │
│  └── /api/{ai,tts,metadata,opds,hardcover,kosync}        │
│                             — transparent proxies        │
└──────────────────────────────────────────────────────────┘
          │                              │
          ▼                              ▼
┌─────────────────────┐       ┌──────────────────────────┐
│ SQLite (Prisma)     │       │ Local filesystem         │
│  /data/db/readest.db│       │  /data/books/uploads/    │
│  14 tables          │       │  /data/books/covers/     │
└─────────────────────┘       │  /data/inbox/            │
                              └──────────────────────────┘
```

## 升级

```bash
docker compose pull      # 拉取最新镜像
docker compose up -d     # 重建容器（数据在 ./data 不受影响）
docker image prune -f    # 清理旧镜像
```

启动时自动检测数据库版本并执行迁移，无需手动操作。

## License

Inherited from upstream Readest — see [LICENSE](./LICENSE).
