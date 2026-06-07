import { NextResponse, NextRequest } from 'next/server';
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
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

/**
 * Converts a disk filename to an IDE-style human-readable artifact name.
 */
function toHumanReadableName(filename: string): string {
  let name = filename.replace(/\.\w+$/, '');
  name = name.replace(/_\d{10,}$/, '');
  name = name.replace(/[_-]/g, ' ');
  return name.split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
    .trim();
}

/**
 * Search ALL brain conversation directories for a file matching the given name.
 * Matches either exact filename OR the human-readable IDE display name.
 */
function findFileInBrain(convId: string, fileName: string): string | null {
  try {
    if (!fs.existsSync(getBrainDir())) return null;

    const searchDir = (dirPath: string): string | null => {
      if (!fs.existsSync(dirPath)) return null;
      
      const exactPath = path.join(dirPath, fileName);
      if (fs.existsSync(exactPath) && fs.statSync(exactPath).isFile()) return exactPath;
      
      const files = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const file of files) {
        if (!file.isFile()) continue;
        const fName = file.name;
        if (fName.endsWith('.metadata.json') || fName.includes('.resolved')) continue;
        
        const humanName = toHumanReadableName(fName);
        if (humanName.toLowerCase() === fileName.toLowerCase()) {
          return path.join(dirPath, fName);
        }
      }
      return null;
    };

    const sanitizedConv = convId.replace(/[^a-zA-Z0-9\-_]/g, '');
    const preferred = path.join(getBrainDir(), sanitizedConv);
    const match = searchDir(preferred);
    if (match) return match;

    const dirs = fs.readdirSync(getBrainDir(), { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => ({
        name: e.name,
        mtime: fs.statSync(path.join(getBrainDir(), e.name)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime);

    for (const dir of dirs) {
      const match = searchDir(path.join(getBrainDir(), dir.name));
      if (match) return match;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * GET /api/v1/artifacts/[convId]/[filename] — serve a specific artifact file.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ convId: string; filename: string }> }
) {
  const { convId, filename } = await params;
  
  if (filename.includes('..') || filename.startsWith('/')) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 403 });
  }

  const filePath = findFileInBrain(convId, filename);
  if (!filePath) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }

  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(getBrainDir()))) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  try {
    const ext = path.extname(resolved).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const isText = contentType.startsWith('text/') || contentType.includes('json');

    if (isText) {
      const content = fs.readFileSync(resolved, 'utf-8');
      return new Response(content, { headers: { 'Content-Type': contentType } });
    } else {
      const buffer = fs.readFileSync(resolved);
      return new Response(buffer, { headers: { 'Content-Type': contentType } });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
