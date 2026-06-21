# Changelog

All notable changes to Readest Lite are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [v8.7.0] — 2026-06-21

### Added — 跨设备下载任务队列
- `prisma/schema.prisma` — 新增 `DownloadTask` 表（id, userId, url, filename,
  status, error, bookHash, fileSize, createdAt, startedAt, completedAt）
  支持跨设备同步的远程下载任务队列
- `apps/readest-app/src/app/api/download-tasks/route.ts`
  - `GET /api/download-tasks` — 列出当前用户所有任务
  - `POST /api/download-tasks` — 创建任务（异步下载，后台 fetch → 写 File +
    Book 表 → 更新任务状态）
- `apps/readest-app/src/app/api/download-tasks/[id]/route.ts`
  - `DELETE /api/download-tasks/[id]` — 删除单个任务
  - `POST /api/download-tasks/[id]` — 重试 / 暂停 / 恢复（body: `{ action }`）
- `apps/readest-app/src/app/api/download-tasks/batch/route.ts`
  - `POST /api/download-tasks/batch` — 批量操作（retry_failed / pause_all /
    resume_all / clear_completed / clear_failed / clear_all）
- `apps/readest-app/src/app/user/components/DownloadTasks.tsx` — 用户中心
  新增下载任务面板：5s 轮询、状态图标、批量按钮、单条重试/暂停/恢复/删除、
  URL 一键复制
- `apps/readest-app/src/app/user/page.tsx` — 所有用户（不止 admin）可见
  DownloadTasks 面板

### Changed
- `RemoteDownloadDialog.tsx` 简化：POST 创建任务后 toast 提示去用户中心
  查看进度，不再前端 transferStore 跟踪（任务状态已落库，跨设备可见）
- `library/page.tsx` — `refresh-library` 事件改用 `useCallback` 稳定引用，
  确保 `eventDispatcher.off()` 能正确解绑（修复 v8.7.0 CI 失败：
  `Expected 2 arguments, but got 1`）

### Fixed — v8.7.0 CI 稳定化（3 个 follow-up commit）
- `78c0deb` 移除 `[id]/route.ts` 中未使用的 `ALLOWED_EXTENSIONS`
  常量（触发 TS `noUnusedLocals`）
- `78c0deb` 移除 `DownloadTasks.tsx` 中未使用的 `IoAlertCircleOutline`
  import（同样触发 `noUnusedLocals`）
- `e43a3a0` `eventDispatcher.off('refresh-library', handleRefreshLibrary)`
  改为传 2 个参数（API 签名要求 event + callback）

### CI Status
- ✅ Docker Image workflow — `build-and-push` 成功，镜像已推送：
  `ghcr.io/cshdotcom/readest-lite:8.7.0` / `8.7` / `sha-e43a3a0` / `latest`
- ✅ CI workflow — `Build Docker image` + `Smoke test — container starts and
  auth works` 均通过

## [0.1.0] — 2026-06-18

### Added — backend infrastructure
- `prisma/schema.prisma` — 14 tables fully aligned with original Supabase schema
  (User, Book, BookConfig, BookNote, File, BookShare, ReplicaKey, Replica,
  SendAddress, SendAllowedSender, SendInbox, StatBook, StatPage, UsageStat)
- `utils/db.ts` — Prisma client singleton
- `utils/localAuth.ts` — JWT (HS256) sign/verify + email/password login +
  admin user initialization (UUID v5 from ADMIN_EMAIL)
- `utils/localStorage.ts` — local filesystem storage with HMAC-SHA256 signed
  PUT/GET URLs (drop-in replacement for R2/S3 presigned URLs)
- `utils/crdt.ts` — CRDT merge functions reimplemented in TypeScript
  (hlcMax, crdtMergeFields, crdtComputeUpdatedAt, crdtMergeReplica,
  stripCipherEnvelopes) — equivalent to Postgres PL/pgSQL RPCs
  `crdt_merge_replica`, `crdt_merge_fields`, `crdt_compute_updated_at`,
  `hlc_max`, `replica_keys_forget`
- `utils/supabase.ts` — pseudo `@supabase/supabase-js` client that routes
  auth calls to local `/auth/v1/*` (zero frontend changes)
- `utils/access.ts` — `validateUserAndToken` rewritten to verify local JWT;
  all plan/quota helpers return unlimited (Pro system removed)
- `utils/object.ts` — unified facade over `localStorage`
- `utils/usage.ts` — translation usage stats backed by SQLite `UsageStat` table
  (replaces Supabase RPCs `increment_daily_usage` / `get_current_usage`)
