import { NextRequest, NextResponse } from 'next/server';
import { ensureCdpConnection } from '@/lib/init';
import ctx from '@/lib/context';
import { getChatHistory } from '@/lib/scraper/chat-history';
import { getActiveIdeConversation } from '@/lib/scraper/ide-conversations';
import { getBrainChatHistory } from '@/lib/brain-conversations';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const allowIdeScroll = params.get('source') === 'ide' || params.get('allowIdeScroll') === '1';

  try {
    await ensureCdpConnection();
  } catch { /* fall back to local brain history below */ }

  if (ctx.workbenchPage) {
    try {
      const active = await getActiveIdeConversation(ctx);
      if (active?.id || active?.title) {
        ctx.activeConversationId = active.id || ctx.activeConversationId;
        ctx.activeTitle = active.title;
        ctx.activeConversationSource = active.id ? 'ide' : ctx.activeConversationSource;
      }
    } catch {
      // 只读同步失败时不回退到滚动抓取，避免影响 PC 端界面。
    }
  }

  if (ctx.activeConversationId) {
    const brainHistory = getBrainChatHistory(ctx.activeConversationId);
    if (brainHistory) {
      return NextResponse.json({
        ...brainHistory,
        source: 'brain',
        conversationTitle: ctx.activeTitle,
      });
    }
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

  if (!allowIdeScroll) {
    return NextResponse.json({
      isRunning: false,
      turnCount: 0,
      turns: [],
      source: 'none',
      conversationTitle: ctx.activeTitle,
      error: 'No brain transcript for active conversation',
    });
  }

  try {
    const history = await getChatHistory(ctx);
    return NextResponse.json({ ...history, source: 'ide' });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
