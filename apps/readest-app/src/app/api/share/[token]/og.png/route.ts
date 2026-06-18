// 改造自原 src/app/api/share/[token]/og.png/route.ts
import { renderShareOgImage } from './render';

interface RouteParams { params: Promise<{ token: string }> }

export async function GET(_request: Request, { params }: RouteParams) {
  const { token } = await params;
  return renderShareOgImage(token);
}
