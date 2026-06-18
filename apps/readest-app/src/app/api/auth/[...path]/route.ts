// Supabase Auth v1 兼容路由。
// 实现前端 supabase-js (utils/supabase.ts LocalSupabaseClient) 真正打到的端点：
//   POST /auth/v1/signup                    → 403 注册关闭
//   POST /auth/v1/token?grant_type=password → 邮箱密码登录
//   POST /auth/v1/token?grant_type=refresh_token → 刷新
//   GET  /auth/v1/user                      → 获取当前用户
//   POST /auth/v1/logout                    → 登出
//   POST /auth/v1/magiclink                 → 403 禁用
//   POST /auth/v1/recover                   → 403 禁用
//   POST /auth/v1/reset                     → 403 禁用
//   GET  /auth/v1/verify                    → 403 禁用
//   GET  /auth/v1/settings                  → 返回最小配置
import { NextRequest, NextResponse } from 'next/server';
import { signInWithPassword, refreshSession, verifyAccessToken } from '@/utils/localAuth';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  NextResponse.json(body, {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', ...extra },
  });

const disabled = (msg: string) =>
  json(
    {
      code: 403,
      error_code: 'signup_disabled',
      msg,
      error_description: msg,
    },
    403,
  );

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const segments = path.join('/');
  const url = new URL(req.url);
  const grantType = url.searchParams.get('grant_type');

  if (segments === 'token' && grantType === 'password') {
    let body: { email?: string; password?: string };
    try {
      body = (await req.json()) as { email?: string; password?: string };
    } catch {
      return json({ error_description: 'Invalid JSON' }, 400);
    }
    if (!body.email || !body.password) {
      return json({ error_description: 'email and password required' }, 400);
    }
    try {
      const session = await signInWithPassword(body.email, body.password);
      return json(session, 200);
    } catch (err) {
      return json(
        { error_description: err instanceof Error ? err.message : 'login failed' },
        400,
      );
    }
  }

  if (segments === 'token' && grantType === 'refresh_token') {
    let body: { refresh_token?: string };
    try {
      body = (await req.json()) as { refresh_token?: string };
    } catch {
      return json({ error_description: 'Invalid JSON' }, 400);
    }
    if (!body.refresh_token) {
      return json({ error_description: 'refresh_token required' }, 400);
    }
    const session = await refreshSession(body.refresh_token);
    if (!session) {
      return json({ error_description: 'invalid refresh token' }, 400);
    }
    return json(session, 200);
  }

  if (segments === 'signup') return disabled('Sign-up is disabled.');
  if (segments === 'magiclink') return disabled('Magic link is disabled.');
  if (segments === 'recover') return disabled('Password recovery is disabled.');
  if (segments === 'reset') return disabled('Password reset is disabled.');
  if (segments === 'logout') return new NextResponse(null, { status: 204, headers: CORS });

  return json({ error_description: `Unsupported auth endpoint: ${segments}` }, 404);
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const segments = path.join('/');

  if (segments === 'user') {
    const auth = req.headers.get('authorization') ?? '';
    const token = auth.replace(/^Bearer\s+/i, '');
    const user = verifyAccessToken(token);
    if (!user) return json({ user: null, error: 'invalid token' }, 401);
    return json({ user, app_metadata: {}, user_metadata: {} }, 200);
  }

  if (segments === 'settings') {
    return json(
      {
        external: { email: false, phone: false },
        disable_signup: true,
        mailer_autoconfirm: false,
        phone_confirm: false,
        sms_confirm_change: false,
      },
      200,
    );
  }

  if (segments === 'verify') return disabled('Email verification is disabled.');

  return json({ error_description: `Unsupported auth endpoint: ${segments}` }, 404);
}
