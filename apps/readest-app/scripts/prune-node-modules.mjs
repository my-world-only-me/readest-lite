#!/usr/bin/env node
/**
 * Create a flat pruned node_modules for Docker production.
 *
 * Walks the full transitive dependency tree starting from package.json's
 * production dependencies, resolves each to its .pnpm store entry,
 * and copies all files (dereferenced) into a flat node_modules/ directory.
 *
 * Usage (from apps/readest-app/):
 *   node scripts/prune-node-modules.mjs <outDir>
 */

import { mkdir, readFile, rm, symlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const outDir = process.argv[2];
if (!outDir) {
  console.error('Usage: node scripts/prune-node-modules.mjs <outDir>');
  process.exit(1);
}

const APP_DIR = process.cwd();
const ROOT_NM = path.resolve(APP_DIR, '..', '..', 'node_modules');
const PNPM_STORE = path.join(ROOT_NM, '.pnpm');
const NM_DIR = path.join(APP_DIR, 'node_modules');
const OUT_NM = path.join(outDir, 'node_modules');

// ── 1. Read package.json — keep only production deps ────────────────────────
const pkgJson = JSON.parse(await readFile(path.join(APP_DIR, 'package.json'), 'utf-8'));
const prodDeps = new Set(Object.keys(pkgJson.dependencies || {}));
// These are always needed at runtime even if listed as dev
['next', 'react', 'react-dom', 'prisma', '@prisma/client', 'argon2', 'jsonwebtoken']
  .forEach(d => prodDeps.add(d));

console.log(`[prune] Production deps: ${prodDeps.size}`);

// ── 2. Resolve pnpm symlinks ────────────────────────────────────────────────
function resolveReal(pkgName) {
  try {
    const linkPath = path.join(NM_DIR, ...pkgName.split('/'));
    if (!existsSync(linkPath)) return null;
    const target = execSync(`readlink -f "${linkPath}"`, { encoding: 'utf-8' }).trim();
    return existsSync(target) ? target : null;
  } catch {
    return null;
  }
}

// ── 3. Walk full transitive dep tree ────────────────────────────────────────
const resolved = new Map(); // pkgName -> realPath
const queue = [...prodDeps];
let maxPackages = 8000; // safety limit

while (queue.length > 0 && maxPackages-- > 0) {
  const pkg = queue.shift();
  if (resolved.has(pkg)) continue;

  let real = resolveReal(pkg);
  if (!real) {
    // Maybe it's an optional peer dep that wasn't installed
    continue;
  }
  resolved.set(pkg, real);

  // Read its package.json to find transitive deps
  const pkgJsonPath = path.join(real, 'package.json');
  if (!existsSync(pkgJsonPath)) continue;
  try {
    const pj = JSON.parse(await readFile(pkgJsonPath, 'utf-8'));
    const deps = { ...(pj.dependencies || {}), ...(pj.peerDependencies || {}) };
    // Skip certain peer deps known to cause infinite loops
    const skip = ['react', 'react-dom', 'next', 'prisma'];
    for (const dep of Object.keys(deps)) {
      if (!resolved.has(dep) && !skip.includes(dep)) {
        queue.push(dep);
      }
    }
  } catch {}
}

console.log(`[prune] Resolved ${resolved.size} packages`);

// ── 4. Also include .prisma (generated client) ──────────────────────────────
const dotPrisma = path.join(NM_DIR, '.prisma');
if (existsSync(dotPrisma)) {
  resolved.set('.prisma', dotPrisma);
}

// ── 5. Copy all packages to flat output ─────────────────────────────────────
await mkdir(OUT_NM, { recursive: true });
let count = 0;

for (const [pkgName, realPath] of resolved) {
  const outPkg = path.join(OUT_NM, ...pkgName.split('/'));
  await mkdir(path.dirname(outPkg), { recursive: true });

  // cp -rL: dereference pnpm symlinks so the result is self-contained
  execSync(`cp -rL "${realPath}" "${outPkg}"`, { stdio: 'pipe' });
  count++;

  // Strip test/docs/cache from copied package
  for (const dir of ['test','tests','__tests__','docs','doc','example','examples',
                     'benchmark','benchmarks','.github','.git']) {
    const d = path.join(outPkg, dir);
    if (existsSync(d)) rm(d, { recursive: true, force: true }).catch(() => {});
  }
  execSync(
    `find "${outPkg}" -type f \\( -name "*.ts" -o -name "*.tsx" -o -name "*.map" ` +
    `-o -name "CHANGELOG*" -o -name "README*" -o -name "LICENSE*" ` +
    `-o -name "CONTRIBUTING*" \\) -delete 2>/dev/null || true`,
    { stdio: 'pipe' },
  );
}

const size = execSync(`du -sh "${outDir}"`, { encoding: 'utf-8' }).trim();
console.log(`[prune] Done. ${count} packages. Size: ${size}`);
