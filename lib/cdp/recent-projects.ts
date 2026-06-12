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

import { logger } from '../logger';

type RuntimeFs = typeof import('fs');
type RuntimePath = typeof import('path');
type RuntimeOs = typeof import('os');

const getRuntimeFs = (): RuntimeFs => eval('require')('fs');
const getRuntimePath = (): RuntimePath => eval('require')('path');
const getRuntimeOs = (): RuntimeOs => eval('require')('os');

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

const getRuntimeEnv = (): NodeJS.ProcessEnv => {
  const proc = eval('process') as typeof process;
  return proc?.env || {};
};

function compactUnique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

/**
 * 解析可能的 Antigravity 工作区历史目录。
 *
 * 同一台 Windows 机器上可能同时存在 `Antigravity` 和 `Antigravity IDE`
 * 配置目录；移动端项目列表必须跟 PC 左侧项目来源保持一致，所以这里读取
 * 所有候选 workspaceStorage，再按真实 mtime 合并排序。
 */
function getWorkspaceStoragePaths(): string[] {
  const { join } = getRuntimePath();
  const home = getRuntimeOs().homedir();
  const platform = getRuntimePlatform();
  const env = getRuntimeEnv();
  const appData = env.APPDATA || join(home, 'AppData', 'Roaming');
  const localAppData = env.LOCALAPPDATA || join(home, 'AppData', 'Local');
  const xdgConfig = env.XDG_CONFIG_HOME || join(home, '.config');

  const resolvers: Record<string, () => string[]> = {
    win32: () => [
      join(appData, 'Antigravity IDE', 'User', 'workspaceStorage'),
      join(appData, 'Antigravity', 'User', 'workspaceStorage'),
      join(localAppData, 'Google', 'Antigravity', 'User', 'workspaceStorage'),
      join(localAppData, 'Google', 'Antigravity', 'User Data', 'Default', 'workspaceStorage'),
    ],
    darwin: () => [
      join(home, 'Library', 'Application Support', 'Antigravity IDE', 'User', 'workspaceStorage'),
      join(home, 'Library', 'Application Support', 'Antigravity', 'User', 'workspaceStorage'),
    ],
    linux: () => [
      join(xdgConfig, 'Antigravity IDE', 'User', 'workspaceStorage'),
      join(xdgConfig, 'Antigravity', 'User', 'workspaceStorage'),
    ],
  };

  const resolve = resolvers[platform] || resolvers.linux;
  return compactUnique(resolve());
}

function readWorkspaceProject(storagePath: string, dirName: string): RecentProject | null {
  const { existsSync, readFileSync, statSync } = getRuntimeFs();
  const { basename, join } = getRuntimePath();
  const wsJsonPath = join(storagePath, dirName, 'workspace.json');
  if (!existsSync(wsJsonPath)) return null;

  try {
    const raw = readFileSync(wsJsonPath, 'utf-8');
    const data = JSON.parse(raw);
    const folderUri: string | undefined = data.folder;

    if (!folderUri || folderUri.startsWith('vscode-remote://')) return null;

    let fsPath: string;
    if (folderUri.startsWith('file://')) {
      fsPath = decodeURIComponent(new URL(folderUri).pathname);
      if (/^\/[A-Za-z]:/.test(fsPath)) {
        fsPath = fsPath.substring(1);
      }
    } else {
      fsPath = folderUri;
    }

    if (fsPath.includes('/playground/') || fsPath.includes('\\playground\\')) return null;
    if (fsPath.includes('/.next/standalone') || fsPath.includes('\\.next\\standalone')) return null;

    const targetStat = statSync(fsPath);
    if (!targetStat.isDirectory()) return null;

    const dirPath = join(storagePath, dirName);
    const dirStat = statSync(dirPath);

    return {
      path: fsPath,
      name: basename(fsPath),
      lastOpened: dirStat.mtime.toISOString(),
    };
  } catch {
    return null;
  }
}

function isRecentProject(value: RecentProject | null): value is RecentProject {
  return value !== null;
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
  const { existsSync, readdirSync } = getRuntimeFs();
  const storagePaths = getWorkspaceStoragePaths();
  const existingStoragePaths = storagePaths.filter(existsSync);

  if (existingStoragePaths.length === 0) {
    logger.warn(`[RecentProjects] 未找到 Antigravity workspaceStorage: ${storagePaths.join(' | ')}`);
    return [];
  }

  const entries = existingStoragePaths.flatMap((storagePath) => {
    try {
      return readdirSync(storagePath, { withFileTypes: true })
        .filter(dir => dir.isDirectory())
        .map(dir => readWorkspaceProject(storagePath, dir.name))
        .filter(isRecentProject);
    } catch (e: any) {
      logger.error(`[RecentProjects] 读取 workspaceStorage 失败: ${e.message}`);
      return [];
    }
  });

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
