// 改造自原 src/pages/api/sync/replica-keys.ts。
// 替代 Postgres RPC replica_keys_list / replica_keys_create / replica_keys_forget。
import type { NextApiRequest, NextApiResponse } from 'next';
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID, randomBytes } from 'crypto';
import { prismaClient } from '@/utils/db';
import { validateUserAndToken } from '@/utils/access';
import { runMiddleware, corsAllMethods } from '@/utils/cors';
import { stripCipherEnvelopes } from '@/utils/crdt';

const SUPPORTED_ALGS = new Set<string>(['pbkdf2-600k-sha256']);

interface ReplicaKeyResponseRow {
  saltId: string;
  alg: string;
  salt: string; // base64
  createdAt: string;
}

const errorResponse = (status: number, code: string, message: string) =>
  NextResponse.json({ error: message, code }, { status });

const toResponseRow = (r: { saltId: string; alg: string; salt: Buffer; createdAt: Date }): ReplicaKeyResponseRow => ({
  saltId: r.saltId,
  alg: r.alg,
  salt: r.salt.toString('base64'),
  createdAt: r.createdAt.toISOString(),
});

export async function GET(req: NextRequest) {
  const { user, token } = await validateUserAndToken(req.headers.get('authorization'));
  if (!user || !token) return errorResponse(401, 'AUTH', 'Not authenticated');
  const rows = await prismaClient.replicaKey.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' as const },
  });
  return NextResponse.json({ rows: rows.map(toResponseRow) }, { status: 200 });
}

export async function POST(req: NextRequest) {
  const { user, token } = await validateUserAndToken(req.headers.get('authorization'));
  if (!user || !token) return errorResponse(401, 'AUTH', 'Not authenticated');

  let body: unknown;
  try { body = await req.json(); } catch { return errorResponse(400, 'VALIDATION', 'Invalid JSON body'); }
  const alg = typeof body === 'object' && body !== null && 'alg' in body ? (body as { alg: unknown }).alg : undefined;
  if (typeof alg !== 'string' || !SUPPORTED_ALGS.has(alg)) {
    return errorResponse(422, 'UNSUPPORTED_ALG', `Unsupported alg: ${String(alg)}`);
  }

  const saltId = randomUUID();
  const salt = randomBytes(32);
  const created = await prismaClient.replicaKey.create({
    data: { userId: user.id, saltId, alg, salt },
  });
  return NextResponse.json({ row: toResponseRow(created) }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const { user, token } = await validateUserAndToken(req.headers.get('authorization'));
  if (!user || !token) return errorResponse(401, 'AUTH', 'Not authenticated');

  // 剥离 cipher envelope + 删除所有 salt
  const replicas = await prismaClient.replica.findMany({ where: { userId: user.id } });
  for (const r of replicas) {
    const fields = JSON.parse(r.fieldsJsonb || '{}');
    const stripped = stripCipherEnvelopes(fields);
    if (Object.keys(stripped).length !== Object.keys(fields).length) {
      await prismaClient.replica.update({
        where: { userId_kind_replicaId: { userId: user.id, kind: r.kind, replicaId: r.replicaId } },
        data: { fieldsJsonb: JSON.stringify(stripped), modifiedAt: new Date() },
      });
    }
  }
  await prismaClient.replicaKey.deleteMany({ where: { userId: user.id } });
  return NextResponse.json({ ok: true }, { status: 200 });
}

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (!req.url) return res.status(400).json({ error: 'Invalid request URL' });
  const protocol = process.env['PROTOCOL'] || 'http';
  const host = process.env['HOST'] || 'localhost:3000';
  const url = new URL(req.url, `${protocol}://${host}`);
  await runMiddleware(req, res, corsAllMethods);
  try {
    let response: Response;
    if (req.method === 'GET') {
      response = await GET(new NextRequest(url.toString(), { headers: new Headers(req.headers as Record<string, string>), method: 'GET' }));
    } else if (req.method === 'POST') {
      response = await POST(new NextRequest(url.toString(), { headers: new Headers(req.headers as Record<string, string>), method: 'POST', body: JSON.stringify(req.body) }));
    } else if (req.method === 'DELETE') {
      response = await DELETE(new NextRequest(url.toString(), { headers: new Headers(req.headers as Record<string, string>), method: 'DELETE' }));
    } else {
      res.setHeader('Allow', ['GET', 'POST', 'DELETE']);
      return res.status(405).json({ error: 'Method Not Allowed' });
    }
    res.status(response.status);
    response.headers.forEach((v, k) => res.setHeader(k, v));
    res.send(Buffer.from(await response.arrayBuffer()));
  } catch (e) {
    console.error('Error /api/sync/replica-keys:', e);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};
export default handler;
