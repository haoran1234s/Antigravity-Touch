/**
 * Shared TypeScript types for the Antigravity Chat Proxy.
 */

import type { Page, Browser } from 'puppeteer-core';

// ── Context (shared server state) ──

export interface ProxyContext {
  workbenchPage: Page | null;
  browser: Browser | null;
  allWorkbenches: WorkbenchInfo[];
  activeWindowIdx: number;
  activeConversationId: string | null;
  activeTitle?: string | null;
  activeConversationSource?: 'ide' | 'brain' | null;
  lastActionTimestamp: number;
}

export interface WorkbenchInfo {
  page: Page;
  title: string;
  url: string;
  targetId?: string;
}

// ── Agent State (from scraper) ──

export interface ToolCall {
  id: string;
  status: string;
  type: string;
  path: string;
  command: string | null;
  exitCode: string | null;
  hasCancelBtn: boolean;
  footerButtons: string[];
  hasTerminal: boolean;
  terminalOutput: string | null;
  additions?: string | null;
  deletions?: string | null;
  lineRange?: string | null;
  mcpToolName?: string | null;
  mcpArgs?: string | null;
  mcpOutput?: string | null;
}

export interface ThinkingBlock {
  time: string;
}

export interface FileChange {
  fileName: string;
  type: string;
}

export interface AgentState {
  isRunning: boolean;
  turnCount: number;
  stepGroupCount: number;
  thinking: ThinkingBlock[];
  toolCalls: ToolCall[];
  responses: string[];
  notifications: string[];
  error: string | null;
  fileChanges: FileChange[];
  lastTurnResponseHTML: string;
}

export interface ChatTurn {
  role: 'user' | 'agent';
  content: string;
}

export interface ChatHistory {
  isRunning: boolean;
  turnCount: number;
  turns: ChatTurn[];
  source?: 'ide' | 'brain' | 'none';
  error?: string;
  ideError?: string;
}

// ── SSE Events ──

export type SSEEventType =
  | 'thinking'
  | 'tool_call'
  | 'hitl'
  | 'response'
  | 'notification'
  | 'file_change'
  | 'status'
  | 'done'
  | 'error';

export interface SSEEvent {
  type: SSEEventType;
  data: Record<string, unknown>;
}

// ── Conversation & Artifacts ──

export interface ConversationFile {
  name: string;
  size: number;
  mtime: string;
}

export interface Conversation {
  id: string;
  title: string | null;
  files: ConversationFile[];
  mtime: string;
  active: boolean;
}

// ── Frontend Types ──

export interface WindowInfo {
  index: number;
  title: string;
  url: string;
  active: boolean;
  targetId?: string;
}

export interface ConversationInfo {
  id: string; // The backend brain UUID, or "-1" for unknown
  title: string;
  active: boolean;
  index: number;
  mtime?: string;
  files?: ArtifactFile[];
  source?: 'ide' | 'brain' | 'mixed';
  summary?: string;
  workspacePaths?: string[];
  projectName?: string;
  projectPath?: string;
}

export interface ConversationProjectGroup {
  id: string;
  name: string;
  path?: string;
  active: boolean;
  conversationCount: number;
  conversations: ConversationInfo[];
}

export interface ArtifactFile {
  name: string;
  size: number;
  mtime: string;
  /** Whether this is a file with an extension (can be opened/viewed) or a named IDE artifact */
  isFile?: boolean;
  /** Where this artifact was detected from */
  source?: 'ide' | 'brain' | 'none';
}

export interface ChangeFile {
  filename: string;
  filepath: string;
  additions: number;
  deletions: number;
}

// ── Git Status Types ──

export type GitFileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'untracked' | 'unmerged';

export interface GitFile {
  path: string;
  originalPath?: string;
  status: GitFileStatus;
  statusCode: string;
}

export interface GitCommit {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  relativeDate: string;
}

// ── Workspace File Tree ──

export interface WorkspaceNode {
  name: string;
  path: string;       // relative to workspace root
  type: 'file' | 'dir';
  children?: WorkspaceNode[];
  size?: number;
  ext?: string;
}

export interface WorkspaceTree {
  workspacePath: string;
  rootLabel: string;
  tree: WorkspaceNode[];
}

export interface GitStatus {
  isGitRepo: boolean;
  branch: string | null;
  remoteBranch: string | null;
  ahead: number;
  behind: number;
  staged: GitFile[];
  unstaged: GitFile[];
  untracked: GitFile[];
  commits: GitCommit[];
  stashCount: number;
  workspacePath: string;
  stagedCount: number;
  unstagedCount: number;
}

export interface ChatMessage {
  role: 'user' | 'agent';
  content: string;
  steps?: SSEStep[];
}

export interface SSEStep {
  type: string;
  data: Record<string, any>;
}
