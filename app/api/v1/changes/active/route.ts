import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { existsSync } from 'fs';
import { readFile, stat } from 'fs/promises';
import { ensureCdpConnection } from '@/lib/init';
import ctx from '@/lib/context';
import { getIdeChanges } from '@/lib/scraper/ide-changes';
import { getRecentProjects } from '@/lib/cdp/recent-projects';
import type { ChangeFile } from '@/lib/types';

export const dynamic = 'force-dynamic';

const execFileAsync = promisify(execFile);

/** 单条 git 命令的耗时/缓冲上限，避免大仓库拖垮接口。 */
const GIT_TIMEOUT_MS = 8000;
const GIT_MAX_BUFFER = 16 * 1024 * 1024;
/** 仅对较小的新增文件统计行数，避免读取超大文件。 */
const LINE_COUNT_MAX_BYTES = 2 * 1024 * 1024;
/** 变更文件过多时跳过逐个行数估算，防止一次性读取海量文件。 */
const MAX_FILES_FOR_LINE_COUNT = 300;

type GitStatusEntry = {
  filepath: string;
  statusCode: string;
};

/**
 * 异步执行 git；失败（含超时、非 0 退出、缓冲溢出）时返回空串，由调用方降级处理。
 *
 * 关键点：使用**异步** execFile，绝不阻塞 Node 事件循环。此前这里用的是同步的
 * execFileSync，并且对每个变更文件都再 spawn 两次 `git diff`；当 IDE 当前工作区
 * 是个有大量改动的仓库时，几百次同步 git 调用会把单线程的事件循环卡住十几秒，
 * 期间整个代理（所有 API、静态资源、SSE）全部无响应 —— 前端因此一直 loading。
 */
async function runGit(args: string[], cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['-c', 'core.quotepath=false', ...args], {
      cwd,
      encoding: 'utf-8',
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
    });
    return stdout;
  } catch {
    return '';
  }
}

/** 将路径统一成 Git/前端更易处理的正斜杠格式。 */
function toPosixPath(value: string): string {
  return value.replace(/\\/g, '/').trim();
}

/** 从 rename/copy（`old -> new`、`old => new`、`{old => new}`）路径中取变更后的文件路径。 */
function normalizeStatusPath(rawPath: string): string {
  let value = rawPath.trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    value = value.slice(1, -1);
  }
  const braced = value.match(/^(.*)\{.* => (.*)\}(.*)$/);
  if (braced) {
    value = `${braced[1]}${braced[2]}${braced[3]}`.replace(/\/{2,}/g, '/');
  } else if (value.includes(' -> ')) {
    const parts = value.split(' -> ');
    value = parts[parts.length - 1] || value;
  } else if (value.includes(' => ')) {
    const parts = value.split(' => ');
    value = parts[parts.length - 1] || value;
  }
  return toPosixPath(value);
}

/** 解析 git status porcelain 输出，得到去重后的变更文件。 */
function parseGitStatus(statusOutput: string): GitStatusEntry[] {
  const byPath = statusOutput
    .split('\n')
    .filter(Boolean)
    .reduce((acc, line) => {
      const statusCode = line.slice(0, 2);
      const filepath = normalizeStatusPath(line.slice(3));
      if (!filepath) return acc;
      const current = acc.get(filepath);
      acc.set(filepath, {
        filepath,
        statusCode: current ? `${current.statusCode},${statusCode}` : statusCode,
      });
      return acc;
    }, new Map<string, GitStatusEntry>());

  return Array.from(byPath.values());
}

/** 把一次整仓 `git diff --numstat` 的输出解析成 path -> {additions, deletions}。 */
function parseNumstatMap(output: string): Map<string, { additions: number; deletions: number }> {
  const map = new Map<string, { additions: number; deletions: number }>();
  for (const line of output.split('\n')) {
    if (!line.trim()) continue;
    const [added, deleted, ...rest] = line.split('\t');
    if (rest.length === 0) continue;
    const filepath = normalizeStatusPath(rest.join('\t'));
    if (!filepath) continue;
    const additions = Number.parseInt(added, 10) || 0;
    const deletions = Number.parseInt(deleted, 10) || 0;
    const prev = map.get(filepath);
    map.set(
      filepath,
      prev
        ? { additions: prev.additions + additions, deletions: prev.deletions + deletions }
        : { additions, deletions },
    );
  }
  return map;
}

