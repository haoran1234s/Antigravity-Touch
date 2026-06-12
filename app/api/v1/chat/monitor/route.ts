import { NextRequest } from 'next/server';
import { ensureCdpConnection } from '@/lib/init';
import ctx from '@/lib/context';
import { getFullAgentState } from '@/lib/scraper/agent-state';
import { getAgentMode } from '@/lib/scraper/agent-mode';
import { getActiveIdeConversation } from '@/lib/scraper/ide-conversations';
import { diffStates } from '@/lib/sse/diff-states';
import type { AgentState, ToolCall } from '@/lib/types';

export const dynamic = 'force-dynamic';

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise
      .then(resolve)
      .catch(reject)
      .finally(() => clearTimeout(timer));
  });
}

function createEmptyAgentState(): AgentState {
  return {
    isRunning: false,
    turnCount: 0,
    stepGroupCount: 0,
    thinking: [],
    toolCalls: [],
    responses: [],
    notifications: [],
    error: null,
    fileChanges: [],
    lastTurnResponseHTML: '',
  };
}

/**
 * GET /api/v1/chat/monitor — Passive SSE monitor endpoint.
 *
 * Unlike `/chat/stream` (which is request-scoped to a single `sendMessage`),
 * this endpoint keeps a long-lived SSE connection open and continuously polls
 * the IDE DOM for ANY state changes — including those initiated directly from
 * the IDE window (e.g. typing a message, switching modes, agent activity
 * triggered from the IDE).
 *
 * Events emitted:
 *  - All standard SSE events (tool_call, response, thinking, hitl, etc.)
 *  - `mode_change`  — when Planning/Fast mode changes
 *  - `turn_change`  — when a new conversation turn appears (user or agent)
 *  - `activity_start` — agent starts working (not triggered by our sendMessage)
 *  - `activity_end`   — agent finishes working
 *  - `sync`           — periodic full state snapshot for reconciliation
 */
