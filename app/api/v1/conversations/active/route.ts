import { NextResponse } from 'next/server';
import ctx from '@/lib/context';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const runtimeHomedir = (): string => eval('require')('os').homedir();
const getBrainDir = () => path.join(runtimeHomedir(), '.gemini', 'antigravity', 'brain');

function extractTitle(convDir: string): string | null {
  const taskFile = path.join(convDir, 'task.md');
  try {
    if (fs.existsSync(taskFile)) {
      const content = fs.readFileSync(taskFile, 'utf-8');
      const lines = content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('# ')) {
          return trimmed.slice(2).trim();
        }
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

function getConversationFiles(convDir: string) {
  try {
    const results: any[] = [];
    const entries = fs.readdirSync(convDir, { recursive: true, withFileTypes: true });
    for (const d of entries) {
      if (!d.isFile() || !d.name.endsWith('.md')) continue;
      
      // Node 20+ uses parentPath, older Node might use path. Fallback to convDir just in case
      // @ts-ignore
      const parentDir = d.parentPath || d.path || convDir;
      const fullPath = path.join(parentDir, d.name);
      const relPath = path.relative(convDir, fullPath).replace(/\\/g, '/');
      
      if (relPath.split('/').some(p => p.startsWith('.'))) continue;
      
      const stat = fs.statSync(fullPath);
      results.push({ name: relPath, size: stat.size, mtime: stat.mtime.toISOString() });
    }
    return results;
  } catch {
    return [];
  }
}

/**
 * Auto-detect the most recently modified conversation directory.
 * This ensures the currently opened conversation is pre-selected on first load.
 */
function autoDetectActiveConversation(): string | null {
  try {
    if (!fs.existsSync(getBrainDir())) return null;
    const entries = fs.readdirSync(getBrainDir(), { withFileTypes: true });
    let latest: { id: string; mtime: number } | null = null;

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const dirPath = path.join(getBrainDir(), entry.name);
      const stat = fs.statSync(dirPath);
      // Use the most recently modified directory
      if (!latest || stat.mtimeMs > latest.mtime) {
        latest = { id: entry.name, mtime: stat.mtimeMs };
      }
    }
    return latest?.id ?? null;
  } catch {
    return null;
  }
}

export async function GET() {
  // Auto-detect on first load if no conversation has been selected yet
  if (!ctx.activeConversationId && !ctx.activeTitle) {
    ctx.activeConversationId = autoDetectActiveConversation();
  }

  if (!ctx.activeConversationId && ctx.activeTitle) {
    return NextResponse.json({
      active: true,
      id: null,
      title: ctx.activeTitle,
      files: [],
      mtime: new Date().toISOString(),
    });
  }

  if (!ctx.activeConversationId) {
    return NextResponse.json({ active: false });
  }

  const convDir = path.join(getBrainDir(), ctx.activeConversationId);
  if (!fs.existsSync(convDir)) {
    ctx.activeConversationId = null;
    return NextResponse.json({ active: false });
  }

  const files = getConversationFiles(convDir);
  const title = extractTitle(convDir);
  // Use max file mtime; fall back to dir stat for new/empty conversations
  const latestFileMtime = files.reduce((max, f) => {
    const t = new Date(f.mtime).getTime();
    return t > max ? t : max;
  }, 0);
  const dirStat = fs.statSync(convDir);
  const mtime = new Date(latestFileMtime > 0 ? latestFileMtime : dirStat.mtimeMs).toISOString();

  return NextResponse.json({
    active: true,
    id: ctx.activeConversationId,
    title,
    files,
    mtime,
  });
}

