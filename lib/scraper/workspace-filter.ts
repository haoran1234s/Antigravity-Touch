/**
 * Workspace-based conversation filtering.
 * 
 * Extracts the workspace/project path from the active IDE window title,
 * then scans brain conversation artifacts for matching file references.
 * Results are cached in-memory with mtime-based invalidation.
 */

import fs from 'fs';
import path from 'path';
import { logger } from '../logger';

const runtimeHomedir = (): string => eval('require')('os').homedir();
const getBrainDir = () => path.join(runtimeHomedir(), '.gemini', 'antigravity', 'brain');

// Cache: conversationId → { workspace paths found, mtime of latest artifact }
interface CacheEntry {
  workspacePaths: string[];  // project folder names found in this conversation's artifacts
  latestMtime: number;       // latest artifact mtime at time of scan
}

const cache = new Map<string, CacheEntry>();

// Common file path patterns in .md artifacts (absolute paths on Linux/macOS/Windows)
const FILE_PATH_REGEX = /(?:\/(?:home|Users|root|tmp|var|opt|etc)\/[^\s),`'">\]]+)|(?:[A-Z]:\\[^\s),`'">\]]+)/g;

/**
 * Extract the workspace/project name from the IDE window title.
 * Antigravity window titles typically look like:
 *   "project_name - Antigravity"
 *   "file.ts - project_name - Antigravity"
 * We extract the folder/project name part.
 */
export function extractProjectFromWindowTitle(windowTitle: string | undefined): string | null {
  if (!windowTitle) return null;

  const parts = windowTitle.split(' - ').map(p => p.trim());
  // The project name is typically the second-to-last segment before "Antigravity"
  // or the first segment if there are only 2 parts
  if (parts.length >= 2) {
    // Find the part that looks like a project name (not "Antigravity" and not a file name)
    for (let i = parts.length - 2; i >= 0; i--) {
      const part = parts[i];
      // Skip if it looks like a filename with extension
      if (part.includes('.') && !part.includes('/') && !part.includes('\\')) continue;
      // Skip "Antigravity" itself
      if (part.toLowerCase() === 'antigravity') continue;
      return part;
    }
  }

  return null;
}

/**
 * Scan a brain conversation directory's artifacts for file paths,
 * and extract unique project/workspace folder names from them.
 */
function scanConversationForWorkspaces(convId: string): string[] {
  const convDir = path.join(getBrainDir(), convId);
  const workspaces = new Set<string>();

  try {
    const entries = fs.readdirSync(convDir, { recursive: true, withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;

      // Skip hidden directories
      // @ts-ignore - Node 20+ parentPath
      const parentDir = entry.parentPath || entry.path || convDir;
      const fullPath = path.join(parentDir, entry.name);
      const relPath = path.relative(convDir, fullPath);
      if (relPath.split(/[\/\\]/).some((p: string) => p.startsWith('.'))) continue;

      try {
        // Read only first 5KB of each file to keep it fast
        const fd = fs.openSync(fullPath, 'r');
        const buffer = Buffer.alloc(5120);
        const bytesRead = fs.readSync(fd, buffer, 0, 5120, 0);
        fs.closeSync(fd);

        const content = buffer.toString('utf-8', 0, bytesRead);

        // Extract file paths and identify project folders
        const matches = content.matchAll(FILE_PATH_REGEX);
        for (const match of matches) {
          const filePath = match[0];
          // Extract meaningful path segments — look for common project root patterns
          // e.g., /home/user/repos/project_name/... → "project_name"
          // e.g., C:\Users\user\repos\project_name\... → "project_name"
          // Normalize backslashes to forward slashes for consistent parsing
          const normalizedPath = filePath.replace(/\\/g, '/');
          const segments = normalizedPath.split('/').filter(Boolean);
          // Strip drive letter (e.g. "C:" → skip it)
          if (segments.length > 0 && /^[A-Z]:$/i.test(segments[0])) {
            segments.shift();
          }
          // Find segments after common parent dirs (home/username, repos, projects, etc.)
          for (let i = 0; i < segments.length - 1; i++) {
            const seg = segments[i];
            if (['home', 'Users', 'root', 'repos', 'projects', 'src', 'dev', 'work', 'code'].includes(seg)) {
              // The next non-username segment is likely a project name
              const candidate = segments[i + 1];
              if (candidate && !['repos', 'projects', 'src', 'dev', 'work', 'code', '.config', '.local', '.gemini'].includes(candidate)) {
                // If this segment is after 'home', it's likely the username, skip one more
                if (seg === 'home' || seg === 'Users') {
                  const projectCandidate = segments[i + 2];
                  if (projectCandidate && !['repos', 'projects', 'src', 'dev', 'work', 'code', '.config', '.local', '.gemini', '.cache'].includes(projectCandidate)) {
                    workspaces.add(projectCandidate);
                  } else if (segments[i + 3]) {
                    workspaces.add(segments[i + 3]);
                  }
                } else {
                  workspaces.add(candidate);
                }
              }
            }
          }
        }
      } catch {
        // Skip unreadable files
      }
    }
  } catch {
    // Directory doesn't exist or is unreadable
  }

  return Array.from(workspaces);
}

/**
 * Get the latest mtime for artifacts in a conversation directory.
 */
function getLatestMtime(convId: string): number {
  const convDir = path.join(getBrainDir(), convId);
  let latest = 0;
  try {
    const entries = fs.readdirSync(convDir, { recursive: true, withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      // @ts-ignore
      const parentDir = entry.parentPath || entry.path || convDir;
      const fullPath = path.join(parentDir, entry.name);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.mtimeMs > latest) latest = stat.mtimeMs;
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return latest;
}

/**
 * Get workspace paths for a conversation, using cache when possible.
 */
function getWorkspacesForConversation(convId: string): string[] {
  const currentMtime = getLatestMtime(convId);
  const cached = cache.get(convId);

  if (cached && cached.latestMtime >= currentMtime) {
    return cached.workspacePaths;
  }

  const workspacePaths = scanConversationForWorkspaces(convId);
  cache.set(convId, { workspacePaths, latestMtime: currentMtime });
  return workspacePaths;
}

/**
 * Filter conversations to only include those related to the current project/workspace.
 * 
 * @param conversations - Full list of conversations with brain IDs
 * @param windowTitle - The active IDE window title (e.g., "ide_agent - Antigravity")
 * @returns Filtered list — conversations matching the current project + the active conversation
 */
export function filterConversationsByWorkspace<T extends { id: string; active?: boolean; title: string }>(
  conversations: T[],
  windowTitle: string | undefined
): T[] {
  const projectName = extractProjectFromWindowTitle(windowTitle);

  if (!projectName) {
    logger.info('[WorkspaceFilter] Could not extract project name from window title, returning all conversations.');
    return conversations;
  }

  logger.info(`[WorkspaceFilter] Filtering conversations for project: "${projectName}"`);

  const filtered = conversations.filter((conv) => {
    // Always include the active conversation
    if (conv.active) return true;

    // If we don't have a valid brain ID, we can't check artifacts — include it as a fallback
    if (!conv.id || conv.id === '-1' || /^\d+$/.test(conv.id)) return true;

    // Check if this conversation's artifacts reference the current project
    const workspaces = getWorkspacesForConversation(conv.id);
    const matches = workspaces.some(ws =>
      ws.toLowerCase() === projectName.toLowerCase() ||
      ws.toLowerCase().includes(projectName.toLowerCase()) ||
      projectName.toLowerCase().includes(ws.toLowerCase())
    );

    return matches;
  });

  logger.info(`[WorkspaceFilter] ${filtered.length}/${conversations.length} conversations match project "${projectName}"`);
  return filtered;
}
