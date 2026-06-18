# Readest Lite

> Single-container, self-hostable fork of [Readest](https://github.com/readest/readest) — Supabase + R2/S3 replaced with SQLite + local filesystem, Pro/paywall removed, signup disabled.

[![CI](https://github.com/cshdotcom/readest-lite/actions/workflows/ci.yml/badge.svg)](https://github.com/cshdotcom/readest-lite/actions/workflows/ci.yml)
[![Docker](https://github.com/cshdotcom/readest-lite/actions/workflows/docker-image.yml/badge.svg)](https://github.com/cshdotcom/readest-lite/actions/workflows/docker-image.yml)

## What changed vs upstream

| Concern | Upstream | Lite |
|---|---|---|
| Database | Supabase Postgres + RLS | SQLite via Prisma |
| Object storage | R2/S3 presigned URLs | Local filesystem + HMAC-signed URLs |
| Auth | Supabase GoTrue (email/OAuth/magic-link) | Local JWT, single admin account, `/auth/v1/*` compat shim |
| Pro/paywall | Stripe + Apple IAP + Google IAP | Removed — all features unlocked |
| Signup | Open | Disabled — one admin defined via `ADMIN_EMAIL`/`ADMIN_PASSWORD` env |
| Sync protocol | — | 1:1 replicated (books/configs/notes/stats + CRDT replicas) |
| Share protocol | — | 1:1 replicated (create/list/import/revoke/download/cover/og) |
| Reader core (foliate-js) | — | Untouched |
| Frontend business code | — | Untouched except Pro/Signup removal |

## Quick start

```bash
cp .env.example .env
# Edit .env: set ADMIN_EMAIL, ADMIN_PASSWORD, JWT_SECRET
docker compose up -d --build
# Open http://localhost:8225
```

See [`DEPLOY.md`](./DEPLOY.md) for full deployment + verification guide.

## Documentation

- [`DEPLOY.md`](./DEPLOY.md) — deployment, verification, backup, troubleshooting
- [`FRONTEND_CHANGES.md`](./FRONTEND_CHANGES.md) — line-precise diff of frontend deletions
- [`PROJECT_STRUCTURE.md`](./PROJECT_STRUCTURE.md) — directory layout after refactor
- [`prisma/schema.prisma`](./prisma/schema.prisma) — 14 tables fully aligned with original Supabase schema

## Architecture

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
│  ├── /api/deepl/translate — DeepL proxy                  │
│  └── /api/{ai,tts,metadata,opds,hardcover,kosync}        │
│                             — transparent proxies        │
└──────────────────────────────────────────────────────────┘
          │                              │
          ▼                              ▼
┌─────────────────────┐       ┌──────────────────────────┐
│ SQLite (Prisma)     │       │ Local filesystem         │
│  /data/db/readest.db│       │  /data/books/<file_key>  │
│  14 tables          │       │  /data/inbox/<payload>   │
└─────────────────────┘       └──────────────────────────┘
```

## License

Inherited from upstream Readest — see [LICENSE](./LICENSE).
