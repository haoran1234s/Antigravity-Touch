import { NextRequest, NextResponse } from 'next/server';
import { ensureCdpConnection } from '@/lib/init';
import ctx from '@/lib/context';
import { switchIdeConversation } from '@/lib/actions/switch-conversation';
import { getActiveIdeConversation } from '@/lib/scraper/ide-conversations';

import fs from 'fs';
import path from 'path';
import {
  brainConversationExists,
  getBrainConversation,
} from '@/lib/brain-conversations';

export const dynamic = 'force-dynamic';

const runtimeHomedir = (): string => eval('require')('os').homedir();
const getBrainDir = () => path.join(runtimeHomedir(), '.gemini', 'antigravity', 'brain');

function extractTitle(convDir: string): string | null {
  const taskFile = path.join(convDir, 'task.md');
  let title = null;
  try {
    if (fs.existsSync(taskFile)) {
      const content = fs.readFileSync(taskFile, 'utf-8');
      const lines = content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('# ')) {
          title = trimmed.slice(2).trim();
          break;
        }
      }
    }
  } catch { /* ignore */ }
  return title;
}

// Compute a simple word overlap score for fuzzy string matching
function getMatchScore(s1: string, s2: string): number {
  if (!s1 || !s2) return 0;
  const words1 = s1.toLowerCase().replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(w => w.length > 2);
  const words2 = s2.toLowerCase().replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(w => w.length > 2);
  
  if (words1.length === 0 || words2.length === 0) return 0;
  
  let matches = 0;
  for (const w of words1) {
    if (words2.includes(w)) matches++;
  }
  return matches / Math.min(words1.length, words2.length); // 0.0 to 1.0 (overlap ratio)
}

/**
 * POST /api/v1/conversations/select — switch conversation in the IDE.
 * Accepts { title: string, index?: number }
 */
export async function POST(request: NextRequest) {
  try {
    await ensureCdpConnection();
  } catch { /* local brain-history selection can still work without CDP */ }

  const body = await request.json();
  const { title, index, id, projectName, projectPath } = body;
  const targetTitle = typeof title === 'string' ? title : '';
  const targetId = typeof id === 'string' ? id : '';
  const targetProjectName = typeof projectName === 'string' ? projectName : '';
  const targetIndex = Number.isInteger(index) && index >= 0 ? index : undefined;
  if (!targetTitle && targetIndex === undefined && !targetId) {
    return NextResponse.json({ error: 'title, id or index is required' }, { status: 400 });
  }

  if (!ctx.workbenchPage) {
    if (brainConversationExists(targetId)) {
      const brainConversation = getBrainConversation(targetId);
      ctx.activeConversationId = targetId;
      ctx.activeTitle = brainConversation?.title || targetTitle || null;
      ctx.activeConversationSource = 'brain';
      return NextResponse.json({
        success: true,
        title: ctx.activeTitle,
        activeConversationId: ctx.activeConversationId,
        source: 'brain',
      });
    }

    return NextResponse.json(
      { error: 'Not connected to Antigravity and local history was not found' },
      { status: 503 }
    );
  }

  try {
    // 1. Switch the IDE UI. Brain-only history entries do not have a valid
    // IDE row index; when switching fails but the brain id exists, fall back to
    // local-history selection so mobile can still open project history.
    const success = await switchIdeConversation(ctx, targetTitle, targetIndex, {
      id: targetId,
      projectName: targetProjectName,
    });

    if (!success && brainConversationExists(targetId)) {
      const brainConversation = getBrainConversation(targetId);
      ctx.activeConversationId = targetId;
      ctx.activeTitle = brainConversation?.title || targetTitle || null;
      ctx.activeConversationSource = 'brain';
      return NextResponse.json({
        success: true,
        title: ctx.activeTitle,
        activeConversationId: ctx.activeConversationId,
        source: 'brain',
      });
    }

    // 2. Add memory cache of the selected title, in case we can't find the UUID
    const activeSnapshot = success ? await getActiveIdeConversation(ctx) : null;
    ctx.activeTitle = activeSnapshot?.title || targetTitle || null;
    ctx.activeConversationId = null; // Reset it
    ctx.activeConversationSource = null;
    if (activeSnapshot?.id) {
      ctx.activeConversationId = activeSnapshot.id;
      ctx.activeConversationSource = 'ide';
    } else if (brainConversationExists(targetId)) {
      ctx.activeConversationId = targetId;
      ctx.activeConversationSource = 'ide';
    }

    // 3. Map the title back to a brain directory so the artifact panel works
    if (!ctx.activeConversationId && targetTitle && fs.existsSync(getBrainDir())) {
        const entries = fs.readdirSync(getBrainDir(), { withFileTypes: true });
        
        let bestMatch: { id: string; score: number; mtime: number } | null = null;

        for (const entry of entries) {
            if (entry.isDirectory() && !entry.name.startsWith('.')) {
                const dirPath = path.join(getBrainDir(), entry.name);
                const convTitle = extractTitle(dirPath);
                
                if (convTitle) {
                    // Exact or substring match
                    if (convTitle === targetTitle || convTitle.includes(targetTitle) || targetTitle.includes(convTitle)) {
                        ctx.activeConversationId = entry.name;
                        ctx.activeConversationSource = 'ide';
                        break;
                    }

                    // Fuzzy match scoring
                    const score = getMatchScore(convTitle, targetTitle);
                    const mtime = fs.statSync(dirPath).mtimeMs;
                    if (score > 0 && (!bestMatch || score > bestMatch.score || (score === bestMatch.score && mtime > bestMatch.mtime))) {
                        bestMatch = { id: entry.name, score, mtime };
                    }
                }
            }
        }

        // 4. Fallback to best fuzzy match if no exact match found
        if (!ctx.activeConversationId && bestMatch && bestMatch.score >= 0.2) {
            ctx.activeConversationId = bestMatch.id;
            ctx.activeConversationSource = 'ide';
        }
    }

    if (!ctx.activeConversationSource) ctx.activeConversationSource = 'ide';

    return NextResponse.json({
      success,
      title: ctx.activeTitle,
      activeConversationId: ctx.activeConversationId,
      source: ctx.activeConversationSource,
      projectName: activeSnapshot?.projectName || targetProjectName || undefined,
      projectPath: typeof projectPath === 'string' ? projectPath : undefined,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
