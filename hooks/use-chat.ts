'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { useConversations } from './use-conversations';
import { useArtifacts } from './use-artifacts';
import { useChanges } from './use-changes';
import { useGit } from './use-git';
import { useWorkspace } from './use-workspace';
import { useMonitor } from './use-monitor';
import type { ChatMessage, SSEStep } from '@/lib/types';
import { fetcher, SWR_KEYS } from '@/lib/swr-fetcher';

const API_BASE = '/api/v1';
const SELECTED_CONVERSATION_KEY = 'antigravity-mobile:selected-conversation:v1';

type NewChatTarget = {
  name?: string;
  path?: string;
  projectName?: string;
  projectPath?: string;
};

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [statusText, setStatusText] = useState('Agent');
  const [statusState, setStatusState] = useState('connected');
  const [showWelcome, setShowWelcome] = useState(true);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [currentSteps, setCurrentSteps] = useState<SSEStep[]>([]);
  const [currentResponse, setCurrentResponse] = useState('');
  const [currentMode, setCurrentMode] = useState<'planning' | 'fast'>('planning');
  const [currentAgent, setCurrentAgent] = useState<string | null>(null);
  const [agents, setAgents] = useState<{ name: string; active: boolean; description?: string }[]>([]);
  const [isLoadingAgents, setIsLoadingAgents] = useState(false);
  const [isAgentBusy, setIsAgentBusy] = useState(false);
  const [isMonitorConnected, setIsMonitorConnected] = useState(false);
  const [isSyncingDesktop, setIsSyncingDesktop] = useState(false);

  // ── Network Online/Offline detection (browser-native events) ──
  const [networkOnline, setNetworkOnline] = useState(true);
  useEffect(() => {
    // Initialise from browser's current state
    setNetworkOnline(navigator.onLine);
    const handleOnline  = () => setNetworkOnline(true);
    const handleOffline = () => setNetworkOnline(false);
    window.addEventListener('online',  handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online',  handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);
  
  const controllerRef = useRef<AbortController | null>(null);
  const streamPromiseRef = useRef<Promise<void> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const currentResponseRef = useRef('');
  const currentStepsRef = useRef<SSEStep[]>([]);

  // Global mutate for revalidating any SWR key from anywhere
  const { mutate: globalMutate } = useSWRConfig();

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    });
  }, []);

  const setStatus = useCallback((state: string, text: string) => {
    setStatusState(state);
    setStatusText(text);
  }, []);

  // ── SWR-powered health check ──
  // Poll every 5s when offline to detect recovery quickly; 30s otherwise.
  const { data: healthData, mutate: mutateHealth } = useSWR(SWR_KEYS.health, fetcher, {
    refreshInterval: networkOnline ? 30000 : 5000,
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    onSuccess: (data) => {
      setIsConnected(data.connected);
      if (!networkOnline) setNetworkOnline(true); // server responded ⟹ network back
      setStatus(
        data.connected ? 'connected' : 'disconnected',
        data.connected ? 'Agent' : (data.network === false ? 'Offline' : 'Reconnecting…')
      );
    },
    onError: () => {
      setIsConnected(false);
      setStatus('disconnected', networkOnline ? 'Reconnecting…' : 'Offline');
    },
  });

  // When the browser reports we're back online, immediately revalidate health
  useEffect(() => {
    if (networkOnline) mutateHealth();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [networkOnline]);

  // ── SWR-powered mode fetch ──
  const { mutate: mutateMode } = useSWR(SWR_KEYS.mode, fetcher, {
    revalidateOnFocus: false,
    onSuccess: (data) => {
      if (data.mode) setCurrentMode(data.mode);
    },
  });

  // ── SWR-powered agent fetch ──
  const { mutate: mutateAgent } = useSWR(SWR_KEYS.agent, fetcher, {
    revalidateOnFocus: false,
    onSuccess: (data) => {
      if (data.agent) setCurrentAgent(data.agent);
    },
  });

  // ── SWR-powered history fetch ──
  const { mutate: mutateHistory } = useSWR(SWR_KEYS.history, fetcher, {
    revalidateOnFocus: false,
    revalidateOnMount: true,
    onSuccess: (data) => {
      setIsLoadingHistory(false);
      if (data.turns && data.turns.length > 0) {
        setShowWelcome(false);
        setMessages(data.turns.map((t: any) => ({ role: t.role, content: t.content })));
      } else {
        setShowWelcome(true);
      }
    },
    onError: () => {
      setIsLoadingHistory(false);
    },
  });

  // 手动刷新历史记录，并在加载期间清空当前消息。
  const fetchHistory = useCallback(async () => {
    setIsLoadingHistory(true);
    setMessages([]);
    await mutateHistory();
  }, [mutateHistory]);

  const {
    artifactFiles,
    artifactPanelOpen,
    toggleArtifactPanel,
    openArtifactPanel,
    loadArtifacts
  } = useArtifacts();

  const {
    changeFiles,
    changesPanelOpen,
    toggleChangesPanel,
    loadChanges,
    acceptAllChanges,
    rejectAllChanges,
    isAccepting,
    isRejecting,
  } = useChanges();

  const {
    gitStatus,
    gitPanelOpen,
    gitChangedCount,
    toggleGitPanel,
    refreshGit,
  } = useGit();

  const {
    workspaceTree,
    workspacePanelOpen,
    workspaceLoading,
    toggleWorkspacePanel,
    refreshWorkspace,
  } = useWorkspace();

  // Refresh artifact and changes data when a conversation switch completes
  // (but don't auto-open the panel — let the user decide)
  const handleConversationSwitched = useCallback(() => {
    setShowWelcome(false);
  }, []);

  const {
    windows,
    conversations,
    conversationProjects,
    activeConversation,
    isLoadingConversations,
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
  } = useConversations(fetchHistory, setShowWelcome, handleConversationSwitched);

  const toggleMode = useCallback(async () => {
    const newMode = currentMode === 'planning' ? 'fast' : 'planning';
    setCurrentMode(newMode); // Optimistic update
    try {
      const res = await fetch(`${API_BASE}/chat/mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: newMode }),
      });
      const data = await res.json();
      if (data.mode) setCurrentMode(data.mode);
      // Revalidate the SWR cache for mode
      mutateMode();
    } catch {
      setCurrentMode(currentMode); // Rollback on error
    }
  }, [currentMode, mutateMode]);

  const fetchAgentList = useCallback(async () => {
    setIsLoadingAgents(true);
    try {
      const res = await fetch(`${API_BASE}/chat/agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list' }),
      });
      const data = await res.json();
      if (data.agents) setAgents(data.agents);
      if (data.currentAgent) setCurrentAgent(data.currentAgent);
    } catch { /* ignore */ }
    setIsLoadingAgents(false);
  }, []);

  const switchAgent = useCallback(async (agentName: string) => {
    const prevAgent = currentAgent;
    setCurrentAgent(agentName); // Optimistic update
    try {
      const res = await fetch(`${API_BASE}/chat/agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'switch', agent: agentName }),
      });
      const data = await res.json();
      if (data.agent) setCurrentAgent(data.agent);
      else if (!data.success) setCurrentAgent(prevAgent); // Rollback
      // Revalidate agent cache
      mutateAgent();
    } catch {
      setCurrentAgent(prevAgent); // Rollback on error
    }
  }, [currentAgent, mutateAgent]);

  const handleSSEvent = useCallback((payload: any) => {
    const { type, ...data } = payload;

    switch (type) {
      case 'tool_call':
        // Update existing tool call in-place, or append if new
        setCurrentSteps(prev => {
          const existingIdx = prev.findIndex(
            s => s.type === 'tool_call' && s.data?.id === data.id
          );
          let updated;
          if (existingIdx >= 0) {
            updated = [...prev];
            updated[existingIdx] = { type, data };
          } else {
            updated = [...prev, { type, data }];
          }
          currentStepsRef.current = updated;
          return updated;
        });
        break;

      case 'thinking':
      case 'hitl':
      case 'error':
      case 'notification':
        setCurrentSteps(prev => {
          const updated = [...prev, { type, data }];
          currentStepsRef.current = updated;
          return updated;
        });
        break;

      case 'file_change':
        setCurrentSteps(prev => {
          const updated = [...prev, { type, data }];
          currentStepsRef.current = updated;
          return updated;
        });
        // Instant refresh: agent just changed a file — update badge counts
        loadArtifacts();
        loadChanges();
        break;

      case 'response':
        setCurrentResponse(data.content || '');
        currentResponseRef.current = data.content || '';
        break;

      case 'status':
        setStatus(data.isRunning ? 'streaming' : 'connected', data.isRunning ? 'Agent working...' : 'Agent');
        break;

      case 'done':
        if (data.finalResponse) {
          setCurrentResponse(data.finalResponse);
          currentResponseRef.current = data.finalResponse;
        }
        setStatus('connected', 'Agent');
        setIsStreaming(false);
        // Final refresh: agent finished — ensure badge counts are up-to-date
        loadArtifacts();
        loadChanges();
        break;
    }
    scrollToBottom();
  }, [setStatus, scrollToBottom, loadArtifacts, loadChanges]);

  const finalizeObservedAgentMessage = useCallback(() => {
    const finalResponse = currentResponseRef.current;
    const finalSteps = [...currentStepsRef.current];

    setIsStreaming(false);
    setCurrentResponse('');
    setCurrentSteps([]);
    currentResponseRef.current = '';
    currentStepsRef.current = [];

    if (finalResponse || finalSteps.length > 0) {
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.role === 'agent' && last.content === finalResponse) return prev;
        return [...prev, { role: 'agent', content: finalResponse, steps: finalSteps }];
      });
    }
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim()) return;

    // ── Interrupt any in-flight stream ──────────────────────────────────────
    // Abort the active controller so the current stream throws AbortError,
    // then await the promise so its finally{} block can save the partial
    // response before we overwrite shared state below.
    // Also call /chat/stop to click the IDE's cancel button via CDP.
    if (controllerRef.current) {
      controllerRef.current.abort();
      controllerRef.current = null;
      // Fire IDE stop in parallel — don't await so we don't block the abort
      fetch(`${API_BASE}/chat/stop`, { method: 'POST' }).catch(() => {/* ignore */});
    }
    if (streamPromiseRef.current) {
      await streamPromiseRef.current;
      streamPromiseRef.current = null;
    }
    // ────────────────────────────────────────────────────────────────────────

    setShowWelcome(false);
    const trimmed = text.trim();

    setMessages(prev => [...prev, { role: 'user', content: trimmed }]);
    setIsStreaming(true);
    setCurrentSteps([]);
    setCurrentResponse('');
    currentResponseRef.current = '';
    currentStepsRef.current = [];
    setStatus('streaming', 'Agent typing...');

    const controller = new AbortController();
    controllerRef.current = controller;

    const doStream = async () => { try {
      let lastEventId = '';
      let attempt = 0;
      const MAX_RETRIES = 5;
      const RETRY_DELAY_MS = 2000;

      while (attempt <= MAX_RETRIES) {
        let streamEnded = false;
        try {
          const headers: Record<string, string> = { 'Content-Type': 'application/json' };
          if (lastEventId) headers['Last-Event-ID'] = lastEventId;

          const res = await fetch(`${API_BASE}/chat/stream`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ message: trimmed }),
            signal: controller.signal,
          });

          const reader = res.body!.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          let gotDone = false;

          while (true) {
            const { done, value } = await reader.read();
            if (done) { streamEnded = true; break; }

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop()!;

            for (const line of lines) {
              // SSE comment (heartbeat ping) — ignore
              if (line.startsWith(':')) continue;
              // Track Last-Event-ID for reconnect
              if (line.startsWith('id: ')) {
                lastEventId = line.slice(4).trim();
                continue;
              }
              // Reconnect advisory — no action needed (server already sets it)
              if (line.startsWith('retry:')) continue;
              if (!line.startsWith('data: ')) continue;
              try {
                const payload = JSON.parse(line.slice(6));
                handleSSEvent(payload);
                if (payload.type === 'done') gotDone = true;
              } catch { /* skip malformed */ }
            }

            if (gotDone) break;
          }

          // Clean exit — done event received or stream finished normally
          if (gotDone || !streamEnded) break;

          // Stream ended unexpectedly without a `done` event — reconnect
          attempt++;
          if (attempt > MAX_RETRIES) break;
          console.warn(`[SSE] Stream dropped (attempt ${attempt}/${MAX_RETRIES}), reconnecting in ${RETRY_DELAY_MS}ms...`);
          await new Promise(r => setTimeout(r, RETRY_DELAY_MS));

        } catch (e: any) {
          if (e.name === 'AbortError') throw e; // User cancelled — don't retry
          attempt++;
          if (attempt > MAX_RETRIES) throw e;
          console.warn(`[SSE] Fetch error (attempt ${attempt}/${MAX_RETRIES}):`, e.message);
          await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
        }
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        setCurrentSteps(prev => [...prev, { type: 'error', data: { message: e.message } }]);
        setStatus('error', 'Error');
      }
    } finally {
      const finalResponse = currentResponseRef.current;
      const finalSteps = [...currentStepsRef.current];

      setIsStreaming(false);
      if (controllerRef.current === controller) controllerRef.current = null;

      if (finalResponse || finalSteps.length > 0) {
        setMessages(prev => [
          ...prev,
          { role: 'agent', content: finalResponse, steps: finalSteps },
        ]);
      }
      setStatus('connected', 'Agent');
    } }; // end doStream

    streamPromiseRef.current = doStream();
    await streamPromiseRef.current;
  }, [handleSSEvent, setStatus]);

  const startNewChat = useCallback(async (project?: NewChatTarget) => {
    if (controllerRef.current) controllerRef.current.abort();
    try {
      window.localStorage.removeItem(SELECTED_CONVERSATION_KEY);
    } catch { /* ignore storage failures */ }
    setMessages([]);
    setCurrentSteps([]);
    setCurrentResponse('');
    setShowWelcome(true);

    try {
      const projectName = project?.projectName || project?.name;
      const projectPath = project?.projectPath || project?.path;
      const res = await fetch(`${API_BASE}/chat/new`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectName, projectPath }),
      });
      const data = await res.json();
      if (data.success) {
        setStatus('connected', projectName ? `New Chat - ${projectName}` : 'New Chat');
        setTimeout(() => loadConversations(), 600);
      }
    } catch { /* ignore */ }
  }, [setStatus, loadConversations]);

  const stopStreaming = useCallback(() => {
    // 1) Cancel the SSE stream on the proxy side
    if (controllerRef.current) {
      controllerRef.current.abort();
      controllerRef.current = null;
    }
    // 2) Tell the real IDE window to stop the agent via CDP
    //    Fire-and-forget — we don't need to await this for the UI to react.
    fetch(`${API_BASE}/chat/stop`, { method: 'POST' }).catch(() => {/* ignore */});
  }, []);

  const approve = useCallback(async () => {
    try {
      await fetch(`${API_BASE}/chat/approve`, { method: 'POST' });
      setStatus('streaming', 'Agent');
    } catch { /* ignore */ }
  }, [setStatus]);

  const reject = useCallback(async () => {
    try {
      await fetch(`${API_BASE}/chat/reject`, { method: 'POST' });
    } catch { /* ignore */ }
  }, []);

  // ── 被动 IDE 监控 ──
  // 只读监听 PC 端状态变化，同步消息、模式和 Agent 运行状态。
  const isStreamingRef = useRef(isStreaming);
  isStreamingRef.current = isStreaming;

  const { isMonitoring } = useMonitor({
    autoConnect: true,
    onActivityStart: () => {
      setIsAgentBusy(true);
      // controllerRef 只在手机端主动发起 /chat/stream 时存在。
      // 如果 PC 端直接开始工作，手机端仅镜像为实时流状态。
      if (!controllerRef.current) {
        if (!isStreamingRef.current) {
          setShowWelcome(false);
          setIsStreaming(true);
          setCurrentSteps([]);
          setCurrentResponse('');
          currentStepsRef.current = [];
          currentResponseRef.current = '';
        }
        setStatusState('streaming');
        setStatusText('Agent working...');
      }
    },
    onActivityEnd: () => {
      setIsAgentBusy(false);
      if (!controllerRef.current) {
        finalizeObservedAgentMessage();
        void mutateHistory();
        void loadArtifacts();
        void loadChanges();
        void refreshGit();
        setStatusState('connected');
        setStatusText('Agent');
      }
    },
    onTurnChange: () => {
      if (!controllerRef.current) {
        setShowWelcome(false);
        void mutateHistory();
      }
    },
    onModeChange: ({ newMode }) => {
      setCurrentMode(newMode as 'planning' | 'fast');
    },
    onSync: (data) => {
      if (typeof data.isRunning === 'boolean') {
        setIsAgentBusy(data.isRunning as boolean);
        if (!controllerRef.current && data.isRunning && !isStreamingRef.current) {
          setShowWelcome(false);
          setIsStreaming(true);
          setStatusState('streaming');
          setStatusText('Agent working...');
        }
        if (!controllerRef.current && !data.isRunning && isStreamingRef.current) {
          finalizeObservedAgentMessage();
          setStatusState('connected');
          setStatusText('Agent');
        }
      }
      if ((data as any).activeConversation) {
        void mutateHistory();
        void loadArtifacts();
        void loadChanges();
        void refreshGit();
      }
    },
    onConversationChange: () => {
      if (controllerRef.current) return;
      finalizeObservedAgentMessage();
      setShowWelcome(false);
      void fetchHistory();
      void loadConversations();
      void loadArtifacts();
      void loadChanges();
      void refreshGit();
    },
    onEvent: (event) => {
      if (!controllerRef.current && (event.type === 'tool_call' || event.type === 'response' || event.type === 'thinking' || event.type === 'hitl' || event.type === 'notification')) {
        if (!isStreamingRef.current) {
          setShowWelcome(false);
          setIsStreaming(true);
        }
        handleSSEvent(event as any);
      }
    },
  });

  useEffect(() => {
    setIsMonitorConnected(isMonitoring);
  }, [isMonitoring]);

  const syncDesktopState = useCallback(async () => {
    setIsSyncingDesktop(true);
    setStatusState('syncing');
    setStatusText('同步 PC...');
    try {
      await Promise.allSettled([
        mutateMode(),
        mutateAgent(),
        loadConversations(),
        fetchHistory(),
        loadArtifacts(),
        loadChanges(),
        refreshGit(),
      ]);
      setStatusState('connected');
      setStatusText('Agent');
    } finally {
      setIsSyncingDesktop(false);
    }
  }, [mutateMode, mutateAgent, loadConversations, fetchHistory, loadArtifacts, loadChanges, refreshGit]);

  useEffect(scrollToBottom, [messages, currentSteps, currentResponse, scrollToBottom]);

  return {
    messages, isStreaming, isConnected, statusText, statusState,
    showWelcome, isLoadingHistory, currentSteps, currentResponse, windows,
    conversations, conversationProjects, activeConversation, artifactFiles, artifactPanelOpen,
    changeFiles, changesPanelOpen, acceptAllChanges, rejectAllChanges, isAccepting, isRejecting,
    gitStatus, gitPanelOpen, gitChangedCount, toggleGitPanel, refreshGit,
    workspaceTree, workspacePanelOpen, workspaceLoading, toggleWorkspacePanel, refreshWorkspace,
    currentMode, currentAgent, agents, isLoadingAgents,
    cdpStatus, recentProjects, isLoadingConversations, conversationSyncError,
    isAgentBusy, isMonitorConnected, isSyncingDesktop,
    networkOnline,
    sendMessage, stopStreaming, startNewChat, approve, reject,
    selectWindow, selectConversation, loadConversations, toggleArtifactPanel, openArtifactPanel,
    toggleChangesPanel,
    toggleMode, fetchAgentList, switchAgent, syncDesktopState,
    startCdpServer, openNewWindow, closeWindowByIndex,
    messagesEndRef, setShowWelcome,
  };
}
