// Stub for jsonwebtoken in client bundle (web build only).
// 服务端构建使用真实 jsonwebtoken；客户端构建通过 next.config.mjs 的
// turbopack resolveAlias 把 'jsonwebtoken' 指向此文件。

export interface JwtPayload { [key: string]: unknown }

const jwt = {
  sign: (..._args: unknown[]) => '',
  verify: (..._args: unknown[]) => ({} as unknown),
  decode: (..._args: unknown[]) => ({} as unknown),
};

export default jwt;
