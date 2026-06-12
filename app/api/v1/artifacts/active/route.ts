import { NextRequest, NextResponse } from 'next/server';
import { ensureCdpConnection } from '@/lib/init';
import ctx from '@/lib/context';
import { getIdeArtifacts } from '@/lib/scraper/ide-artifacts';
import { getActiveIdeConversation } from '@/lib/scraper/ide-conversations';
import { getBrainArtifacts } from '@/lib/brain-conversations';

export const dynamic = 'force-dynamic';

/** GET /api/v1/artifacts/active 非侵入读取当前对话的计划与产物。 */
export async function GET(request: NextRequest) {
  const allowIdePanel = request.nextUrl.searchParams.get('source') === 'ide';

  try {
    await ensureCdpConnection();
  } catch {
    // CDP 不可用时继续尝试读取本地 brain 目录。
  }

  if (ctx.workbenchPage) {
    try {
      const active = await getActiveIdeConversation(ctx);
      if (active?.id || active?.title) {
        ctx.activeConversationId = active.id || ctx.activeConversationId;
        ctx.activeTitle = active.title;
        ctx.activeConversationSource = active.id ? 'ide' : ctx.activeConversationSource;
      }
    } catch {
      // 只读同步失败时不点击 PC 端面板。
    }
  }

  const brainFiles = getBrainArtifacts(ctx.activeConversationId);
  if (brainFiles.length > 0) {
    return NextResponse.json({
      files: brainFiles,
      source: 'brain',
      conversationTitle: ctx.activeTitle,
      totalCount: brainFiles.length,
    });
  }

  if (!ctx.workbenchPage || !allowIdePanel) {
    return NextResponse.json({
      files: [],
      source: 'none',
      conversationTitle: ctx.activeTitle,
      totalCount: 0,
      error: ctx.workbenchPage ? 'No brain artifacts for active conversation' : 'Not connected to Antigravity',
    });
  }

  try {
    const ideResult = await getIdeArtifacts(ctx);
    const files = ideResult.artifacts.map((artifact) => ({
      name: artifact.name,
      size: 0,
      mtime: artifact.lastUpdated || new Date().toISOString(),
      isFile: artifact.isFile,
      source: 'ide' as const,
    }));

    return NextResponse.json({
      files,
      source: 'ide',
      conversationTitle: ideResult.conversationTitle,
      totalCount: ideResult.totalCount,
    });
  } catch (err: any) {
    return NextResponse.json(
      { files: [], source: 'none', error: err.message },
      { status: 500 },
    );
  }
}