/** 对未跟踪/新增文件按行数估算 additions（与旧实现保持一致）。 */
async function countFileLines(fullPath: string): Promise<number> {
  try {
    const info = await stat(fullPath);
    if (!info.isFile() || info.size > LINE_COUNT_MAX_BYTES) return 0;
    const content = await readFile(fullPath, 'utf-8');
    return content.split(/\r?\n/).length;
  } catch {
    return 0;
  }
}

/** 解析当前 IDE 工作目录；失败时回退到本项目目录，保证修改记录可查看。 */
function resolveIdeWorkspacePath(): string {
  try {
    const activeIdx = ctx.activeWindowIdx;
    const activeWb = ctx.allWorkbenches[activeIdx];
    const title = activeWb?.title || ctx.activeTitle || '';
    const projectName = title.split(' - ')[0]?.trim();
    if (projectName) {
      const match = getRecentProjects(30).find((project) => project.name === projectName);
      if (match && existsSync(match.path)) return match.path;
    }
  } catch {
    // 无法从 IDE 解析时使用 process.cwd。
  }
  return process.cwd();
}

/** 从 Git 工作区读取修改记录，不点击 PC 端 Changes 面板。 */
async function getGitChanges(): Promise<{
  changes: ChangeFile[];
  totalCount: number;
  source: 'git';
  workspacePath: string;
  isGitRepo: boolean;
}> {
  const workspacePath = resolveIdeWorkspacePath();

  const gitRoot = (await runGit(['rev-parse', '--show-toplevel'], workspacePath)).trim();
  if (!gitRoot) {
    return { changes: [], totalCount: 0, source: 'git', workspacePath, isGitRepo: false };
  }

  // 整仓拉取一次：状态 + 未暂存/已暂存的 numstat，避免对每个文件重复 spawn git。
  const [statusOutput, unstaged, staged] = await Promise.all([
    runGit(['status', '--porcelain=v1', '-u'], gitRoot),
    runGit(['diff', '--numstat'], gitRoot),
    runGit(['diff', '--cached', '--numstat'], gitRoot),
  ]);

  const entries = parseGitStatus(statusOutput);
  const unstagedMap = parseNumstatMap(unstaged);
  const stagedMap = parseNumstatMap(staged);
  const allowLineCount = entries.length <= MAX_FILES_FOR_LINE_COUNT;

  const changes = await Promise.all(
    entries.map(async (entry): Promise<ChangeFile> => {
      const u = unstagedMap.get(entry.filepath);
      const s = stagedMap.get(entry.filepath);
      let additions = (u?.additions || 0) + (s?.additions || 0);
      const deletions = (u?.deletions || 0) + (s?.deletions || 0);
      if (additions === 0 && deletions === 0 && allowLineCount) {
        additions = await countFileLines(path.join(gitRoot, entry.filepath));
      }
      return {
        filename: path.basename(entry.filepath),
        filepath: entry.filepath,
        additions,
        deletions,
      };
    }),
  );

  return {
    changes,
    totalCount: changes.length,
    source: 'git',
    workspacePath: gitRoot,
    isGitRepo: true,
  };
}

/** GET /api/v1/changes/active 默认从 Git 读取，避免影响 PC 端滚动和面板状态。 */
export async function GET(request: NextRequest) {
  const allowIdePanel = request.nextUrl.searchParams.get('source') === 'ide';

  if (!allowIdePanel) {
    return NextResponse.json(await getGitChanges());
  }

  try {
    await ensureCdpConnection();

    if (!ctx.workbenchPage) {
      return NextResponse.json({ changes: [], totalCount: 0, error: 'No CDP connection' });
    }

    const result = await getIdeChanges(ctx);
    return NextResponse.json({ ...result, source: 'ide' });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