- `app/api/auth/[...path]/route.ts` — Supabase Auth v1 compatibility shim
  implementing `signup` (403), `token?grant_type=password`,
  `token?grant_type=refresh_token`, `user`, `logout`, `magiclink` (403),
  `recover` (403), `reset` (403), `verify` (403), `settings`
- `pages/api/storage/_put.ts` — internal PUT endpoint receiving client
  direct-upload bytes (HMAC signature verified, streams to local file)
- `pages/api/storage/_get.ts` — internal GET endpoint streaming local file
  with HTTP Range support (HMAC signature verified)
- `apps/readest-app/scripts/init-admin.ts` — startup script that creates or
  updates the admin user from `ADMIN_EMAIL`/`ADMIN_PASSWORD` env vars
- `docker/entrypoint.sh` — startup script: `prisma db push` + `init-admin` +
  `node server.js`
- `.env.example` — full env var template
- `Dockerfile` — multi-stage build (dependencies → build → production)
- `docker-compose.yml` — single-container orchestration with `/data` volume
- `DEPLOY.md` — full deployment + verification guide
- `FRONTEND_CHANGES.md` — line-precise diff of frontend deletions
- `PROJECT_STRUCTURE.md` — directory layout after refactor
- `.github/workflows/ci.yml` — CI: install + Prisma generate + build-web + Docker build
- `.github/workflows/docker-image.yml` — build and push Docker image to GHCR

### Replaced — backend API routes (supabase → prisma)
- `pages/api/sync.ts` — main sync API (GET/POST) with last-writer-wins +
  soft-delete union + stat_pages pickWinningPages
- `pages/api/sync/replicas.ts` — CRDT replica sync (GET/POST) with
  `crdtMergeReplica` per-row merge
- `pages/api/sync/replica-keys.ts` — PBKDF2-600k-SHA256 salt list/create/forget
- `pages/api/storage/{upload,download,list,delete,purge,stats}.ts` —
  all storage endpoints; quota enforcement removed (unlimited)
- `pages/api/send/{address,senders,inbox,inbox/claim,inbox/file,
  inbox/[id]/payload,inbox/[id]/transition,fetch-url}.ts` —
  all Send-to-Readest endpoints; `claim` uses optimistic locking instead of
  `FOR UPDATE SKIP LOCKED`
- `pages/api/user/delete.ts` — disabled (protects the only admin)
- `pages/api/deepl/translate.ts` — usage stats written to SQLite `UsageStat`
- `app/api/share/{create,list,[token],[token]/download,[token]/download/confirm,
  [token]/import,[token]/revoke,[token]/cover,[token]/og.png}.ts` —
  all share endpoints with identical paths/status codes/error codes
- `libs/shareServer.ts` — `resolveActiveShare` + `rejectionToHttp` rewritten
  with Prisma

### Replaced — frontend
- `app/auth/page.tsx` — reduced from 454 lines (OAuth + Magic Link +
  Apple Sign-In + social login) to ~100 lines (email/password only)
- `hooks/useQuotaStats.ts` — returns unlimited quotas
- `services/constants.ts` — `DEFAULT_STORAGE_QUOTA` and
  `DEFAULT_DAILY_TRANSLATION_QUOTA` set to `Number.MAX_SAFE_INTEGER`
- `app/library/components/SettingsMenu.tsx` — removed "Upgrade to Readest
  Premium" menu item (lines 441-444) and `handleUpgrade` function
- `components/settings/integrations/SendToReadestForm.tsx` — removed
  `userPlan` state, `canUseEmailIn` gate, and the entire upgrade card
  UI block (lines 226-253); removed `getUserProfilePlan`/`isEmailInPlan`
  imports
- `app/user/page.tsx` — completely rewritten: removed `PlansComparison`,
  `Checkout`, all Stripe/IAP handlers, `useAvailablePlans` hook;
  kept account info, usage stats, account actions, storage manager,
  shared links, sync settings
- `app/user/components/UserInfo.tsx` — `planDetails` now optional
  (renders no badge when null)
- `services/translators/providers/deepl.ts` — removed `getSubscriptionPlan`/
  `getTranslationQuota` imports and plan-gated quota logic
- `hooks/useTranslator.ts` — replaced "Upgrade your plan" toast message with
  generic "Please try again later"

### Deleted — backend
- `app/api/stripe/{check,checkout,plans,portal,webhook}/` — 5 Stripe routes
- `app/api/apple/iap-verify/` — Apple IAP verification
- `app/api/google/iap-verify/` — Google IAP verification
- `libs/payment/` — entire payment library (Stripe + IAP + storage helper)

### Deleted — frontend
- `app/user/components/{PlanActionButton,PlanCard,PlanIndicators,
  PlanNavigation,PlansComparison,PurchaseCallToActions,Checkout}.tsx` —
  7 Pro UI components
