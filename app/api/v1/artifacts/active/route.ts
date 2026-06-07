import { NextResponse } from 'next/server';
import { ensureCdpConnection } from '@/lib/init';
import ctx from '@/lib/context';
import { getIdeArtifacts } from '@/lib/scraper/ide-artifacts';
import { getBrainArtifacts } from '@/lib/brain-conversations';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/artifacts/active — list artifacts for the active conversation.
 *
 * ONLY source: Scrapes the IDE's artifact panel for the exact list of artifacts
 * the IDE knows about for the current conversation. No brain-directory fallback.
 */
export async function GET() {
  try {
    await ensureCdpConnection();

    if (!ctx.workbenchPage) {
      const brainFiles = getBrainArtifacts(ctx.activeConversationId);
      if (brainFiles.length > 0) {
        return NextResponse.json({
          files: brainFiles,
          source: 'brain',
          conversationTitle: ctx.activeTitle,
          totalCount: brainFiles.length,
        });
      }

      return NextResponse.json({
        files: [],
        source: 'none',
        error: 'Not connected to Antigravity',
      });
    }

    const ideResult = await getIdeArtifacts(ctx);

    const files = ideResult.artifacts.map((a) => ({
      name: a.name,
      size: 0,
      mtime: a.lastUpdated || new Date().toISOString(),
      isFile: a.isFile,
      source: 'ide' as const,
    }));

    return NextResponse.json({
      files,
      source: 'ide',
      conversationTitle: ideResult.conversationTitle,
      totalCount: ideResult.totalCount,
    });
  } catch (err: any) {
    const brainFiles = getBrainArtifacts(ctx.activeConversationId);
    if (brainFiles.length > 0) {
      return NextResponse.json({
        files: brainFiles,
        source: 'brain',
        conversationTitle: ctx.activeTitle,
        totalCount: brainFiles.length,
        ideError: err.message,
      });
    }

    return NextResponse.json(
      { files: [], source: 'none', error: err.message },
      { status: 500 }
    );
  }
}
