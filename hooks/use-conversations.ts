import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import type { WindowInfo, ConversationInfo, ConversationProjectGroup } from '@/lib/types';
import { fetcher, SWR_KEYS } from '@/lib/swr-fetcher';

export interface CdpStatus {
  active: boolean;
  windowCount: number;
  error?: string | null;
}

export interface RecentProject {
  path: string;
  name: string;
  lastOpened: string;
}

const API_BASE = '/api/v1';
const SELECTED_CONVERSATION_KEY = 'antigravity-mobile:selected-conversation:v1';
const CONVERSATIONS_IDE_KEY = `${SWR_KEYS.conversations}?source=ide&timeoutMs=6500`;
const CONVERSATIONS_SYNC_TIMEOUT_MS = 16000;

type ConversationSelection = string | Partial<Pick<ConversationInfo, 'title' | 'index' | 'id' | 'projectName' | 'projectPath'>>;

interface ConversationsResponse {
  conversations?: ConversationInfo[];
  projects?: ConversationProjectGroup[];
  source?: string;
  cdpConnected?: boolean;
  stale?: boolean;
  error?: string | null;
}

async function fetchConversationsWithTimeout(url: string): Promise<ConversationsResponse> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), CONVERSATIONS_SYNC_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'Cache-Control': 'no-cache' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`PC 端对话同步失败：HTTP ${res.status}`);
    return await res.json();
  } finally {
    window.clearTimeout(timeout);
  }
}

function getSelectionParts(selection: ConversationSelection) {
  return {
    title: typeof selection === 'string' ? selection : selection.title,
    index: typeof selection === 'string' ? undefined : selection.index,
    id: typeof selection === 'string' ? undefined : selection.id,
    projectName: typeof selection === 'string' ? undefined : selection.projectName,
    projectPath: typeof selection === 'string' ? undefined : selection.projectPath,
  };
}

function isSameSelection(conversation: ConversationInfo, selection: { title?: string; index?: number; id?: string; projectName?: string; projectPath?: string }) {
  if (selection.id && conversation.id === selection.id) return true;
  const sameProject =
    !selection.projectName ||
    !conversation.projectName ||
    conversation.projectName === selection.projectName;
  if (Number.isInteger(selection.index) && (selection.index as number) >= 0 && conversation.index === selection.index && sameProject) return true;
  return !!selection.title && conversation.title === selection.title && sameProject;
}

function persistSelectedConversation(selection: { title?: string; index?: number; id?: string; projectName?: string; projectPath?: string }) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SELECTED_CONVERSATION_KEY, JSON.stringify({
      ...selection,
      savedAt: Date.now(),
    }));
  } catch { /* ignore storage failures */ }
}

function readPersistedSelection(): { title?: string; index?: number; id?: string; projectName?: string; projectPath?: string } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(SELECTED_CONVERSATION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || (!parsed.title && !parsed.id && !Number.isInteger(parsed.index))) return null;
    return {
      title: typeof parsed.title === 'string' ? parsed.title : undefined,
      index: Number.isInteger(parsed.index) ? parsed.index : undefined,
      id: typeof parsed.id === 'string' ? parsed.id : undefined,
      projectName: typeof parsed.projectName === 'string' ? parsed.projectName : undefined,
      projectPath: typeof parsed.projectPath === 'string' ? parsed.projectPath : undefined,
    };
  } catch {
    return null;
  }
}

