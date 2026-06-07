import { NextRequest, NextResponse } from 'next/server';
import ctx from '@/lib/context';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const runtimeHomedir = (): string => eval('require')('os').homedir();
const getBrainDir = () => path.join(runtimeHomedir(), '.gemini', 'antigravity', 'brain');

const MIME_TYPES: Record<string, string> = {
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.ts': 'text/typescript; charset=utf-8',
  '.tsx': 'text/typescript; charset=utf-8',
  '.yaml': 'text/yaml; charset=utf-8',
  '.yml': 'text/yaml; charset=utf-8',
};

/**
 * Converts a disk filename to an IDE-style human-readable artifact name.
 * e.g. "artifact_panel_debug_1775942625462.webp" -> "Artifact Panel Debug"
 *      "dom_scraper_test_report.md" -> "Dom Scraper Test Report"
 */
function toHumanReadableName(filename: string): string {
  // Strip extension
  let name = filename.replace(/\.\w+$/, '');
  // Strip numeric suffix (e.g. _1775942625462)
  name = name.replace(/_\d{10,}$/, '');
  // Replace underscores and dashes with spaces
  name = name.replace(/[_-]/g, ' ');
  // Title case
  return name.split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
    .trim();
}

/**
 * Search ALL brain conversation directories for a file matching the given name.
 * Matches either exact filename OR the human-readable IDE display name.
 */
function findFileInBrain(fileName: string): string | null {
  try {
    if (!fs.existsSync(getBrainDir())) return null;
    
    const entries = fs.readdirSync(getBrainDir(), { withFileTypes: true });
    
    // Sort directories by modification time (newest first)
    const dirs = entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => ({
        name: e.name,
        mtime: fs.statSync(path.join(getBrainDir(), e.name)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime);

    // Helper to search a specific directory
    const searchDir = (dirPath: string): string | null => {
      if (!fs.existsSync(dirPath)) return null;
      
      // Exact match first
      const exactPath = path.join(dirPath, fileName);
      if (fs.existsSync(exactPath) && fs.statSync(exactPath).isFile()) return exactPath;
      
      // Fuzzy matching against human-readable name
      const files = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const file of files) {
        if (!file.isFile()) continue;
        const fName = file.name;
        // Ignore internal metadata files
        if (fName.endsWith('.metadata.json') || fName.includes('.resolved')) continue;
        
        const humanName = toHumanReadableName(fName);
        // Case-insensitive comparison just in case
        if (humanName.toLowerCase() === fileName.toLowerCase()) {
          return path.join(dirPath, fName);
        }
      }
      return null;
    };

    // If we have a preferred conversation ID, check it first
    if (ctx.activeConversationId) {
      const preferred = path.join(getBrainDir(), ctx.activeConversationId);
      const match = searchDir(preferred);
      if (match) return match;
    }

    // Otherwise search all directories
    for (const dir of dirs) {
      const dirPath = path.join(getBrainDir(), dir.name);
      const match = searchDir(dirPath);
      if (match) return match;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * GET /api/v1/artifacts/active/[filename] — serve a file from the active conversation.
 *
 * Tries to find the file in:
 * 1. The ctx.activeConversationId brain directory
 * 2. Any brain directory (fallback search, newest first)
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;

  // Security: prevent directory traversal
  if (filename.includes('..') || filename.startsWith('/')) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 403 });
  }

  const filePath = findFileInBrain(filename);
  if (!filePath) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }

  // Security: ensure resolved path is within getBrainDir()
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(getBrainDir()))) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 403 });
  }

  try {
    const ext = path.extname(resolved).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'text/plain; charset=utf-8';
    const content = fs.readFileSync(resolved, 'utf-8');
    return new NextResponse(content, {
      headers: { 'Content-Type': contentType },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
