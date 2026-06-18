// Stub for argon2 in client bundle (web build only).
// 服务端构建使用真实 argon2；客户端构建通过 next.config.mjs 的
// turbopack resolveAlias 把 'argon2' 指向此文件。

const argon2 = {
  hash: (..._args: unknown[]) => Promise.resolve('argon2-stub-hash'),
  verify: (..._args: unknown[]) => Promise.resolve(true),
  defaults: {},
  argon2id: 2,
  argon2i: 1,
  argon2d: 0,
};

export default argon2;
