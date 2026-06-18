// 容器启动时执行：创建/更新管理员账号（prisma db push 已在 entrypoint 完成）。
// 也可本地手动执行：pnpm --filter @readest/readest-app init-admin
import { ensureAdminUser } from '../src/utils/localAuth';
import { prismaClient } from '../src/utils/db';

async function main() {
  console.log('[init] starting database initialization...');
  await ensureAdminUser();
  console.log('[init] done.');
}

main()
  .catch((e) => {
    console.error('[init] failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prismaClient.$disconnect();
  });
