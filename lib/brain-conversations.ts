import fs from 'fs';
import path from 'path';
import type { ArtifactFile, ChatHistory, ChatTurn, ConversationInfo } from '@/lib/types';
import { extractProjectFromWindowTitle } from '@/lib/scraper/workspace-filter';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TEXT_EXTENSIONS = new Set(['.md', '.jsonl', '.log', '.txt', '.json']);
const MAX_TEXT_BYTES = 128 * 1024;
const MAX_HISTORY_TURNS = 80;
const FILE_PATH_REGEX = /(?:\/(?:home|Users|root|tmp|var|opt|etc)\/[^\s),`'">\]]+)|(?:[A-Z]:\\[^\s),`'">\]]+)/g;

const runtimeHomedir = (): string => eval('require')('os').homedir();
export const getBrainDir = () => path.join(runtimeHomedir(), '.gemini', 'antigravity', 'brain');

type BrainFile = {
  fullPath: string;
  relPath: string;
  size: number;
  mtimeMs: number;
  mtime: string;
};

export type BrainConversationInfo = ConversationInfo & {
  source: 'brain';
  summary?: string;
  workspacePaths?: string[];
  projectName?: string;
};

function safeStat(filePath: string) {
  try { return fs.statSync(filePath); } catch { return null; }
}

function walkFiles(root: string, maxFiles = 2000): BrainFile[] {
  const out: BrainFile[] = [];
  const stack = [''];

  while (stack.length > 0 && out.length < maxFiles) {
    const relDir = stack.pop() || '';
    const absDir = path.join(root, relDir);
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(absDir, { withFileTypes: true }); } catch { continue; }

    for (const entry of entries) {
      if (out.length >= maxFiles) break;
      const rel = path.join(relDir, entry.name);
      const abs = path.join(root, rel);
      if (entry.isDirectory()) {
        stack.push(rel);
        continue;
      }
      if (!entry.isFile()) continue;
      const stat = safeStat(abs);
      if (!stat) continue;
      out.push({
        fullPath: abs,
        relPath: rel.replace(/\\/g, '/'),
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        mtime: stat.mtime.toISOString(),
      });
    }
  }

  return out;
}

