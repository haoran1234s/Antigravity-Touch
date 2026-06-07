import { NextRequest, NextResponse } from 'next/server';
import { ensureCdpConnection } from '@/lib/init';
import ctx from '@/lib/context';
import { startNewChat } from '@/lib/actions/new-chat';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  await ensureCdpConnection();
  if (!ctx.workbenchPage) {
    return NextResponse.json({ error: 'Not connected' }, { status: 503 });
  }

  try {
    let body: any = {};
    try { body = await request.json(); } catch { /* empty body is fine */ }
    const result = await startNewChat(ctx, {
      projectName: typeof body.projectName === 'string' ? body.projectName : undefined,
      projectPath: typeof body.projectPath === 'string' ? body.projectPath : undefined,
    });
    ctx.lastActionTimestamp = Date.now();
    if (result.success) {
      ctx.activeConversationId = null;
      ctx.activeTitle = 'New Conversation';
      ctx.activeConversationSource = 'ide';
    }
    return NextResponse.json(result, { status: result.success ? 200 : 404 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
