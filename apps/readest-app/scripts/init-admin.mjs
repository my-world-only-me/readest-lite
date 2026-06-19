// init-admin.mjs — 自包含的管理员初始化脚本
// 不依赖 TypeScript 源码链，直接用 PrismaClient + argon2
// 容器启动时由 entrypoint.sh 调用
import { createHash } from 'crypto';
import { randomBytes } from 'crypto';

// 动态 import（这些模块在 production 镜像的 apps/readest-app/node_modules 下）
const { PrismaClient } = await import('/app/apps/readest-app/node_modules/@prisma/client/index.js');
const argon2 = (await import('/app/apps/readest-app/node_modules/argon2/argon2.cjs')).default;

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL || 'file:/data/db/readest.db' } },
});

// UUID v5 — 基于 ADMIN_EMAIL 生成确定性 UUID
const uuidV5 = (name, namespace = '6ba7b810-9dad-11d1-80b4-00c04fd430c8') => {
  const nsBytes = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const nameBytes = Buffer.from(name, 'utf8');
  const hash = createHash('sha1').update(Buffer.concat([nsBytes, nameBytes])).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50; // version 5
  hash[8] = (hash[8] & 0x3f) | 0x80; // variant
  const hex = hash.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
};

async function main() {
  const email = (process.env.ADMIN_EMAIL || '').toLowerCase().trim();
  const password = process.env.ADMIN_PASSWORD || '';
  if (!email || !password) {
    throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD must be set');
  }

  const userId = uuidV5(email);
  const existing = await prisma.user.findUnique({ where: { id: userId } });

  if (existing) {
    // 检查密码是否变化
    let needUpdate = false;
    try {
      needUpdate = !(await argon2.verify(existing.encryptedPass, password));
    } catch {
      needUpdate = true;
    }
    if (needUpdate) {
      const encryptedPass = await argon2.hash(password);
      await prisma.user.update({
        where: { id: userId },
        data: { encryptedPass, email },
      });
      console.log(`[init] admin password updated for ${email}`);
    } else {
      console.log(`[init] admin user exists: ${email} (password unchanged)`);
    }
  } else {
    const encryptedPass = await argon2.hash(password);
    await prisma.user.create({
      data: { id: userId, email, encryptedPass },
    });
    console.log(`[init] admin user created: ${email} (${userId})`);
  }
}

try {
  await main();
} catch (e) {
  console.error('[init] failed:', e.message);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