function readHead(filePath: string, maxBytes = MAX_TEXT_BYTES): string {
  try {
    const fd = fs.openSync(filePath, 'r');
    try {
      const stat = fs.fstatSync(fd);
      const len = Math.min(stat.size, maxBytes);
      const buffer = Buffer.alloc(len);
      const bytesRead = fs.readSync(fd, buffer, 0, len, 0);
      return buffer.toString('utf-8', 0, bytesRead);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return '';
  }
}

function normalizeText(text: string, maxLength = 220): string {
  const cleaned = text
    .replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/g, '')
    .replace(/<USER_SETTINGS_CHANGE>[\s\S]*?<\/USER_SETTINGS_CHANGE>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, maxLength - 3).trim()}...`;
}

function extractUserRequest(content: string): string {
  const match = content.match(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/);
  return normalizeText(match?.[1] || content, 4000);
}

function parseTranscriptLines(transcriptPath: string): any[] {
  const text = readHead(transcriptPath, 512 * 1024);
  if (!text.trim()) return [];

  const result: any[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try { result.push(JSON.parse(trimmed)); } catch { /* ignore malformed log lines */ }
  }
  return result;
}

function getTranscriptFile(files: BrainFile[]) {
  return files.find(f => f.relPath.replace(/\\/g, '/').endsWith('.system_generated/logs/transcript.jsonl'));
}

function getRootTaskTitle(convDir: string): string | null {
  const taskFile = path.join(convDir, 'task.md');
  try {
    if (!fs.existsSync(taskFile)) return null;
    const content = readHead(taskFile, 32 * 1024);
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed.startsWith('# ')) return normalizeText(trimmed.slice(2), 120);
    }
  } catch { /* ignore */ }
  return null;
}

function getTitleFromTranscript(transcriptPath: string): string | null {
  const lines = parseTranscriptLines(transcriptPath);
  for (const item of lines) {
    if (item?.type === 'USER_INPUT' && typeof item.content === 'string') {
      const request = extractUserRequest(item.content);
      if (request) return normalizeText(request, 80);
    }
  }
  return null;
}

function getSummaryFromTranscript(transcriptPath: string): string | undefined {
  const lines = parseTranscriptLines(transcriptPath);
  for (const item of lines) {
    if (item?.type === 'USER_INPUT' && typeof item.content === 'string') {
      const request = extractUserRequest(item.content);
      if (request) return normalizeText(request, 160);
    }
  }
  for (const item of lines) {
    if (item?.source === 'MODEL' && typeof item.content === 'string' && item.content.trim()) {
      return normalizeText(item.content, 160);
    }
  }
  return undefined;
}

function getTaskLogHint(files: BrainFile[]): { title?: string; summary?: string } {
  const taskLog = files
    .filter(f => f.relPath.includes('.system_generated/tasks/'))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
  if (!taskLog) return {};

  const content = readHead(taskLog.fullPath, 64 * 1024);
  const lines = content.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const firstReadable = lines.find(line => !/^[A-Z]:\\/.test(line) && !/^\/.+/.test(line));
  const paths = lines.filter(line => /^[A-Z]:\\/.test(line) || /^\/.+/.test(line));
  const pathBases = paths
    .map(line => {
      const normalized = line.replace(/\\/g, '/');
      const segments = normalized.split('/').filter(Boolean);
      const workIdx = segments.findIndex(seg => ['work', 'repos', 'projects', 'src', 'dev', 'code'].includes(seg));
      return workIdx >= 0 ? segments[workIdx + 1] : segments[segments.length - 2] || segments[segments.length - 1];
    })
    .filter(Boolean);

  const counts = new Map<string, number>();
  for (const base of pathBases) counts.set(base, (counts.get(base) || 0) + 1);
  const [projectName] = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0] || [];

  return {
    title: projectName ? `${projectName} project history` : undefined,
    summary: firstReadable ? normalizeText(firstReadable, 160) : (paths[0] ? normalizeText(paths[0], 160) : undefined),
  };
}

function getArtifactFiles(files: BrainFile[]): ArtifactFile[] {
  return files
    .filter(f => !f.relPath.split('/').some(part => part.startsWith('.')))
    .map(f => ({
      name: f.relPath,
      size: f.size,
      mtime: f.mtime,
      isFile: true,
      source: 'brain' as const,
    }));
}

function getConversationTextFiles(files: BrainFile[]) {
  return files.filter(f => TEXT_EXTENSIONS.has(path.extname(f.relPath).toLowerCase()));
}

function extractWorkspacePaths(files: BrainFile[]): string[] {
  const found = new Set<string>();
  for (const file of getConversationTextFiles(files)) {
    const content = readHead(file.fullPath, MAX_TEXT_BYTES);
    const matches = content.matchAll(FILE_PATH_REGEX);
    for (const match of matches) {
      const rawPath = match[0];
      const normalizedPath = rawPath.replace(/\\/g, '/');
      const segments = normalizedPath.split('/').filter(Boolean);
      if (segments.length > 0 && /^[A-Z]:$/i.test(segments[0])) segments.shift();

      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        if (['home', 'Users'].includes(seg)) {
          const projectCandidate = segments[i + 2] || segments[i + 3];
          if (projectCandidate) found.add(projectCandidate);
        }
        if (['repos', 'projects', 'src', 'dev', 'work', 'code'].includes(seg)) {
          const projectCandidate = segments[i + 1];
          if (projectCandidate && !['repos', 'projects', 'src', 'dev', 'work', 'code'].includes(projectCandidate)) {
            found.add(projectCandidate);
          }
        }
      }
    }
  }
  return Array.from(found);
}

function projectCandidates(projectPath?: string | null, windowTitle?: string | null): string[] {
  const candidates = new Set<string>();
  const fromTitle = extractProjectFromWindowTitle(windowTitle || undefined);
  if (fromTitle) candidates.add(fromTitle.toLowerCase());

  if (projectPath) {
    const normalized = projectPath.replace(/\\/g, '/').replace(/\/+$/, '');
    const base = path.basename(normalized);
    if (base) candidates.add(base.toLowerCase());
    if (normalized) candidates.add(normalized.toLowerCase());
  }

  return Array.from(candidates).filter(Boolean);
}

function matchesProject(conversation: BrainConversationInfo, candidates: string[]) {
  if (candidates.length === 0) return true;
  const haystack = [
    conversation.title,
    conversation.summary || '',
    ...(conversation.workspacePaths || []),
  ].map(v => v.toLowerCase()).filter(Boolean);

  return candidates.some(candidate =>
    haystack.some(value => value === candidate || value.includes(candidate) || candidate.includes(value))
  );
}

export function brainConversationExists(id?: string | null): boolean {
  if (!id || !UUID_RE.test(id)) return false;
  return fs.existsSync(path.join(getBrainDir(), id));
}

export function getBrainConversation(id: string): BrainConversationInfo | null {
  if (!brainConversationExists(id)) return null;
  const convDir = path.join(getBrainDir(), id);
  const files = walkFiles(convDir);
  const latest = files.reduce((max, f) => Math.max(max, f.mtimeMs), safeStat(convDir)?.mtimeMs || 0);
  const transcript = getTranscriptFile(files);
  const taskHint = getTaskLogHint(files);
  const workspacePaths = extractWorkspacePaths(files);
  const title = getRootTaskTitle(convDir) || (transcript ? getTitleFromTranscript(transcript.fullPath) : null) || taskHint.title || `History ${id.slice(0, 8)}`;

  return {
    id,
    title,
    active: false,
    index: -1,
    mtime: new Date(latest || Date.now()).toISOString(),
    files: getArtifactFiles(files),
    source: 'brain',
    summary: (transcript ? getSummaryFromTranscript(transcript.fullPath) : undefined) || taskHint.summary,
    workspacePaths,
    projectName: workspacePaths[0],
  };
}

export function listBrainConversations(options: { projectPath?: string | null; windowTitle?: string | null; activeId?: string | null; limit?: number } = {}): BrainConversationInfo[] {
  const brainDir = getBrainDir();
  if (!fs.existsSync(brainDir)) return [];

  const dirs = fs.readdirSync(brainDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && UUID_RE.test(d.name));

  const conversations = dirs
    .map(d => getBrainConversation(d.name))
    .filter((c): c is BrainConversationInfo => !!c)
    .sort((a, b) => new Date(b.mtime || 0).getTime() - new Date(a.mtime || 0).getTime());

  const candidates = projectCandidates(options.projectPath, options.windowTitle);
  const matched = conversations.filter(c => matchesProject(c, candidates));
  const scoped = candidates.length > 0 && matched.length > 0 ? matched : conversations;

  return scoped.slice(0, options.limit || 80).map((conversation, idx) => ({
    ...conversation,
    active: !!options.activeId && conversation.id === options.activeId,
    index: -1 - idx,
  }));
}

export function getBrainChatHistory(conversationId: string): ChatHistory | null {
  if (!brainConversationExists(conversationId)) return null;
  const convDir = path.join(getBrainDir(), conversationId);
  const files = walkFiles(convDir);
  const transcript = getTranscriptFile(files);
  if (!transcript) return { isRunning: false, turnCount: 0, turns: [] };

  const turns: ChatTurn[] = [];
  for (const item of parseTranscriptLines(transcript.fullPath)) {
    if (item?.type === 'USER_INPUT' && typeof item.content === 'string') {
      const content = extractUserRequest(item.content);
      if (content) turns.push({ role: 'user', content });
      continue;
    }

    if (item?.source === 'MODEL' && item?.type === 'PLANNER_RESPONSE' && typeof item.content === 'string') {
      const content = normalizeText(item.content, 20000);
      if (content) turns.push({ role: 'agent', content });
    }
  }

  const clipped = turns.slice(-MAX_HISTORY_TURNS);
  return {
    isRunning: false,
    turnCount: clipped.length,
    turns: clipped,
  };
}

export function getBrainArtifacts(conversationId?: string | null): ArtifactFile[] {
  if (!conversationId) return [];
  const conversation = getBrainConversation(conversationId);
  return conversation?.files || [];
}
