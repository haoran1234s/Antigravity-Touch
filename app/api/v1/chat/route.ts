import { NextRequest, NextResponse } from 'next/server';
import { ensureCdpConnection } from '@/lib/init';
import ctx from '@/lib/context';
import { sendMessage } from '@/lib/actions/send-message';
import { getFullAgentState } from '@/lib/scraper/agent-state';
import { sleep } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/chat — Blocking chat endpoint.
 * Sends a message and polls until the agent completes, then returns the response.
 */
export async function POST(request: NextRequest) {
  await ensureCdpConnection();
  if (!ctx.workbenchPage) {
    return NextResponse.json(
      { error: 'Not connected to Antigravity' },
      { status: 503 }
    );
  }

  const body = await request.json();
  const { message } = body;
  if (!message) {
    return NextResponse.json(
      { error: 'message is required' },
      { status: 400 }
    );
  }

  try {
    const initialState = await getFullAgentState(ctx);
    await sendMessage(ctx, message);

    const startTime = Date.now();
    const timeoutMs = 180000;
    let doneCount = 0;
    let started = false;
    const initialTurnCount = initialState.turnCount;
    const initialBlockCount = initialState.responses.length + initialState.notifications.length;
    let sawRunning = false;
    let sawOutput = false;

    // Phase 1: Wait for agent to start
    for (let i = 0; i < 120; i++) {
      await sleep(300);
      const state = await getFullAgentState(ctx);
      if (state.isRunning) {
        started = true;
        sawRunning = true;
        break;
      }
      if (state.turnCount > initialTurnCount) {
        // The desktop accepted the user message. Some Antigravity builds take
        // a few seconds before the cancel/running UI flips, so do not return
        // "[Agent did not respond]" just because the first poll window missed it.
        started = true;
        break;
      }
      const blocks = state.responses.length + state.notifications.length;
      if (blocks > initialBlockCount) {
        started = true;
        sawOutput = true;
        await sleep(500);
        const check = await getFullAgentState(ctx);
        if (!check.isRunning) {
          const response = check.notifications.length > 0
            ? check.notifications[check.notifications.length - 1]
            : check.responses.length > 0
              ? check.responses[check.responses.length - 1]
              : '';
          return NextResponse.json({ response });
        }
        break;
      }
    }

    if (!started) {
      const state = await getFullAgentState(ctx);
      const response = state.responses.length > 0
        ? state.responses[state.responses.length - 1]
        : '[Agent did not respond]';
      return NextResponse.json({ response });
    }

    // Phase 2: Wait for completion
    while (Date.now() - startTime < timeoutMs) {
      const state = await getFullAgentState(ctx);
      if (state.error) {
        return NextResponse.json({ response: state.error });
      }
      if (state.isRunning) sawRunning = true;
      const blocks = state.responses.length + state.notifications.length;
      if (blocks > initialBlockCount) sawOutput = true;
      if (!state.isRunning) {
        if (!sawRunning && !sawOutput && Date.now() - startTime < 60000) {
          // User turn is visible, but no agent output/running signal yet.
          // Keep waiting; otherwise desktop-started slow turns are reported as
          // completed before they actually begin.
          await sleep(500);
          continue;
        }
        doneCount++;
        if (doneCount >= 3) {
          const response = state.notifications.length > 0
            ? state.notifications[state.notifications.length - 1]
            : state.responses.length > 0
              ? state.responses[state.responses.length - 1]
              : '[Agent did not produce a response]';
          return NextResponse.json({ response });
        }
      } else {
        doneCount = 0;
      }
      await sleep(500);
    }

    const finalState = await getFullAgentState(ctx);
    const response = finalState.responses.length > 0
      ? finalState.responses[finalState.responses.length - 1]
      : '[Timeout: No response received]';
    return NextResponse.json({ response });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
