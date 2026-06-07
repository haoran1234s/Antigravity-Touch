import { NextResponse } from 'next/server';
import { ensureCdpConnection } from '@/lib/init';
import ctx from '@/lib/context';
import { getChatHistory } from '@/lib/scraper/chat-history';
import { getActiveIdeConversation } from '@/lib/scraper/ide-conversations';
import { getBrainChatHistory } from '@/lib/brain-conversations';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await ensureCdpConnection();
  } catch { /* fall back to local brain history below */ }

  if (ctx.workbenchPage) {
    const active = await getActiveIdeConversation(ctx);
    if (active?.id || active?.title) {
      ctx.activeConversationId = active.id || ctx.activeConversationId;
      ctx.activeTitle = active.title;
      ctx.activeConversationSource = 'ide';
    }
  }

  if (ctx.activeConversationSource === 'brain' && ctx.activeConversationId) {
    const brainHistory = getBrainChatHistory(ctx.activeConversationId);
    if (brainHistory) return NextResponse.json({ ...brainHistory, source: 'brain' });
  }

  if (!ctx.workbenchPage) {
    if (ctx.activeConversationId) {
      const brainHistory = getBrainChatHistory(ctx.activeConversationId);
      if (brainHistory) return NextResponse.json({ ...brainHistory, source: 'brain' });
    }

    return NextResponse.json({
      isRunning: false,
      turnCount: 0,
      turns: [],
      source: 'none',
      error: 'Not connected to Antigravity',
    });
  }

  try {
    const history = await getChatHistory(ctx);
    return NextResponse.json(history);
  } catch (e: any) {
    if (ctx.activeConversationId) {
      const brainHistory = getBrainChatHistory(ctx.activeConversationId);
      if (brainHistory) return NextResponse.json({ ...brainHistory, source: 'brain', ideError: e.message });
    }
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