export async function GET(request: NextRequest) {
  try {
    await withTimeout(ensureCdpConnection(), 3500, '连接 PC 端 CDP 超时');
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: e?.message || 'PC 端 CDP 未连接' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (!ctx.workbenchPage) {
    return new Response(
      JSON.stringify({ error: 'Not connected to Antigravity' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let eventId = 0;

      const writeRaw = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          // Controller may already be closed
        }
      };

      const writeEvent = (type: string, data: Record<string, unknown>) => {
        try {
          const payload = JSON.stringify({ ...data, type });
          writeRaw(`id: ${++eventId}\ndata: ${payload}\n\n`);
        } catch {
          // Controller may already be closed
        }
      };

      // SSE retry advisory
      writeRaw('retry: 3000\n\n');

      let closed = false;
      const closeStream = () => {
        if (closed) return;
        closed = true;
        try { controller.close(); } catch { /* already closed */ }
      };

      // Heartbeat to keep the connection alive through proxies
      const heartbeat = setInterval(() => {
        if (closed) { clearInterval(heartbeat); return; }
        writeRaw(': ping\n\n');
      }, 10000);

      try {
        // Initial state capture
        let domReadBusy = false;
        const runDomRead = <T>(work: () => Promise<T>, timeoutMs: number, message: string) => {
          if (domReadBusy) return Promise.reject(new Error('上一轮 PC 状态读取仍在进行'));
          domReadBusy = true;
          let promise: Promise<T>;
          try {
            promise = work();
          } catch (e) {
            domReadBusy = false;
            return Promise.reject(e);
          }
          promise.finally(() => { domReadBusy = false; }).catch(() => undefined);
          return withTimeout(promise, timeoutMs, message);
        };
        const readAgentState = () => runDomRead(() => getFullAgentState(ctx), 2500, '读取 PC 状态超时');
        const readMode = () => runDomRead(() => getAgentMode(ctx), 1000, '读取 PC 模式超时');
        const readConversation = () => runDomRead(() => getActiveIdeConversation(ctx), 1200, '读取 PC 当前对话超时');

        let prevState = await readAgentState().catch(() => createEmptyAgentState());
        let prevMode = 'unknown';
        try { prevMode = await readMode(); } catch { /* ignore */ }
        let prevTurnCount = prevState.turnCount;
        let prevConversation = await readConversation().catch(() => null);
        let wasRunning = prevState.isRunning;
        let syncCounter = 0;
        let polling = false;
        const sessionToolCalls = new Map<string, ToolCall>();

        // Seed initial tool calls
        for (const t of prevState.toolCalls) {
          sessionToolCalls.set(t.id, t);
        }

        // Send initial sync so the frontend knows the current state
        writeEvent('sync', {
          isRunning: prevState.isRunning,
          turnCount: prevState.turnCount,
          mode: prevMode,
          toolCallCount: prevState.toolCalls.length,
          responseCount: prevState.responses.length,
          hasError: !!prevState.error,
          activeConversation: prevConversation,
        });

        // 串行轮询：上一轮还没完成时直接跳过，避免和会话同步抢同一个 CDP 页面。
        const interval = setInterval(async () => {
          if (closed) { clearInterval(interval); return; }
          if (polling) return;
          polling = true;

          try {
            const currState = await readAgentState();
            const currConversation = await readConversation().catch(() => null);

            if (
              currConversation &&
              (
                currConversation.id !== prevConversation?.id ||
                currConversation.title !== prevConversation?.title ||
                currConversation.url !== prevConversation?.url
              )
            ) {
              ctx.activeConversationId = currConversation.id || ctx.activeConversationId;
              ctx.activeTitle = currConversation.title;
              ctx.activeConversationSource = 'ide';
              writeEvent('conversation_change', {
                previous: prevConversation,
                current: currConversation,
              });
              prevConversation = currConversation;
            }

            // ── New turn detection (someone typed from the IDE) ──
            if (currState.turnCount > prevTurnCount) {
              writeEvent('turn_change', {
                prevTurnCount: prevTurnCount,
                newTurnCount: currState.turnCount,
                delta: currState.turnCount - prevTurnCount,
              });

              // Reset session tracking for the new turn
              sessionToolCalls.clear();
              prevTurnCount = currState.turnCount;
            }

            // ── Activity start/end detection ──
            if (currState.isRunning && !wasRunning) {
              writeEvent('activity_start', {
                turnCount: currState.turnCount,
                source: 'ide', // Could be from IDE if we didn't trigger it
              });
            } else if (!currState.isRunning && wasRunning) {
              writeEvent('activity_end', {
                turnCount: currState.turnCount,
                toolCallCount: currState.toolCalls.length,
                responseCount: currState.responses.length,
              });
            }
            wasRunning = currState.isRunning;

            // ── Accumulate tool calls (survive virtualization) ──
            for (const t of currState.toolCalls) {
              sessionToolCalls.set(t.id, t);
            }
            currState.toolCalls = Array.from(sessionToolCalls.values());

            // ── Compute and emit diffs ──
            const events = diffStates(prevState, currState);
            for (const evt of events) {
              writeEvent(evt.type, evt.data);
            }

            // ── Mode change detection ──
            try {
              const currMode = await readMode();
              if (currMode !== prevMode) {
                writeEvent('mode_change', {
                  prevMode,
                  newMode: currMode,
                });
                prevMode = currMode;
              }
            } catch {
              // Mode detection can fail transiently — ignore
            }

            // ── Periodic sync (every ~30s = 37 polls × 800ms) ──
            syncCounter++;
            if (syncCounter >= 37) {
              syncCounter = 0;
              writeEvent('sync', {
                isRunning: currState.isRunning,
                turnCount: currState.turnCount,
                mode: prevMode,
                toolCallCount: currState.toolCalls.length,
                responseCount: currState.responses.length,
                hasError: !!currState.error,
                activeConversation: currConversation,
              });
            }

            prevState = currState;
          } catch (e: any) {
            // Transient poll errors — don't kill the stream
            console.error('[Monitor] Poll error:', e.message);
          } finally {
            polling = false;
          }
        }, 1500);

        // Handle client disconnect
        request.signal.addEventListener('abort', () => {
          clearInterval(interval);
          clearInterval(heartbeat);
          closeStream();
        });
      } catch (e: any) {
        writeEvent('error', { message: e.message });
        clearInterval(heartbeat);
        closeStream();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
