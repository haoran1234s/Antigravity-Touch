'use client';

import { useRef, useCallback, useEffect, useState } from 'react';

const API_BASE = '/api/v1';

export interface MonitorEvent {
  type: string;
  [key: string]: unknown;
}

interface UseMonitorOptions {
  /** Called when any IDE event arrives */
  onEvent?: (event: MonitorEvent) => void;
  /** Called when the agent starts working (possibly from IDE) */
  onActivityStart?: () => void;
  /** Called when the agent finishes working */
  onActivityEnd?: (data: { toolCallCount: number; responseCount: number }) => void;
  /** Called when the conversation turn count changes (new message from IDE) */
  onTurnChange?: (data: { prevTurnCount: number; newTurnCount: number }) => void;
  /** Called when mode changes (planning/fast) */
  onModeChange?: (data: { prevMode: string; newMode: string }) => void;
  /** Called when a periodic sync arrives */
  onSync?: (data: Record<string, unknown>) => void;
  /** Called when the active desktop conversation changes */
  onConversationChange?: (data: { previous?: Record<string, unknown> | null; current?: Record<string, unknown> | null }) => void;
  /** Whether to auto-connect on mount. Default: true */
  autoConnect?: boolean;
}

/**
 * Hook that maintains a persistent SSE connection to the /api/v1/chat/monitor
 * endpoint. This provides real-time detection of IDE-side changes:
 * - Messages sent directly from the IDE
 * - Mode changes (Planning/Fast)
 * - Agent activity started/stopped externally
 * - Tool calls, responses, HITL, etc.
 */
export function useMonitor(options: UseMonitorOptions = {}) {
  const {
    onEvent,
    onActivityStart,
    onActivityEnd,
    onTurnChange,
    onModeChange,
    onSync,
    onConversationChange,
    autoConnect = true,
  } = options;

  const [isMonitoring, setIsMonitoring] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<number | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isConnectingRef = useRef(false);

  // Store callbacks in refs to avoid re-triggering connect/disconnect
  const onEventRef = useRef(onEvent);
  const onActivityStartRef = useRef(onActivityStart);
  const onActivityEndRef = useRef(onActivityEnd);
  const onTurnChangeRef = useRef(onTurnChange);
  const onModeChangeRef = useRef(onModeChange);
  const onSyncRef = useRef(onSync);
  const onConversationChangeRef = useRef(onConversationChange);

  onEventRef.current = onEvent;
  onActivityStartRef.current = onActivityStart;
  onActivityEndRef.current = onActivityEnd;
  onTurnChangeRef.current = onTurnChange;
  onModeChangeRef.current = onModeChange;
  onSyncRef.current = onSync;
  onConversationChangeRef.current = onConversationChange;

  const disconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (controllerRef.current) {
      controllerRef.current.abort();
      controllerRef.current = null;
    }
    setIsMonitoring(false);
    isConnectingRef.current = false;
  }, []);

  const connect = useCallback(async () => {
    // Prevent duplicate connections
    if (isConnectingRef.current || controllerRef.current) return;
    isConnectingRef.current = true;

    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      const res = await fetch(`${API_BASE}/chat/monitor`, {
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error(`Monitor connection failed: ${res.status}`);
      }

      setIsMonitoring(true);
      isConnectingRef.current = false;

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop()!;

        for (const line of lines) {
          // Skip SSE comments (heartbeat pings)
          if (line.startsWith(':')) continue;
          // Skip retry advisories
          if (line.startsWith('retry:')) continue;
          // Skip event IDs
          if (line.startsWith('id:')) continue;
          if (!line.startsWith('data: ')) continue;

          try {
            const payload = JSON.parse(line.slice(6));
            const { type, ...data } = payload;

            // Dispatch to generic handler
            onEventRef.current?.({ type, ...data });

            // Dispatch to specific handlers
            switch (type) {
              case 'activity_start':
                onActivityStartRef.current?.();
                break;
              case 'activity_end':
                onActivityEndRef.current?.(data as any);
                break;
              case 'turn_change':
                onTurnChangeRef.current?.(data as any);
                break;
              case 'mode_change':
                onModeChangeRef.current?.(data as any);
                break;
              case 'sync':
                setLastSyncTime(Date.now());
                onSyncRef.current?.(data);
                break;
              case 'conversation_change':
                onConversationChangeRef.current?.(data as any);
                break;
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }
    } catch (e: any) {
      if (e.name === 'AbortError') {
        // Intentional disconnect
        return;
      }
      console.warn('[Monitor] Connection lost:', e.message);
    } finally {
      controllerRef.current = null;
      isConnectingRef.current = false;
      setIsMonitoring(false);

      // Auto-reconnect after 3s unless intentionally disconnected
      if (!controller.signal.aborted) {
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          connect();
        }, 3000);
      }
    }
  }, []);

  // Auto-connect on mount
  useEffect(() => {
    if (autoConnect) {
      connect();
    }
    return () => {
      disconnect();
    };
  }, [autoConnect, connect, disconnect]);

  return {
    isMonitoring,
    lastSyncTime,
    connect,
    disconnect,
  };
}