export function useConversations(
  fetchHistory: () => void,
  setShowWelcome: (s: boolean) => void,
  onConversationSwitched?: () => void
) {
  // ── SWR-powered read-only data ──
  const { data: windowsData, mutate: mutateWindows } = useSWR<{ windows?: WindowInfo[] }>(
    SWR_KEYS.windows, fetcher, { revalidateOnFocus: true }
  );
  const windows: WindowInfo[] = windowsData?.windows || [];

  const { data: cdpData, mutate: mutateCdpStatus } = useSWR<{ active: boolean; windowCount: number; error?: string | null }>(
    SWR_KEYS.cdpStatus, fetcher, { refreshInterval: 15000, revalidateOnFocus: true }
  );
  const cdpStatus: CdpStatus = {
    active: cdpData?.active ?? false,
    windowCount: cdpData?.windowCount ?? 0,
    error: cdpData?.error ?? null,
  };

  const {
    data: convsData,
    mutate: mutateConversations,
    isValidating: isValidatingConversations,
    error: conversationsFetchError,
  } = useSWR<ConversationsResponse>(
    CONVERSATIONS_IDE_KEY,
    fetchConversationsWithTimeout,
    {
      dedupingInterval: 6000,
      errorRetryCount: 1,
      revalidateOnFocus: true,
    },
  );
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);
  const conversationLoadSeqRef = useRef(0);
  const conversationLoadPromiseRef = useRef<Promise<ConversationsResponse> | null>(null);
  const conversationSnapshotRef = useRef<{
    conversations: ConversationInfo[];
    projects: ConversationProjectGroup[];
    hasData: boolean;
  }>({ conversations: [], projects: [], hasData: false });
  const conversations: ConversationInfo[] = useMemo(
    () => convsData?.conversations || [],
    [convsData?.conversations],
  );
  const conversationProjects: ConversationProjectGroup[] = useMemo(
    () => convsData?.projects || [],
    [convsData?.projects],
  );
  const conversationSyncError = useMemo(() => {
    if (conversationsFetchError) {
      return conversationsFetchError instanceof Error
        ? conversationsFetchError.message
        : 'PC 端对话同步失败，当前显示本地历史。';
    }
    if (convsData?.cdpConnected === false) {
      return convsData.error || 'PC 端 CDP 未连接，当前显示本地历史。';
    }
    if (convsData?.stale && convsData.error) {
      return convsData.error;
    }
    return null;
  }, [conversationsFetchError, convsData?.cdpConnected, convsData?.error, convsData?.stale]);
  const activeConversation: ConversationInfo | null = useMemo(() => {
    return (
      conversations.find((c) => c.active) ||
      conversationProjects.flatMap(project => project.conversations).find((c) => c.active) ||
      null
    );
  }, [conversations, conversationProjects]);
  const didRestoreSelectionRef = useRef(false);

  const { data: recentData, mutate: mutateRecentProjects } = useSWR<{ recentProjects?: RecentProject[] }>(
    SWR_KEYS.recentProjects, fetcher, { revalidateOnFocus: true }
  );
  const recentProjects: RecentProject[] = recentData?.recentProjects || [];

  useEffect(() => {
    conversationSnapshotRef.current = {
      conversations,
      projects: conversationProjects,
      hasData: Boolean(convsData && (conversations.length > 0 || conversationProjects.length > 0)),
    };
  }, [conversationProjects, conversations, convsData]);

  const loadIdeConversations = useCallback(async () => {
    if (conversationLoadPromiseRef.current) return conversationLoadPromiseRef.current;

    const seq = conversationLoadSeqRef.current + 1;
    conversationLoadSeqRef.current = seq;
    const shouldShowLoading = !conversationSnapshotRef.current.hasData;
    if (shouldShowLoading) setIsLoadingConversations(true);

    let loadPromise: Promise<ConversationsResponse> | null = null;
    loadPromise = (async () => {
      try {
        const data = await fetchConversationsWithTimeout(CONVERSATIONS_IDE_KEY);
        if (seq === conversationLoadSeqRef.current) {
          mutateConversations(data, { revalidate: false });
        }
        return data;
      } catch (err) {
        const message = err instanceof DOMException && err.name === 'AbortError'
          ? 'PC 端对话同步超时，当前显示本地历史。'
          : err instanceof Error
            ? err.message
            : 'PC 端对话同步失败，当前显示本地历史。';
        const snapshot = conversationSnapshotRef.current;
        const fallback: ConversationsResponse = {
          conversations: snapshot.conversations,
          projects: snapshot.projects,
          source: snapshot.hasData ? 'ide' : 'brain',
          cdpConnected: snapshot.hasData,
          stale: snapshot.hasData,
          error: snapshot.hasData
            ? `${message} 已保留上次成功同步结果。`
            : message,
        };
        if (seq === conversationLoadSeqRef.current) {
          mutateConversations(fallback, { revalidate: false });
        }
        return fallback;
      } finally {
        if (conversationLoadPromiseRef.current === loadPromise) {
          conversationLoadPromiseRef.current = null;
        }
        if (seq === conversationLoadSeqRef.current) {
          setIsLoadingConversations(false);
        }
      }
    })();

    conversationLoadPromiseRef.current = loadPromise;
    return loadPromise;
  }, [mutateConversations]);

  // ── Mutations (POST actions) — revalidate SWR caches on success ──

  const startCdpServer = useCallback(async (projectDir?: string, killExisting?: boolean) => {
    try {
      const res = await fetch(`${API_BASE}/windows/cdp-start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectDir: projectDir || '.', killExisting: killExisting || false }),
      });
      const data = await res.json();
      if (data.success) {
        mutateCdpStatus();
        mutateWindows();
      }
      return data;
    } catch (e: any) {
      return { success: false, message: e.message || 'Failed to start CDP server' };
    }
  }, [mutateCdpStatus, mutateWindows]);

  const openNewWindow = useCallback(async (projectDir: string) => {
    try {
      const res = await fetch(`${API_BASE}/windows/open`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectDir }),
      });
      const data = await res.json();
      if (data.success) {
        mutateWindows();
        mutateCdpStatus();
        mutateRecentProjects();
        setTimeout(() => { void loadIdeConversations(); }, 600);
        setTimeout(() => { void loadIdeConversations(); }, 1800);
      }
      return data;
    } catch (e: any) {
      return { success: false, message: e.message || 'Failed to open window' };
    }
  }, [mutateWindows, mutateCdpStatus, mutateRecentProjects, loadIdeConversations]);

  const closeWindowByIndex = useCallback(async (index: number, targetId?: string) => {
    try {
      // Prefer targetId (stable CDP identifier) over positional index
      // to avoid the ordering mismatch between Puppeteer's browser.pages()
      // and the raw CDP /json endpoint.
      const body = targetId ? { targetId } : { index };
      const res = await fetch(`${API_BASE}/windows/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        mutateWindows();
        mutateCdpStatus();
      }
      return data;
    } catch (e: any) {
      return { success: false, message: e.message || 'Failed to close window' };
    }
  }, [mutateWindows, mutateCdpStatus]);

  const selectWindow = useCallback(async (idx: number) => {
    try {
      // Clear current chat and show welcome while we load the new window's history
      setShowWelcome(true);
      await fetch(`${API_BASE}/windows/select`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index: idx }),
      });
      mutateWindows();
      // Fetch the new window's chat history
      fetchHistory();
      // Refresh conversations list for the new window — use a short delay so the
      // server has time to settle the window context before we re-fetch.
      // A second pass fires 1.5s later to catch any slower propagation.
      setTimeout(() => { void loadIdeConversations(); }, 300);
      setTimeout(() => { void loadIdeConversations(); }, 1500);
      // Notify parent (for artifact sync etc.)
      onConversationSwitched?.();
    } catch { /* ignore */ }
  }, [mutateWindows, fetchHistory, setShowWelcome, loadIdeConversations, onConversationSwitched]);

  const selectConversation = useCallback(async (selection: ConversationSelection) => {
    const { title, index, id, projectName, projectPath } = getSelectionParts(selection);
    const hasUsableIndex = Number.isInteger(index) && (index as number) >= 0;
    if (!title && !hasUsableIndex && !id) return;

    const target = { title, index: hasUsableIndex ? index : undefined, id, projectName, projectPath };

    try {
      const res = await fetch(`${API_BASE}/conversations/select`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          id,
          projectName,
          projectPath,
          index: hasUsableIndex ? index : undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        persistSelectedConversation({ ...target, id: data.activeConversationId || target.id });
        setShowWelcome(false);
        mutateConversations((current) => current ? {
          ...current,
          conversations: (current.conversations || []).map((conversation) => ({
            ...conversation,
            active: isSameSelection(conversation, { ...target, id: data.activeConversationId || target.id }),
          })),
          projects: (current.projects || []).map((project) => ({
            ...project,
            conversations: project.conversations.map((conversation) => ({
              ...conversation,
              active: isSameSelection(conversation, { ...target, id: data.activeConversationId || target.id }),
            })),
          })),
        } : current, { revalidate: false });

        const canResolveImmediately =
          data.source === 'brain' ||
          data.activeConversationId ||
          !hasUsableIndex;

        if (canResolveImmediately) {
          loadIdeConversations();
          fetchHistory();
          onConversationSwitched?.();
          return;
        }

        let attempts = 0;
        const poll = async () => {
          attempts++;
          try {
            // Re-fetch conversations to see if active one has switched
            const dList = await fetchConversationsWithTimeout(CONVERSATIONS_IDE_KEY);
            const convs = dList.conversations || [];
            const active = convs.find((c: any) => c.active);
            if ((active && isSameSelection(active, { ...target, id: data.activeConversationId || target.id })) || attempts > 10) {
              // Update the SWR cache with this fresh data
              mutateConversations(dList, { revalidate: false });
              fetchHistory();
              // Notify parent that the switch is complete (for artifact sync)
              onConversationSwitched?.();
              return;
            }
          } catch { /* ignore */ }
          setTimeout(poll, 500);
        };
        poll();
      }
    } catch { /* ignore */ }
  }, [fetchHistory, setShowWelcome, mutateConversations, loadIdeConversations, onConversationSwitched]);

  useEffect(() => {
    if (didRestoreSelectionRef.current) return;
    if (!convsData) return;

    const persisted = readPersistedSelection();
    didRestoreSelectionRef.current = true;
    if (!persisted) return;

    const allConversations = [
      ...conversations,
      ...conversationProjects.flatMap(project => project.conversations),
    ];
    const restored = allConversations.find((conversation) => isSameSelection(conversation, persisted));

    if (restored?.active || (activeConversation && isSameSelection(activeConversation, persisted))) {
      return;
    }

    selectConversation(restored || persisted);
  }, [activeConversation, conversationProjects, conversations, convsData, selectConversation]);

  // ── Expose imperative refresh functions (backwards-compatible names) ──
  const loadWindows = mutateWindows;
  const loadConversations = loadIdeConversations;
  const checkCdpStatus = mutateCdpStatus;
  const loadRecentProjects = mutateRecentProjects;

  return {
    windows,
    conversations,
    conversationProjects,
    activeConversation,
    isLoadingConversations: isLoadingConversations || (isValidatingConversations && !convsData),
    conversationSyncError,
    cdpStatus,
    recentProjects,
    loadWindows,
    selectWindow,
    loadConversations,
    selectConversation,
    checkCdpStatus,
    startCdpServer,
    openNewWindow,
    closeWindowByIndex,
    loadRecentProjects,
  };
}
