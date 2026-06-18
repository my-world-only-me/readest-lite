// Stub for @prisma/client in client bundle (web build only).
// 服务端构建使用真实 @prisma/client；客户端构建通过 next.config.mjs 的
// turbopack resolveAlias 把 '@prisma/client' 指向此文件。

export class PrismaClient {
  constructor(..._args: unknown[]) {}
  $connect(): Promise<void> { return Promise.resolve(); }
  $disconnect(): Promise<void> { return Promise.resolve(); }
  [key: string]: unknown;
}

export const Prisma = {} as unknown;
