import { NextRequest, NextResponse } from 'next/server';
import { execFileSync } from 'child_process';
import path from 'path';
import { existsSync, readFileSync } from 'fs';
import { ensureCdpConnection } from '@/lib/init';
import ctx from '@/lib/context';
import { getIdeChanges } from '@/lib/scraper/ide-changes';
import { getRecentProjects } from '@/lib/cdp/recent-projects';
import type { ChangeFile } from '@/lib/types';

export const dynamic = 'force-dynamic';

type GitStatusEntry = {
  filepath: string;
  statusCode: string;
};

/** 将路径统一成 Git/前端更易处理的正斜杠格式。 */
function toPosixPath(value: string): string {
  return value.replace(/\\/g, '/').trim();
}

/** 从 rename/copy 状态中取变更后的文件路径。 */
function normalizeStatusPath(rawPath: string): string {
  const parts = rawPath.includes(' -> ') ? rawPath.split(' -> ') : [rawPath];
  return toPosixPath(parts[parts.length - 1] || rawPath);
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

/** 读取 git diff --numstat，用于显示修改记录中的增删行数。 */
function readNumstat(gitRoot: string, filepath: string): Pick<ChangeFile, 'additions' | 'deletions'> {
  const parseNumstat = (output: string) => output
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [added, deleted] = line.split('\t');
      return {
        additions: Number.parseInt(added, 10) || 0,
        deletions: Number.parseInt(deleted, 10) || 0,
      };
    })
    .reduce(
      (sum, item) => ({
        additions: sum.additions + item.additions,
        deletions: sum.deletions + item.deletions,
      }),
      { additions: 0, deletions: 0 },
    );

  const outputs = [
    ['diff', '--numstat', '--', filepath],
    ['diff', '--cached', '--numstat', '--', filepath],
  ].map((args) => {
    try {
      return execFileSync('git', args, { cwd: gitRoot, encoding: 'utf-8' });
    } catch {
      return '';
    }
  });

  const stats = outputs.map(parseNumstat).reduce(
    (sum, item) => ({
      additions: sum.additions + item.additions,
      deletions: sum.deletions + item.deletions,
    }),
    { additions: 0, deletions: 0 },
  );

  if (stats.additions > 0 || stats.deletions > 0) return stats;

  const fullPath = path.join(gitRoot, filepath);
  if (!existsSync(fullPath)) return stats;

  try {
    const content = readFileSync(fullPath, 'utf-8');
    return { additions: content.split(/\r?\n/).length, deletions: 0 };
  } catch {
    return stats;
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
function getGitChanges(): { changes: ChangeFile[]; totalCount: number; source: 'git'; workspacePath: string; isGitRepo: boolean } {
  const workspacePath = resolveIdeWorkspacePath();

  try {
    const gitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: workspacePath,
      encoding: 'utf-8',
    }).trim();

    const statusOutput = execFileSync('git', ['status', '--porcelain=v1', '-u'], {
      cwd: gitRoot,
      encoding: 'utf-8',
      maxBuffer: 2 * 1024 * 1024,
    } as any);

    const changes = parseGitStatus(statusOutput).map((entry) => {
      const stats = readNumstat(gitRoot, entry.filepath);
      return {
        filename: path.basename(entry.filepath),
        filepath: entry.filepath,
        additions: stats.additions,
        deletions: stats.deletions,
      };
    });

    return {
      changes,
      totalCount: changes.length,
      source: 'git',
      workspacePath: gitRoot,
      isGitRepo: true,
    };
  } catch {
    return {
      changes: [],
      totalCount: 0,
      source: 'git',
      workspacePath,
      isGitRepo: false,
    };
  }
}

/** GET /api/v1/changes/active 默认从 Git 读取，避免影响 PC 端滚动和面板状态。 */
export async function GET(request: NextRequest) {
  const allowIdePanel = request.nextUrl.searchParams.get('source') === 'ide';

  if (!allowIdePanel) {
    return NextResponse.json(getGitChanges());
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
