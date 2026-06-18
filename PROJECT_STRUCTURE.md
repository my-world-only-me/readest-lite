# 改造后的项目目录结构

```
readest-lite/
├── README.md                          # 项目说明
├── DEPLOY.md                          # 部署与验证文档
├── FRONTEND_CHANGES.md                # 前端改造清单（精确到行）
├── Dockerfile                         # 多阶段构建
├── docker-compose.yml                 # 单容器编排
├── .env.example                       # 环境变量样例
│
├── prisma/
│   └── schema.prisma                  # 14 张表完全对齐原 Supabase schema
│
├── docker/
│   └── entrypoint.sh                  # 启动脚本：db push + init admin + next start
│
└── apps/
    └── readest-app/
        ├── scripts/
        │   └── init-admin.ts          # 启动时创建管理员账号
        │
        └── src/
            ├── utils/                 # 【新增/替换】本地工具层
            │   ├── db.ts              # Prisma 客户端单例（替代 supabase.ts）
            │   ├── localAuth.ts       # JWT 签发/校验 + 邮箱密码登录 + 管理员初始化
            │   ├── localStorage.ts    # 本地文件系统 + HMAC 签名 URL
            │   ├── crdt.ts            # CRDT 合并函数（替代 Postgres RPC）
            │   ├── supabase.ts        # 【替换】伪 supabase-js 客户端（指向本地 /auth/v1/*）
            │   ├── access.ts          # 【替换】validateUserAndToken + 无限配额
            │   ├── object.ts          # 【替换】统一指向 localStorage
            │   └── ... (其他工具原样保留)
            │
            ├── app/
            │   └── api/
            │       ├── auth/                     # 【新增】Supabase Auth 兼容层
            │       │   └── [...path]/route.ts    #   /auth/v1/{token,user,signup,magiclink,...}
            │       ├── share/                    # 【替换】share 路由全部改用 prisma
            │       │   ├── create/route.ts
            │       │   ├── list/route.ts
            │       │   └── [token]/
            │       │       ├── route.ts
            │       │       ├── cover/route.ts
            │       │       ├── download/route.ts
            │       │       ├── download/confirm/route.ts
            │       │       ├── import/route.ts
            │       │       ├── revoke/route.ts
            │       │       └── og.png/{route.ts,render.tsx}
            │       ├── ai/                       # 【保留】透传，无改动
            │       ├── tts/                      # 【保留】透传
            │       ├── metadata/                 # 【保留】透传
            │       ├── opds/                     # 【保留】透传
            │       ├── hardcover/                # 【保留】透传
            │       # ── 已删除 ──
            │       # stripe/{check,checkout,plans,portal,webhook}
            │       # apple/iap-verify, google/iap-verify
            │
            ├── pages/api/              # Pages Router 路由
            │   ├── sync.ts             # 【替换】主同步 API
            │   ├── sync/
            │   │   ├── replicas.ts     # 【替换】CRDT 副本同步
            │   │   └── replica-keys.ts # 【替换】副本加密盐
            │   ├── storage/
            │   │   ├── upload.ts       # 【替换】
            │   │   ├── download.ts     # 【替换】
            │   │   ├── list.ts         # 【替换】
            │   │   ├── delete.ts       # 【替换】
            │   │   ├── purge.ts        # 【替换】
            │   │   ├── stats.ts        # 【替换】
            │   │   ├── _put.ts         # 【新增】内部 PUT 端点
            │   │   └── _get.ts         # 【新增】内部 GET 端点（支持 Range）
            │   ├── send/               # 【替换】全部
            │   │   ├── address.ts
            │   │   ├── senders.ts
            │   │   ├── fetch-url.ts
            │   │   └── inbox/
            │   │       ├── file.ts
            │   │       ├── claim.ts
            │   │       └── [id]/
            │   │           ├── payload.ts
            │   │           └── transition.ts
            │   ├── user/delete.ts      # 【替换】禁用删除（保护管理员）
            │   ├── deepl/translate.ts  # 【替换】用量统计走 SQLite
            │   └── kosync.ts           # 【保留】透传 KOReader 代理
            │
            ├── libs/
            │   ├── shareServer.ts      # 【替换】supabase → prisma
            │   ├── sync.ts             # 【保留】客户端 SyncClient
            │   ├── replicaSyncServer.ts # 【保留】校验逻辑
            │   ├── replicaSchemas.ts   # 【保留】zod schema
            │   ├── replicaSyncClient.ts # 【保留】
            │   ├── share.ts            # 【保留】客户端 share API
            │   # ── 已删除 ──
            │   # payment/ 整个目录
            │
            ├── context/AuthContext.tsx # 【保留】supabase-js 已替换为本地实现
            ├── app/auth/page.tsx       # 【替换】简化为邮箱密码登录
            ├── app/user/               # 【删除 Pro 组件】详见 FRONTEND_CHANGES.md
            ├── services/constants.ts   # 【修改】配额常量改为无限
            ├── hooks/useQuotaStats.ts  # 【替换】返回无限配额
            └── ... (其他全部原样保留)
```

## 关键改动统计

| 类别 | 数量 | 说明 |
|---|---|---|
| 新增文件 | 11 | db.ts / localAuth.ts / localStorage.ts / crdt.ts / auth/[...path]/route.ts / storage/_put.ts / storage/_get.ts / scripts/init-admin.ts / Dockerfile / docker-compose.yml / .env.example |
| 替换文件 | 22 | supabase.ts / access.ts / object.ts / sync.ts / sync/replicas.ts / sync/replica-keys.ts / 6 个 storage 路由 / 8 个 share 路由 / shareServer.ts / send/* / user/delete.ts / deepl/translate.ts / useQuotaStats.ts / constants.ts / auth/page.tsx |
| 删除文件 | 17 | 5 个 stripe 路由 + 2 个 IAP 路由 + 7 个 Pro 组件 + plan.ts + payment/ 目录 + types/payment.ts |
| 保留文件 | 1000+ | 阅读器内核、foliate-js、Tauri 壳、所有 UI 组件（除 Pro）、所有客户端同步逻辑 |
