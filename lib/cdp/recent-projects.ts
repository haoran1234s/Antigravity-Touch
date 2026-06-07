/**
 * Recent Projects Reader (Cross-Platform)
 * 
 * Reads Antigravity's workspaceStorage to discover recently opened projects.
 * Each workspace entry is stored as a subdirectory containing a workspace.json
 * with the folder URI.
 * 
 * Config paths by OS:
 *   Linux:   ~/.config/Antigravity/User/workspaceStorage/
 *   macOS:   ~/Library/Application Support/Antigravity/User/workspaceStorage/
 *   Windows: %APPDATA%/Antigravity/User/workspaceStorage/
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import { logger } from '../logger';

export interface RecentProject {
  /** Absolute filesystem path to the project directory */
  path: string;
  /** Short display name (last segment of the path) */
  name: string;
  /** ISO timestamp of last time this workspace was active */
  lastOpened: string;
}

/**
 * Runtime platform accessor — defeats Turbopack/Next.js static Dead Code
 * Elimination which evaluates process.platform at BUILD time and strips
 * branches for other OSes.  String concatenation forces runtime resolution.
 * (Same technique used in process-manager.ts)
 */
const getRuntimePlatform = (): string => {
  if (typeof process === 'undefined') return 'unknown';
  const p = 'plat';
  const f = 'form';
  return (process as any)[p + f] || 'unknown';
};

/**
 * Resolve the Antigravity workspaceStorage directory based on the OS.
 *
 * Uses a resolver-map with a runtime-resolved key so Turbopack cannot
 * dead-code-eliminate any platform branch at build time.
 */
function getWorkspaceStoragePath(): string {
  const home = homedir();
  const platform = getRuntimePlatform();

  const resolvers: Record<string, () => string> = {
    win32:  () => join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'Antigravity', 'User', 'workspaceStorage'),
    darwin: () => join(home, 'Library', 'Application Support', 'Antigravity', 'User', 'workspaceStorage'),
    linux:  () => join(process.env.XDG_CONFIG_HOME || join(home, '.config'), 'Antigravity', 'User', 'workspaceStorage'),
  };

  const resolve = resolvers[platform] || resolvers.linux;
  return resolve();
}

/**
 * Read all workspace entries and return recent projects sorted by last-opened (desc).
 * 
 * Filters out:
 *  - Remote workspaces (vscode-remote://)
 *  - Playground directories (/.gemini/antigravity/playground/)
 *  - Directories that no longer exist on disk
 */
export function getRecentProjects(limit: number = 15): RecentProject[] {
  const storagePath = getWorkspaceStoragePath();

  if (!existsSync(storagePath)) {
    logger.warn(`[RecentProjects] Workspace storage not found at: ${storagePath}`);
    return [];
  }

  const entries: RecentProject[] = [];

  try {
    const dirs = readdirSync(storagePath, { withFileTypes: true });

    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;

      const wsJsonPath = join(storagePath, dir.name, 'workspace.json');
      if (!existsSync(wsJsonPath)) continue;

      try {
        const raw = readFileSync(wsJsonPath, 'utf-8');
        const data = JSON.parse(raw);
        const folderUri: string | undefined = data.folder;

        if (!folderUri) continue;

        // Skip remote workspaces
        if (folderUri.startsWith('vscode-remote://')) continue;

        // Extract the filesystem path from file:// URI
        let fsPath: string;
        if (folderUri.startsWith('file://')) {
          fsPath = decodeURIComponent(new URL(folderUri).pathname);
          // Strip leading / from Windows-style drive paths like /C:/Users/...
          // Uses a regex test instead of process.platform check to avoid
          // Turbopack DCE (and because this pattern only appears in Windows URIs).
          if (/^\/[A-Za-z]:/.test(fsPath)) {
            fsPath = fsPath.substring(1);
          }
        } else {
          fsPath = folderUri;
        }

        // Skip playground and proxy build-output directories. The standalone
        // server runs with cwd `.next/standalone`; if Antigravity records that
        // as a recent workspace, auto-recovery can reopen the build directory
        // and lock `.next/standalone`, breaking future rebuilds on Windows.
        if (fsPath.includes('/playground/') || fsPath.includes('\\playground\\')) continue;
        if (fsPath.includes('/.next/standalone') || fsPath.includes('\\.next\\standalone')) continue;

        // Skip directories that no longer exist
        try {
          const s = statSync(fsPath);
          if (!s.isDirectory()) continue;
        } catch {
          continue; // Directory doesn't exist anymore
        }

        // Use the workspace storage directory's mtime as lastOpened
        const dirPath = join(storagePath, dir.name);
        const dirStat = statSync(dirPath);

        entries.push({
          path: fsPath,
          name: basename(fsPath),
          lastOpened: dirStat.mtime.toISOString(),
        });
      } catch {
        // Skip malformed workspace.json files
      }
    }
  } catch (e: any) {
    logger.error(`[RecentProjects] Failed to read workspace storage: ${e.message}`);
    return [];
  }

  // Sort by lastOpened descending (most recent first)
  entries.sort((a, b) => new Date(b.lastOpened).getTime() - new Date(a.lastOpened).getTime());

  // Deduplicate by path (keep the most recent entry)
  const seen = new Set<string>();
  const deduped: RecentProject[] = [];
  for (const entry of entries) {
    if (!seen.has(entry.path)) {
      seen.add(entry.path);
      deduped.push(entry);
    }
  }

  return deduped.slice(0, limit);
}
