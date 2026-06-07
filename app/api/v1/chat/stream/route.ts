import { NextRequest } from 'next/server';
import { ensureCdpConnection } from '@/lib/init';
import ctx from '@/lib/context';
import { sendMessage } from '@/lib/actions/send-message';
import { getFullAgentState } from '@/lib/scraper/agent-state';
import { diffStates } from '@/lib/sse/diff-states';
import type { AgentState, ToolCall } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/chat/stream — SSE streaming endpoint.
 * Sends a message and streams agent state diffs as Server-Sent Events.
 */
export async function POST(request: NextRequest) {
  await ensureCdpConnection();
  if (!ctx.workbenchPage) {
    return new Response(
      JSON.stringify({ error: 'Not connected to Antigravity' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const body = await request.json();
  const { message } = body;
  if (!message) {
    return new Response(
      JSON.stringify({ error: 'message is required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
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
          // Include SSE `id:` field so browsers can resume with Last-Event-ID
          writeRaw(`id: ${++eventId}\ndata: ${payload}\n\n`);
        } catch {
          // Controller may already be closed
        }
      };

      // Send retry advisory once: tell browser to reconnect after 3s if dropped
      writeRaw('retry: 3000\n\n');

      let closed = false;
      const closeStream = () => {
        if (closed) return;
        closed = true;
        try { controller.close(); } catch { /* already closed */ }
      };

      // Heartbeat: send a comment ping every 15s to prevent proxy/firewall
      // from closing idle SSE connections (many proxies have a 30-120s timeout).
      // SSE comments (lines starting with ':') are ignored by EventSource/fetch
      // consumers but reset the TCP keep-alive timer.
      const heartbeat = setInterval(() => {
        if (closed) { clearInterval(heartbeat); return; }
        writeRaw(': ping\n\n');
      }, 5000);

      try {
        writeEvent('status', { isRunning: true, phase: 'sending' });

        // Capture initial state before sending
        let prevState = await getFullAgentState(ctx);
        const sessionToolCalls = new Map<string, ToolCall>();
        let sessionResponses: string[] = [];

        await sendMessage(ctx, message);

        writeEvent('status', { isRunning: true, phase: 'waiting' });

        const startTime = Date.now();
        let doneCount = 0;
        let started = false;
        let lastStableHTML = '';
        const initialTurnCount = prevState.turnCount;
        const initialResponseCount = prevState.responses.length;
        const initialNotificationCount = prevState.notifications.length;
        let scopedToNewTurn = false;
        let pollErrorCount = 0;

        const interval = setInterval(async () => {
          if (closed) { clearInterval(interval); return; }

          try {
            const currState = await getFullAgentState(ctx);
            pollErrorCount = 0; // Reset on success

            // Track tools by ID to survive virtualization
            if (currState.turnCount > initialTurnCount) {
              scopedToNewTurn = true;
            }
            if (scopedToNewTurn) {
              currState.responses = currState.responses.slice(initialResponseCount);
              currState.notifications = currState.notifications.slice(initialNotificationCount);
            }

            if (currState.turnCount > prevState.turnCount) {
              sessionToolCalls.clear();
              sessionResponses = [];
              prevState = {
                ...prevState,
                toolCalls: [],
                responses: [],
                thinking: [],
                notifications: [],
                fileChanges: [],
              };
            }
            for (const t of currState.toolCalls) {
              sessionToolCalls.set(t.id, t);
            }
            currState.toolCalls = Array.from(sessionToolCalls.values());

            // Accumulate responses to survive DOM virtualization
            if (currState.responses.length > sessionResponses.length) {
              sessionResponses = [...currState.responses];
            } else if (
              currState.responses.length < sessionResponses.length &&
              currState.responses.length > 0
            ) {
              const lastIdx = currState.responses.length - 1;
              sessionResponses[sessionResponses.length - 1] =
                currState.responses[lastIdx];
            } else if (
              currState.responses.length === sessionResponses.length &&
              currState.responses.length > 0
            ) {
              sessionResponses[sessionResponses.length - 1] =
                currState.responses[currState.responses.length - 1];
            }
            currState.responses = [...sessionResponses];

            // Detect start
            if (!started) {
              if (
                currState.isRunning ||
                currState.turnCount > initialTurnCount ||
                currState.toolCalls.length > prevState.toolCalls.length ||
                currState.responses.length > prevState.responses.length ||
                currState.thinking.length > prevState.thinking.length
              ) {
                started = true;
                writeEvent('status', { isRunning: true, phase: 'processing' });
              }
            }

            // Check for unresolved tools
            const hasUnresolvedTools = Array.from(
              sessionToolCalls.values()
            ).some((t) => t.hasCancelBtn && !t.exitCode);

            // Compute and emit diffs
            const events = diffStates(prevState, currState);
            for (const evt of events) {
              writeEvent(evt.type, evt.data);
            }

            // Check for completion
            if (started && !currState.isRunning && !currState.error && !hasUnresolvedTools) {
              const contentChanged =
                currState.toolCalls.length !== prevState.toolCalls.length ||
                currState.responses.length !== prevState.responses.length ||
                currState.thinking.length !== prevState.thinking.length ||
                currState.notifications.length !== prevState.notifications.length ||
                currState.fileChanges.length !== prevState.fileChanges.length ||
                currState.stepGroupCount !== prevState.stepGroupCount ||
                (currState.responses.length > 0 &&
                  prevState.responses.length > 0 &&
                  currState.responses[currState.responses.length - 1] !==
                  prevState.responses[prevState.responses.length - 1]) ||
                currState.lastTurnResponseHTML !== prevState.lastTurnResponseHTML;

              if (contentChanged) {
                doneCount = 0;
                lastStableHTML = '';
              } else if (Date.now() - ctx.lastActionTimestamp < 3000) {
                doneCount = 0;
                lastStableHTML = '';
              } else {
                doneCount++;
              }

              const currentHTML = currState.lastTurnResponseHTML || '';
              if (doneCount >= 2 && currentHTML && currentHTML !== lastStableHTML) {
                doneCount = 1;
              }
              lastStableHTML = currentHTML;

              const hasSubagentTools = currState.toolCalls.some(
                (t) =>
                  t.type === 'browser' ||
                  (t.status || '').toLowerCase().includes('subagent') ||
                  (t.status || '').toLowerCase().includes('navigat')
              );
              const requiredDoneCount = hasSubagentTools ? 8 : 4;
              if (doneCount >= requiredDoneCount) {
                const finalResponse =
                  currState.notifications.length > 0
                    ? currState.notifications[currState.notifications.length - 1]
                    : currState.responses.length > 0
                      ? currState.responses[currState.responses.length - 1]
                      : '';

                writeEvent('done', {
                  finalResponse,
                  isHTML: true,
                  thinking: currState.thinking,
                  toolCalls: currState.toolCalls,
                });
                clearInterval(interval);
                closeStream();
                return;
              }
            } else {
              doneCount = 0;
              lastStableHTML = '';
            }

            // Error
            if (currState.error) {
              writeEvent('error', { message: currState.error });
              writeEvent('done', { error: currState.error });
              clearInterval(interval);
              closeStream();
              return;
            }

            // Timeout (10 min)
            if (Date.now() - startTime > 600000) {
              const finalResponse =
                currState.responses.length > 0
                  ? currState.responses[currState.responses.length - 1]
                  : '[Timeout]';
              writeEvent('done', { finalResponse, timeout: true });
              clearInterval(interval);
              closeStream();
              return;
            }

            prevState = currState;
          } catch (e: any) {
            // Transient errors: don't kill the stream, just log and retry
            pollErrorCount++;
            console.error(`[Stream] Poll error (${pollErrorCount}):`, e.message);

            // Only kill after many consecutive failures
            if (pollErrorCount >= 20) {
              writeEvent('error', { message: `Too many poll errors: ${e.message}` });
              writeEvent('done', { error: e.message });
              clearInterval(interval);
              closeStream();
            }
          }
        }, 500);

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
      // Disable response buffering on Nginx/proxies so events flush immediately
      'X-Accel-Buffering': 'no',
    },
  });
}