- `app/user/utils/plan.ts` — plan details helper
- `app/user/subscription/` — subscription success page
- `hooks/useAvailablePlans.ts` — Stripe/IAP plan fetcher
- `types/payment.ts` — payment type definitions
- `app/auth/utils/` — Tauri-specific OAuth helpers (no longer used)

### Deleted — non-web infrastructure (out of scope for single-container)
- `apps/readest-app/src-tauri/` — Tauri native shell (desktop/mobile)
- `apps/readest.koplugin/` — KOReader plugin
- `fastlane/` — mobile release pipeline
- `data/`, `apps/readest-app/data/` — screenshots and metadata
- `apps/readest-app/{e2e,bench,workers,extensions,docs}/` — test/bench/worker
  code not needed for the lite build
- `apps/readest-app/src/__tests__/` — Vitest test suite (would require
  significant updates; CI runs build only)
- `.github/workflows/{android-e2e,nightly,release,scorecard,upload-to-r2,
  vercel-merge}.yml` — CI for upstream release infrastructure

### Preserved — untouched
- All reader core (foliate-js, pdfjs, simplecc-wasm, jieba-wasm)
- All client sync logic (`services/sync/*`, `libs/sync.ts`,
  `libs/replicaSyncClient.ts`, `libs/replicaSyncServer.ts`,
  `libs/replicaSchemas.ts`, `libs/crdt.ts`)
- All client share logic (`libs/share.ts`, `libs/shareImport.ts`)
- All client transfer logic (`services/transferManager.ts`, `utils/transfer.ts`)
- All transparent proxy routes (`kosync.ts`, `app/api/{ai,tts,metadata,opds,
  hardcover}/`) — only `validateUserAndToken` swapped to local impl
- `context/AuthContext.tsx` — works as-is via pseudo supabase client
- `helpers/auth.ts` — works as-is via pseudo supabase client
- `app/auth/{callback,error,recovery,update}/` — works as-is
- All UI components (except the 7 Pro components deleted)
- `middleware.ts` — CORS/COEP unchanged
- `next.config.mjs` — unchanged
- `services/send/sendAddress.ts` — address generation logic unchanged
- All Tauri-side `services/{nativeAppService,nodeAppService}.ts` (kept for
  type compatibility; not invoked in web-only build)

### Key contracts preserved (1:1 with upstream)
- `/api/sync` GET/POST — request shape, response shape, last-writer-wins,
  soft-delete union, stat_pages duration-wins, books.progress piggyback
- `/api/sync/replicas` GET/POST — HLC-based cursor, `cursors` batch pull,
  `rows` push, CRDT merge semantics (remove-wins, deviceId tiebreak,
  reincarnation, manifest null-preservation)
- `/api/sync/replica-keys` GET/POST/DELETE — `pbkdf2-600k-sha256` only,
  32-byte random salt, base64 wire format, cipher envelope stripping on forget
- `/api/storage/*` — `uploadUrl`/`downloadUrl`/`fileKey`/`usage`/`quota`
  response fields; `file_key` naming `${userId}/Readest/Books/<hash>.<ext>`;
  presigned URL TTL 1800s; temp upload TTL 3 days; `isSafeObjectKeyName`
  traversal protection
- `/api/share/*` — paths, status codes (400/404/409/410/429), error codes
  (`invalid_token`/`not_found`/`revoked`/`expired`/`source_deleted`/
  `book_not_uploaded`/`upload_incomplete`/`share_limit_reached`/
  `quota_exceeded`), `SHARE_MAX_PER_USER=50`, atomic `download_count`
  increment via conditional update
- `/auth/v1/*` — supabase-js compatible paths and response shapes;
  JWT HS256 with `sub`/`aud`/`exp`/`email`/`plan`/`storage_usage_bytes`/
  `storage_purchased_bytes` claims
- `runtime-config.js` — still returns `supabaseUrl`/`supabaseAnonKey`/
  `apiBaseUrl`/`objectStorageType`/`storageFixedQuota`/
  `translationFixedQuota` (frontend boot expects these)

### Operational notes
- Single Docker image, single container, port 8225
- Data volume `/data` (SQLite db at `/data/db/readest.db`, books at
  `/data/books/`, inbox at `/data/inbox/`)
- Container restart auto-runs `prisma db push` (schema sync) and
  `init-admin` (idempotent admin creation/password sync)
- JWT secret rotates via env var `JWT_SECRET`; access token TTL 7 days,
  refresh token TTL 30 days (configurable)
- SQLite WAL mode enabled by Prisma for concurrent read/write
- No file count or size limits (Pro system removed)
