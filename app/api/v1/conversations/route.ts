import { NextResponse } from 'next/server';
import { ensureCdpConnection } from '@/lib/init';
import ctx from '@/lib/context';
import path from 'path';
import fs from 'fs';
import { getIdeConversations } from '@/lib/scraper/ide-conversations';
import {
  extractProjectFromWindowTitle,
  filterConversationsByWorkspace,
} from '@/lib/scraper/workspace-filter';
import { getRecentProjects, type RecentProject } from '@/lib/cdp/recent-projects';
import {
  listBrainConversations,
  type BrainConversationInfo,
} from '@/lib/brain-conversations';
import type { ConversationInfo, ConversationProjectGroup } from '@/lib/types';

export const dynamic = 'force-dynamic';

const runtimeHomedir = (): string => eval('require')('os').homedir();
const getBrainDir = () => path.join(runtimeHomedir(), '.gemini', 'antigravity', 'brain');

function extractTitle(convDir: string): string | null {
  const taskFile = path.join(convDir, 'task.md');
  try {
    if (fs.existsSync(taskFile)) {
      const content = fs.readFileSync(taskFile, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('# ')) return trimmed.slice(2).trim();
      }
    }
  } catch { /* ignore */ }
  return null;
}

function getConversationFiles(convDir: string) {
  try {
    const results: any[] = [];
    const entries = fs.readdirSync(convDir, { recursive: true, withFileTypes: true });
    for (const d of entries) {
      if (!d.isFile() || !d.name.endsWith('.md')) continue;
      // @ts-ignore — Node 20+ uses parentPath
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

// Compute a simple word overlap score for fuzzy brain→IDE title matching
function getMatchScore(s1: string, s2: string): number {
  if (!s1 || !s2) return 0;
  const words1 = s1.toLowerCase().replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(w => w.length > 2);
  const words2 = s2.toLowerCase().replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(w => w.length > 2);
  if (words1.length === 0 || words2.length === 0) return 0;
  let matches = 0;
  for (const w of words1) if (words2.includes(w)) matches++;
  return matches / Math.min(words1.length, words2.length);
}

function normalize(value?: string | null): string {
  return (value || '').replace(/\\/g, '/').toLowerCase().trim();
}

function basenameFromPath(value?: string | null): string {
  const normalized = (value || '').replace(/\\/g, '/').replace(/\/+$/, '');
  if (!normalized) return '';
  return normalized.split('/').filter(Boolean).pop() || normalized;
}

function sameProjectName(a?: string | null, b?: string | null): boolean {
  const left = normalize(a);
  const right = normalize(b);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

function activeProjectFromTitle(projects: RecentProject[], windowTitle?: string | null): RecentProject | null {
  const projectName = extractProjectFromWindowTitle(windowTitle || undefined);
  if (projectName) {
    const byTitle = projects.find((project) => sameProjectName(project.name, projectName));
    if (byTitle) return byTitle;
  }
  return projects[0] || null;
}

function conversationMatchesProject(conversation: ConversationInfo, project: RecentProject): boolean {
  const projectName = normalize(project.name);
  const projectPath = normalize(project.path);
  const projectBase = normalize(basenameFromPath(project.path));
  const haystack = [
    conversation.projectName,
    conversation.projectPath,
    conversation.title,
    conversation.summary,
    ...(conversation.workspacePaths || []),
  ].map(normalize).filter(Boolean);

  return haystack.some((value) =>
    value === projectName ||
    value === projectBase ||
    value === projectPath ||
    value.includes(projectName) ||
    value.includes(projectBase) ||
    projectName.includes(value) ||
    projectBase.includes(value)
  );
}

function withProject(conversation: ConversationInfo, project?: { name: string; path?: string } | null): ConversationInfo {
  if (!project) return conversation;
  return {
    ...conversation,
    projectName: conversation.projectName || project.name,
    projectPath: conversation.projectPath || project.path,
  };
}

function dedupeConversations(conversations: ConversationInfo[]): ConversationInfo[] {
  const seen = new Set<string>();
  const deduped: ConversationInfo[] = [];

  for (const conversation of conversations) {
    const key = conversation.id && !/^-?\d+$/.test(conversation.id)
      ? `id:${conversation.id}`
      : `idx:${conversation.index}:${conversation.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(conversation);
  }

  return deduped.sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    if (!a.mtime && !b.mtime) return a.index - b.index;
    if (!a.mtime) return 1;
    if (!b.mtime) return -1;
    return new Date(b.mtime).getTime() - new Date(a.mtime).getTime();
  });
}

function buildProjectGroups(
  currentProjectConversations: ConversationInfo[],
  allBrainConversations: ConversationInfo[],
  recentProjects: RecentProject[],
  activeWindowTitle?: string | null,
): ConversationProjectGroup[] {
  const activeConversation = currentProjectConversations.find((conversation) => conversation.active);
  const activeName =
    activeConversation?.projectName ||
    extractProjectFromWindowTitle(activeWindowTitle || undefined);
  const groups = new Map<string, ConversationProjectGroup>();

  const ensureGroup = (project: RecentProject | { name: string; path?: string }, active = false) => {
    const key = project.path || project.name;
    const existing = groups.get(key);
    if (existing) {
      existing.active = existing.active || active;
      return existing;
    }
    const group: ConversationProjectGroup = {
      id: key,
      name: project.name,
      path: project.path,
      active,
      conversationCount: 0,
      conversations: [],
    };
    groups.set(key, group);
    return group;
  };

  const activeProject = activeName
    ? recentProjects.find((project) => sameProjectName(project.name, activeName))
      || (activeConversation?.projectName ? { name: activeConversation.projectName, path: activeConversation.projectPath } : null)
    : activeProjectFromTitle(recentProjects, activeWindowTitle);
  for (const project of recentProjects) {
    ensureGroup(project, sameProjectName(project.name, activeName));
  }
  if (!activeProject && activeName) ensureGroup({ name: activeName }, true);

  const activeGroup = activeProject
    ? ensureGroup(activeProject, true)
    : (activeName ? ensureGroup({ name: activeName }, true) : null);

  for (const conversation of currentProjectConversations) {
    (activeGroup || ensureGroup({ name: conversation.projectName || 'Current project' }, true))
      .conversations.push(withProject(conversation, activeProject));
  }

  const other = ensureGroup({ name: 'Other history' }, false);
  for (const conversation of allBrainConversations) {
    let target: ConversationProjectGroup | null = null;
    for (const project of recentProjects) {
      if (conversationMatchesProject(conversation, project)) {
        target = ensureGroup(project, sameProjectName(project.name, activeName));
        break;
      }
    }
    if (!target && conversation.projectName) {
      target = ensureGroup({ name: conversation.projectName }, sameProjectName(conversation.projectName, activeName));
    }
    (target || other).conversations.push(conversation);
  }

  const ordered = Array.from(groups.values())
    .map((group) => {
      const conversations = dedupeConversations(group.conversations);
      return {
        ...group,
        conversationCount: conversations.length,
        conversations,
      };
    })
    .filter((group) => group.active || group.conversations.length > 0)
    .sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      const aIdx = recentProjects.findIndex(p => p.path === a.path || p.name === a.name);
      const bIdx = recentProjects.findIndex(p => p.path === b.path || p.name === b.name);
      if (aIdx !== bIdx) return (aIdx === -1 ? Number.MAX_SAFE_INTEGER : aIdx) - (bIdx === -1 ? Number.MAX_SAFE_INTEGER : bIdx);
      return a.name.localeCompare(b.name);
    });

  return ordered;
}

/**
 * GET /api/v1/conversations — list conversations from the IDE's history panel.
 *
 * Active conversation = the FIRST item in the IDE history dropdown (Antigravity convention).
 * We enrich each entry with brain metadata (files, mtime, brain UUID) when available.
 */
export async function GET() {
  let cdpError: string | null = null;
  try {
    await ensureCdpConnection();
  } catch (err: any) {
    cdpError = err?.message || 'Unable to connect to Antigravity';
  }

  const activeWindowTitle = ctx.allWorkbenches[ctx.activeWindowIdx]?.title;
  const recentProjects = getRecentProjects(30);
  const activeProject = activeProjectFromTitle(recentProjects, activeWindowTitle);
  const brainConversations = listBrainConversations({
    windowTitle: activeWindowTitle,
    projectPath: activeProject?.path,
    activeId: ctx.activeConversationId,
  });
  const allBrainConversations = listBrainConversations({
    activeId: ctx.activeConversationId,
    limit: 200,
  });
  const brainOnlyProjects = buildProjectGroups(
    brainConversations,
    allBrainConversations,
    recentProjects,
    activeWindowTitle,
  );

  if (!ctx.workbenchPage) {
    return NextResponse.json({
      conversations: brainConversations,
      projects: brainOnlyProjects,
      source: 'brain',
      cdpConnected: false,
      error: cdpError,
    });
  }

  try {
    // The scraper already marks index===0 as active — no additional heuristics needed.
    const ideConversations = await getIdeConversations(ctx);

    // Pre-calculate brain metadata to enrich IDE conversations with files/mtime/UUID
    const brainData: any[] = [];
    if (fs.existsSync(getBrainDir())) {
      const entries = fs.readdirSync(getBrainDir(), { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          const dirPath = path.join(getBrainDir(), entry.name);
          const files = getConversationFiles(dirPath);
          const title = extractTitle(dirPath);
          const latestFileMtime = files.reduce((max, f) => {
            const t = new Date(f.mtime).getTime();
            return t > max ? t : max;
          }, 0);
          const dirMtime = fs.statSync(dirPath).mtimeMs;
          const mtime = new Date(latestFileMtime > 0 ? latestFileMtime : dirMtime).toISOString();
          brainData.push({ id: entry.name, title, files, mtime });
        }
      }
    }

    const activeIdeConversation = ideConversations.find((c) => c.active);
    if (activeIdeConversation) {
      ctx.activeTitle = activeIdeConversation.title || null;
      if (activeIdeConversation.id) ctx.activeConversationId = activeIdeConversation.id;
      ctx.activeConversationSource = 'ide';
    }

    const activeIdeProject = activeIdeConversation?.projectName
      ? recentProjects.find((project) => sameProjectName(project.name, activeIdeConversation.projectName))
        || { name: activeIdeConversation.projectName, path: undefined }
      : activeProject;

    const scopedBrainConversations = listBrainConversations({
      windowTitle: activeIdeConversation?.projectName || activeWindowTitle,
      projectPath: activeIdeProject?.path,
      activeId: ctx.activeConversationId,
    });

    const conversations = ideConversations.map((c) => {
      // Try to find a matching brain entry for this IDE conversation title
      let mappedId = c.id || c.index.toString();
      let files: any[] = [];
      let mtime: string | undefined = undefined;

      const exactIdMatch = c.id ? brainData.find((bd) => bd.id === c.id) : null;
      if (exactIdMatch) {
        files = exactIdMatch.files;
        mtime = exactIdMatch.mtime;
      }

      let bestMatch: any = null;
      for (const bd of exactIdMatch ? [] : brainData) {
        if (!bd.title) continue;
        // Exact / substring match — prefer this over fuzzy
        if (bd.title === c.title || bd.title.includes(c.title) || c.title.includes(bd.title)) {
          mappedId = bd.id;
          files = bd.files;
          mtime = bd.mtime;
          bestMatch = null; // clear fuzzy candidate — exact wins
          break;
        }
        const score = getMatchScore(bd.title, c.title);
        const bdtime = new Date(bd.mtime).getTime();
        if (score > 0 && (!bestMatch || score > bestMatch.score || (score === bestMatch.score && bdtime > bestMatch.time))) {
          bestMatch = { ...bd, score, time: bdtime };
        }
      }

      if (mappedId === c.index.toString() && bestMatch && bestMatch.score >= 0.2) {
        mappedId = bestMatch.id;
        files = bestMatch.files;
        mtime = bestMatch.mtime;
      }

      return {
        id: mappedId,
        title: c.title,
        // Trust the scraper: active === (index === 0)
        active: c.active,
        index: c.index,
        files,
        mtime,
        projectName: c.projectName || activeIdeProject?.name,
        projectPath: c.projectPath || activeIdeProject?.path,
        source: 'ide' as const,
      };
    });

    // Include project-local brain history that may not currently be present in
    // the IDE dropdown. This is important for phones: they can still manage and
    // open project history even when the CDP/IDE history scrape is incomplete.
    const seen = new Set(conversations.map(c => c.id).filter(Boolean));
    const brainOnly = scopedBrainConversations.filter((c: BrainConversationInfo) => !seen.has(c.id));

    // Filter to only conversations related to the active window's project
    const filtered = filterConversationsByWorkspace([...conversations, ...brainOnly], activeWindowTitle)
      .map((conversation) => withProject(conversation, activeIdeProject));
    const projects = buildProjectGroups(
      filtered,
      allBrainConversations,
      recentProjects,
      activeWindowTitle,
    );

    return NextResponse.json({
      conversations: filtered,
      projects,
      source: brainOnly.length > 0 ? 'ide+brain' : 'ide',
      cdpConnected: true,
    });
  } catch (err: any) {
    return NextResponse.json({
      conversations: brainConversations,
      projects: brainOnlyProjects,
      source: 'brain',
      cdpConnected: false,
      error: err.message,
    });
  }
}
