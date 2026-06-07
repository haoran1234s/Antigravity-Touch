/**
 * Full agent state scraper.
 * Scrapes the Antigravity agent side panel DOM to extract comprehensive state.
 */

import fs from 'fs';
import path from 'path';
import { SELECTORS } from '../cdp/selectors';
import type { ProxyContext, AgentState } from '../types';

const runtimeTmpdir = (): string => eval('require')('os').tmpdir();
const getDebugFile = () => path.join(runtimeTmpdir(), 'proxy-debug-state.json');

/**
 * Get a comprehensive snapshot of the entire agent panel state.
 * Includes turn-based scoping to isolate the current conversation turn.
 */
export async function getFullAgentState(ctx: ProxyContext): Promise<AgentState> {
  if (!ctx.workbenchPage) {
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

  const state = await ctx.workbenchPage.evaluate((spinnerSel: string) => {
    const getClass = (el: Element | null) =>
      (el?.getAttribute ? el.getAttribute('class') : '') || '';

    interface BrowserToolCall {
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

    const sidePanel = document.querySelector('.antigravity-agent-side-panel');
    // Antigravity 2.x can render the chat as a full workbench page instead of
    // the old `.antigravity-agent-side-panel`. Keep the legacy panel when it
    // exists, but fall back to the app root/body so mobile clients can still
    // scrape replies from the newer DOM.
    const panel =
      sidePanel ||
      document.querySelector('#root') ||
      document.querySelector('[data-vscode-theme-kind]') ||
      document.body;
    if (!panel)
      return {
        isRunning: false,
        turnCount: 0,
        stepGroupCount: 0,
        thinking: [] as { time: string }[],
        toolCalls: [] as BrowserToolCall[],
        responses: [] as string[],
        notifications: [] as string[],
        error: null as string | null,
        fileChanges: [] as { fileName: string; type: string }[],
        lastTurnResponseHTML: '',
      };

    // ── 1. Running state (multi-signal) ──
    let isRunning = false;
    let buttonStateDefinitive = false;

    // Check Chat Input Send/Stop button first (Most reliable indicator)
    let inputArea = document.querySelector('#antigravity\\.agentSidePanelInputBox');
    if (!inputArea) inputArea = panel.querySelector('[id*="InputBox"]');
    
    if (inputArea) {
      const wrapper = inputArea.closest('.flex') || inputArea.parentElement?.parentElement || inputArea.parentElement;
      if (wrapper) {
        (window as any).__proxyInputBoxHTML = wrapper.outerHTML;
        
        // ── Priority check: look for the send/cancel element by data-tooltip-id.
        // In current Antigravity versions, the send/cancel control is a <div>,
        // NOT a <button>, with tooltip like "input-send-button-cancel-tooltip"
        // or "input-send-button-tooltip".
        const sendCancelEl = wrapper.querySelector('[data-tooltip-id*="send"]') ||
                             wrapper.querySelector('[data-tooltip-id*="cancel"]');
        
        if (sendCancelEl) {
          const tooltipId = (sendCancelEl.getAttribute('data-tooltip-id') || '').toLowerCase();
          const innerHtml = sendCancelEl.innerHTML || '';
          
          // When running: tooltip contains "cancel", inner HTML has a red/colored
          // square (stop icon) like <div class="bg-red-500 ...rounded-xs">
          const isCancelMode = tooltipId.includes('cancel') ||
                               innerHtml.includes('bg-red') ||
                               innerHtml.includes('rounded-xs') ||
                               innerHtml.match(/lucide-square(?:[^a-z0-9-]|$)/i);
          
          // When idle: tooltip is just "send" without "cancel", inner HTML has
          // an arrow-up or send icon  
          const isSendMode = !isCancelMode && (
            tooltipId.includes('send') ||
            innerHtml.includes('lucide-arrow-up') ||
            innerHtml.includes('lucide-send')
          );
          
          if (isCancelMode) {
            isRunning = true;
            buttonStateDefinitive = true;
          } else if (isSendMode) {
            isRunning = false;
            buttonStateDefinitive = true;
          }
        }

        // ── Fallback: scan <button> elements in the wrapper
        if (!buttonStateDefinitive) {
          const inputBtns = wrapper.querySelectorAll('button');
          
          let hasStop = false;
          let hasSend = false;
          
          for (const btn of inputBtns) {
            const html = btn.innerHTML || '';
            const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
            const text = (btn.textContent || '').trim().toLowerCase();
            const tooltipId = (btn.getAttribute('data-tooltip-id') || '').toLowerCase();
            
            const isStopIcon = 
              html.match(/lucide-square(?:[^a-z0-9-]|$)/i) || 
              html.includes('lucide-circle-stop') || 
              html.includes('lucide-octagon');

            if (
              isStopIcon ||
              ariaLabel.includes('stop') ||
              ariaLabel.includes('cancel') ||
              text === 'stop' ||
              tooltipId.includes('stop')
            ) {
              hasStop = true;
            }
            
            if (
              html.includes('lucide-send') || 
              html.includes('lucide-arrow-up') ||
              html.includes('lucide-arrow-right') ||
              html.includes('codicon-send') ||
              html.includes('lucide-corner-down-left') ||
              ariaLabel.includes('send') ||
              ariaLabel.includes('submit') ||
              text === 'send' ||
              tooltipId.includes('send')
            ) {
              hasSend = true;
            }
          }
          
          if (hasStop) {
            isRunning = true;
            buttonStateDefinitive = true;
          } else if (hasSend) {
            isRunning = false;
            buttonStateDefinitive = true;
          } else {
            // Send button absent — check for div-based send/cancel element
            const altSendEl = inputArea?.querySelector('[data-tooltip-id*="send"]');
            if (altSendEl) {
              const tip = (altSendEl.getAttribute('data-tooltip-id') || '').toLowerCase();
              isRunning = tip.includes('cancel');
            } else {
              isRunning = true;
            }
            buttonStateDefinitive = true;
          }
        }
      }
    }

    // Fallback to other signals only if the input button state was ambiguous
    if (!buttonStateDefinitive) {
      // Signal A: Visible spinner
      const spinners = panel.querySelectorAll(`${spinnerSel}, .animate-spin`);
      for (const spinner of spinners) {
        let el: Element | null = spinner;
        let hidden = false;
        while (el) {
          const cls = getClass(el);
          if (cls.includes('invisible') || cls.includes('opacity-0')) {
            hidden = true;
            break;
          }
          el = el.parentElement;
        }
        if (!hidden) {
          isRunning = true;
          break;
        }
      }

      // Signal B: General Stop/abort button visible elsewhere in the panel
      if (!isRunning) {
        const allBtns = panel.querySelectorAll('button');
        for (const btn of allBtns) {
          const label = (btn.getAttribute('aria-label') || '').toLowerCase();
          const text = (btn.textContent?.trim() || '').toLowerCase();
          if (
            (text === 'stop' ||
              text === 'abort' ||
              label.includes('stop') ||
              label.includes('abort') ||
              label.includes('interrupt')) &&
            getComputedStyle(btn).display !== 'none' &&
            getComputedStyle(btn).visibility !== 'hidden'
          ) {
            isRunning = true;
            break;
          }
        }
      }
    }

    // ── 2. Turn & Step Group structure ──
    const findConversationList = (): Element | null => {
      const conversation =
        panel.querySelector('#conversation') ||
        document.querySelector('#conversation');
      if (conversation) {
        const scrollArea = conversation.querySelector('.overflow-y-auto');
        const msgList =
          scrollArea?.querySelector('.mx-auto') ||
          conversation.querySelector('.mx-auto.w-full') ||
          conversation;
        if (msgList) return msgList;
      }

      // New full-page Antigravity layout: the conversation is usually a
      // `.mx-auto.w-full` container and direct children are turns. Pick the
      // candidate that actually contains user/assistant message blocks.
      const candidates = Array.from(
        document.querySelectorAll('.mx-auto.w-full, .mx-auto[class*="w-full"]')
      );
      const scored = candidates
        .map((el) => {
          const responseCount = el.querySelectorAll('.leading-relaxed.select-text').length;
          const userCount = el.querySelectorAll('[class*="group/user-input-step"]').length;
          const textLen = (el.textContent || '').trim().length;
          return { el, score: responseCount * 1000 + userCount * 500 + Math.min(textLen, 499) };
        })
        .filter((item) => item.score >= 500)
        .sort((a, b) => b.score - a.score);
      if (scored[0]) return scored[0].el;

      const response = document.querySelector('.leading-relaxed.select-text');
      return (
        response?.closest('.mx-auto.w-full') ||
        response?.closest('[class*="overflow-y-auto"]') ||
        response?.parentElement ||
        null
      );
    };

    const msgList = findConversationList();
    const allTurns = msgList ? Array.from(msgList.children) : [];
    const logicalTurnCount = msgList
      ? (
          msgList.querySelectorAll('[data-testid="user-input-step"], [class*="group/user-input-step"]').length +
          msgList.querySelectorAll('.leading-relaxed.select-text, .notify-user-container').length
        )
      : 0;
    const turnCount = logicalTurnCount || allTurns.length;
    const lastTurn =
      allTurns.length > 0 ? allTurns[allTurns.length - 1] : null;

    const contentDiv =
      lastTurn?.querySelector('.relative.flex.flex-col.gap-y-3') || lastTurn;
    const stepGroups = contentDiv ? Array.from(contentDiv.children) : [];
    const stepGroupCount = stepGroups.length;

    const scopeEl = lastTurn || panel;

    // HITL button detection helper
    // These are REAL approval/rejection actions from the agent.
    // Excludes Antigravity workspace-chrome buttons like 'Relocate',
    // 'Ask every time' which appear on every tool call for file location
    // preferences and are NOT actual HITL approval actions.
    const HITL_WORDS = [
      'run', 'proceed', 'approve', 'allow', 'yes', 'accept',
      'continue', 'save', 'confirm', 'deny', 'reject', 'cancel', 'no',
      'allow once', 'allow this conversation',
    ];
    // Workspace-chrome buttons that should NEVER be treated as HITL
    const NON_HITL_WORDS = [
      'relocate', 'ask every time', 'show in explorer',
      'open in editor', 'copy path', 'reveal',
    ];
    const isHitlAction = (text: string) => {
      if (!text) return false;
      const lower = text.trim().toLowerCase();
      // Explicitly exclude workspace-chrome buttons first
      if (NON_HITL_WORDS.some((w) => lower === w || lower.startsWith(w))) return false;
      return HITL_WORDS.some((w) => lower === w || lower.startsWith(w));
    };

    // ── 3. Thinking blocks ──
    const thinking: { time: string }[] = [];
    const thinkingBtns = Array.from(scopeEl.querySelectorAll('button')).filter(
      (b) => b.textContent?.trim().startsWith('Thought for')
    );
    for (const btn of thinkingBtns) {
      thinking.push({ time: btn.textContent!.trim() });
    }

    // ── 4. Tool call steps ──
    // Antigravity DOM (updated 2026-04):
    //   Command tools: No longer use .flex-col.gap-2.border.rounded-lg.my-1
    //     Now: div with header .mb-1.px-2.py-1.text-sm.border-b containing status span.opacity-60
    //     Wrapped in: div.flex.flex-col > div > div.mb-1... (inside expandable step groups)
    //   Inline tools: No longer use .space-y-2 > .flex-row
    //     Now: div.group.flex.w-full.min-w-0.items-center.min-h-8 (inside expandable step groups)
    //   Step group headers: button.group.flex.items-center.gap-1.w-full.text-left
    //     These are collapsible groups like "Explored 1 file", "Ran 2 commands", "Worked for 32s"
    const toolCalls: BrowserToolCall[] = [];
    let toolCounter = (window as any).__proxyToolCounter || 0;

    // Helper to classify tool type from status text
    const classifyToolType = (statusText: string): string => {
      const sl = statusText.toLowerCase();
      if (sl.includes('command') || sl === 'ran') return 'command';
      else if (
        sl.includes('file') ||
        sl.includes('edit') ||
        sl.includes('creat') ||
        sl.includes('writ') ||
        sl.includes('replac') ||
        sl.includes('delet') ||
        sl.includes('mov') ||
        sl.includes('renam')
      )
        return 'file';
      else if (sl.includes('search') || sl.includes('grep')) return 'search';
      else if (
        sl.includes('read') ||
        sl.includes('view') ||
        sl.includes('analyz') ||
        sl.includes('explor')
      )
        return 'read';
      else if (sl.includes('brows')) return 'browser';
      else if (sl.startsWith('mcp')) return 'mcp';
      return 'unknown';
    };

    // Helper to extract terminal output from a container element
    const extractTerminalOutput = (containerEl: Element, hasExitCode: boolean): string => {
      const terminal = containerEl.querySelector('.component-shared-terminal');
      if (!terminal || !hasExitCode) return '';

      let terminalOutput = '';

      // Antigravity uses canvas-rendered xterm.
      // Text is painted on <canvas> — no .xterm-rows exist. The xterm Terminal JS
      // instance is stored on the .terminal-wrapper element as 'xterm' property.
      try {
        const xtermDiv = terminal.querySelector('.terminal.xterm');
        const wrapper = xtermDiv?.parentElement?.parentElement as any;
        const xtermInst = wrapper?.xterm;

        if (xtermInst?.buffer?.active) {
          const buf = xtermInst.buffer.active;
          const cols: number = xtermInst.cols || 80;
          const rawLines: string[] = [];

          for (let i = Math.max(0, buf.length - 120); i < buf.length; i++) {
            const line = buf.getLine(i);
            if (line) rawLines.push(line.translateToString(true));
          }

          // Re-join hard-wrapped lines
          const joined: string[] = [];
          for (let i = 0; i < rawLines.length; i++) {
            const cur = rawLines[i];
            if (joined.length > 0 && rawLines[i - 1]?.length === cols) {
              joined[joined.length - 1] += cur;
            } else {
              joined.push(cur);
            }
          }

          terminalOutput = joined.filter((l) => l.trim()).join('\n').substring(0, 2000);
        }
      } catch (_e) {
        // Buffer API failed
      }

      // Fallback A: .xterm-rows DOM rows
      if (!terminalOutput) {
        const rowDivs = terminal.querySelectorAll('.xterm-rows > div');
        if (rowDivs.length > 0) {
          terminalOutput = Array.from(rowDivs)
            .map((r) => ((r as HTMLElement).innerText || (r as HTMLElement).textContent || '').trim())
            .filter(Boolean)
            .join('\n')
            .substring(0, 2000);
        }
      }

      // Fallback B: whole container textContent
      if (!terminalOutput) {
        const clone = terminal.cloneNode(true) as Element;
        clone.querySelectorAll('style, script').forEach((s) => s.remove());
        terminalOutput = ((clone as HTMLElement).textContent || '').trim().substring(0, 500);
      }

      return terminalOutput.trim();
    };

    // ── 4a. Legacy bordered command containers (pre-2026-04 DOM) ──
    const toolContainers = scopeEl.querySelectorAll(
      '.flex.flex-col.gap-2.border.rounded-lg.my-1'
    );

    for (const container of toolContainers) {
      const el = container as HTMLElement;
      if (!el.dataset.proxyToolId) {
        el.dataset.proxyToolId = String(toolCounter++);
      }
      const proxyToolId = el.dataset.proxyToolId;

      const header = el.querySelector('.mb-1.px-2.py-1.text-sm');
      const statusSpan = header?.querySelector('span.opacity-60');
      const status = statusSpan?.textContent?.trim() || '';

      const pathSpan = el.querySelector('span.font-mono.text-sm');
      const filePath = pathSpan?.textContent?.trim() || '';

      let command = '';
      const pre = el.querySelector('pre.whitespace-pre-wrap, pre.font-mono.text-sm');
      if (pre) {
        const preText = pre.textContent?.trim() || '';
        const dollarIdx = preText.indexOf('$');
        if (dollarIdx !== -1) {
          command = preText.substring(dollarIdx + 1).trim();
        }
      }

      let exitCode: string | null = null;
      const allEls = el.querySelectorAll('span, div');
      for (const e of allEls) {
        const t = e.textContent?.trim() || '';
        if (t.startsWith('Exit code')) {
          exitCode = t;
          break;
        }
      }

      const allBtns = Array.from(el.querySelectorAll('button'));
      const hasCancelBtn = allBtns.some(
        (b) => b.textContent?.trim() === 'Cancel'
      );
      const footerButtons = allBtns
        .map((b) => b.textContent?.trim() || '')
        .filter(isHitlAction);

      const terminalOutput = extractTerminalOutput(el, !!exitCode);

      toolCalls.push({
        id: proxyToolId,
        status,
        type: classifyToolType(status),
        path: filePath,
        command: command || null,
        exitCode,
        hasCancelBtn,
        footerButtons,
        hasTerminal: !!el.querySelector('.component-shared-terminal'),
        terminalOutput: terminalOutput || null,
      });
    }
    (window as any).__proxyToolCounter = toolCounter;

    // ── 4b. New-style command containers (2026-04+ DOM) ──
    // Commands now live inside expandable step groups. The header is:
    //   div.mb-1.px-2.py-1.text-sm.border-b.border-gray-500/25
    // We find these headers and walk up to their wrapper div.flex.flex-col.
    const cmdHeaders = scopeEl.querySelectorAll(
      '.mb-1.px-2.py-1.text-sm[class*="border-b"]'
    );
    for (const header of cmdHeaders) {
      try {
        const headerEl = header as HTMLElement;
        // The wrapper is the closest div.flex.flex-col ancestor
        const wrapper = headerEl.closest('.flex.flex-col') as HTMLElement | null;
        if (!wrapper) continue;

        // Skip if already captured by legacy selector
        if (wrapper.dataset.proxyToolId && toolCalls.some(
          (tc: BrowserToolCall) => tc.id === wrapper.dataset.proxyToolId
        )) continue;

        const statusSpan = headerEl.querySelector('span.opacity-60, span[class*="opacity-6"]');
        const status = statusSpan?.textContent?.trim() || '';
        if (!status) continue;

        if (!wrapper.dataset.proxyToolId) {
          wrapper.dataset.proxyToolId = String(toolCounter++);
        }
        const proxyToolId = wrapper.dataset.proxyToolId;

        // Extract command from pre element
        let command = '';
        const pre = wrapper.querySelector(
          'pre.whitespace-pre-wrap, pre[class*="font-mono"][class*="text-sm"]'
        );
        if (pre) {
          const preText = pre.textContent?.trim() || '';
          const dollarIdx = preText.indexOf('$');
          if (dollarIdx !== -1) {
            command = preText.substring(dollarIdx + 1).trim();
          }
        }

        // Extract path from font-mono span
        const pathSpan = wrapper.querySelector('span.font-mono.text-sm');
        const filePath = pathSpan?.textContent?.trim() || '';

        // Exit code
        let exitCode: string | null = null;
        const allEls = wrapper.querySelectorAll('span, div');
        for (const e of allEls) {
          const t = e.textContent?.trim() || '';
          if (t.startsWith('Exit code')) {
            exitCode = t;
            break;
          }
        }

        const allBtns = Array.from(wrapper.querySelectorAll('button'));
        const hasCancelBtn = allBtns.some(
          (b) => b.textContent?.trim() === 'Cancel'
        );
        const footerButtons = allBtns
          .map((b) => b.textContent?.trim() || '')
          .filter(isHitlAction);

        const terminalOutput = extractTerminalOutput(wrapper, !!exitCode);

        toolCalls.push({
          id: proxyToolId,
          status,
          type: classifyToolType(status),
          path: filePath,
          command: command || null,
          exitCode,
          hasCancelBtn,
          footerButtons,
          hasTerminal: !!wrapper.querySelector('.component-shared-terminal'),
          terminalOutput: terminalOutput || null,
        });
      } catch {
        // Silent skip
      }
    }
    (window as any).__proxyToolCounter = toolCounter;

    // ── 4c. Inline file-system tools ──
    // New DOM (2026-04+): inline tools are div.group.flex.w-full.min-w-0.items-center.min-h-8
    // Old DOM: .flex.flex-col.space-y-2 > .flex.flex-row:not(.my-2) or button.group.flex...
    // We query both old and new selectors for backward compatibility.
    const fileToolRows = scopeEl.querySelectorAll([
      // New-style div rows (2026-04+ DOM)
      'div.group.flex.w-full.min-w-0.items-center.min-h-8',
      // Old-style space-y-2 rows (pre-2026-04, kept for compatibility)
      '.flex.flex-col.space-y-2 > .flex.flex-row:not(.my-2)',
      // Old-style button rows that are INSIDE expanded step groups (not the group header itself)
      // Note: collapsed step group headers also use button.group but contain aggregate text
      // like "Explored 1 file" — we handle those separately below in 4d
    ].join(', '));
    const statusPattern =
      /^(Edited|Created|Analyzed|Read|Viewed|Wrote|Replaced|Searching|Deleted|Moved|Renamed|MCP Tool|Explored|Ran)/i;
    for (const row of fileToolRows) {
      try {
        const rowEl = row as HTMLElement;
        const rowText = rowEl.textContent?.trim() || '';
        const match = rowText.match(statusPattern);
        if (!match) continue;
        const statusText = match[1];

        // Skip if this row was already captured by the command header scan (4b)
        if (rowEl.dataset.proxyToolId && toolCalls.some(
          (tc: BrowserToolCall) => tc.id === rowEl.dataset.proxyToolId
        )) continue;

        if (!rowEl.dataset.proxyToolId) {
          rowEl.dataset.proxyToolId = String(toolCounter++);
        }
        const proxyToolId = rowEl.dataset.proxyToolId;

        const targetContainer = rowEl.tagName === 'BUTTON' ? rowEl.parentElement || rowEl : rowEl;
        const allSpans = Array.from(targetContainer.querySelectorAll('span'));
        let fileName = '';
        let additions: string | null = null;
        let deletions: string | null = null;
        let lineRange: string | null = null;
        let mcpArgs: string | null = null;
        let mcpOutput: string | null = null;
        let mcpToolName: string | null = null;

        if (statusText.startsWith('MCP')) {
          // Find MCP tool name from the row
          const nameDiv = rowEl.querySelector(
            '.flex.flex-row.items-center.gap-1.overflow-hidden, ' +
            '.flex.flex-row.items-center.gap-1.overflow-hidden.whitespace-nowrap'
          );
          if (nameDiv) {
            const directTexts: string[] = [];
            for (const child of nameDiv.childNodes) {
              if (child.nodeType === 3)
                directTexts.push((child as Text).textContent!.trim());
            }
            mcpToolName = directTexts.join('').trim() || null;
          }
          if (!mcpToolName) {
            const colonIdx = rowText.indexOf(':');
            if (colonIdx > -1) {
              const afterColon = rowText.substring(colonIdx + 1).trim();
              const cutoff = afterColon.search(/\n|Show|Ran/);
              mcpToolName =
                cutoff > -1
                  ? afterColon.substring(0, cutoff).trim()
                  : afterColon.substring(0, 60).trim();
            }
          }
          fileName = mcpToolName || '';

          const argSpans = allSpans.filter((s) =>
            (s.className || '').startsWith('mtk')
          );
          if (argSpans.length > 0) {
            mcpArgs = argSpans.map((s) => s.textContent).join('').trim();
            if (mcpArgs.length > 500) mcpArgs = mcpArgs.substring(0, 500) + '…';
          }

          const outputLabel = allSpans.find(
            (s) => s.textContent?.trim() === 'Output'
          );
          if (outputLabel) {
            const outputParent =
              outputLabel.closest('.flex.flex-col') ||
              outputLabel.parentElement;
            if (outputParent) {
              const fullText = outputParent.textContent || '';
              const outputIdx = fullText.indexOf('Output');
              if (outputIdx > -1) {
                mcpOutput = fullText.substring(outputIdx + 6).trim();
                if (mcpOutput.length > 500)
                  mcpOutput = mcpOutput.substring(0, 500) + '…';
              }
            }
          }
        } else {
          // Find file name from inline-flex span
          const fileSpan = allSpans.find((s) => {
            const cls = s.className || '';
            return cls.includes('inline-flex') && cls.includes('items-center');
          });
          fileName = fileSpan?.textContent?.trim() || '';

          const addSpan = allSpans.find((s) =>
            (s.className || '').includes('text-green')
          );
          additions = addSpan?.textContent?.trim() || null;

          const delSpan = allSpans.find((s) =>
            (s.className || '').includes('text-red')
          );
          deletions = delSpan?.textContent?.trim() || null;

          const lineSpan = allSpans.find((s) =>
            /^#L\d/.test(s.textContent?.trim() || '')
          );
          lineRange = lineSpan?.textContent?.trim() || null;
        }

        const type = classifyToolType(statusText);

        let allRowBtns = Array.from(rowEl.querySelectorAll('button'));

        // Check immediately adjacent siblings for HITL buttons
        const nextSib = rowEl.nextElementSibling;
        if (nextSib) {
          const sibBtns = Array.from(
            nextSib.querySelectorAll('button')
          ) as HTMLButtonElement[];
          for (const btn of sibBtns) {
            const t = (btn.textContent || '').trim().toLowerCase();
            if (isHitlAction(t)) {
              allRowBtns.push(btn);
            }
          }
        }

        allRowBtns = [...new Set(allRowBtns)];
        const footerButtons = allRowBtns
          .map((b) => b.textContent?.trim() || '')
          .filter(isHitlAction);
        const hasCancelBtn = footerButtons.some(
          (t) => t.toLowerCase() === 'cancel'
        );

        toolCalls.push({
          id: proxyToolId,
          status: statusText,
          type,
          path: fileName,
          command: null,
          exitCode: null,
          hasCancelBtn,
          footerButtons,
          hasTerminal: false,
          terminalOutput: null,
          additions,
          deletions,
          lineRange,
          mcpToolName,
          mcpArgs,
          mcpOutput,
        });
      } catch {
        // Silent skip for resilience
      }
    }

    // ── 4d. Collapsed step group headers (2026-04+ DOM) ──
    // These are button elements like "Explored 1 file", "Ran 2 commands",
    // "Worked for 32s", "Edited 1 file" that serve as expandable group headers.
    // They contain nested tool rows inside their expanded content div.
    // Process the expanded content to extract individual tools inside each group.
    const stepGroupBtns = scopeEl.querySelectorAll(
      'button.group.flex.items-center.gap-1.w-full.text-left'
    );
    for (const btn of stepGroupBtns) {
      try {
        const btnEl = btn as HTMLElement;
        const btnText = btnEl.textContent?.trim() || '';

        // The expanded content is the next sibling div
        const expandedDiv = btnEl.nextElementSibling as HTMLElement | null;
        if (!expandedDiv) continue;

        // Scan for nested command headers inside the expanded content
        const nestedCmdHeaders = expandedDiv.querySelectorAll(
          '.mb-1.px-2.py-1.text-sm[class*="border-b"]'
        );
        for (const nestedH of nestedCmdHeaders) {
          const nestedHEl = nestedH as HTMLElement;
          const wrapper = nestedHEl.closest('.flex.flex-col') as HTMLElement | null;
          if (!wrapper) continue;

          // Skip if already captured
          if (wrapper.dataset.proxyToolId && toolCalls.some(
            (tc: BrowserToolCall) => tc.id === wrapper.dataset.proxyToolId
          )) continue;

          const statusSpan = nestedHEl.querySelector('span.opacity-60, span[class*="opacity-6"]');
          const status = statusSpan?.textContent?.trim() || '';
          if (!status) continue;

          if (!wrapper.dataset.proxyToolId) {
            wrapper.dataset.proxyToolId = String(toolCounter++);
          }

          let command = '';
          const pre = wrapper.querySelector('pre.whitespace-pre-wrap, pre[class*="font-mono"][class*="text-sm"]');
          if (pre) {
            const preText = pre.textContent?.trim() || '';
            const dollarIdx = preText.indexOf('$');
            if (dollarIdx !== -1) {
              command = preText.substring(dollarIdx + 1).trim();
            }
          }

          const pathSpan = wrapper.querySelector('span.font-mono.text-sm');
          const filePath = pathSpan?.textContent?.trim() || '';

          let exitCode: string | null = null;
          const allEls = wrapper.querySelectorAll('span, div');
          for (const e of allEls) {
            const t = e.textContent?.trim() || '';
            if (t.startsWith('Exit code')) {
              exitCode = t;
              break;
            }
          }

          const allBtns2 = Array.from(wrapper.querySelectorAll('button'));
          const hasCancelBtn = allBtns2.some(
            (b) => b.textContent?.trim() === 'Cancel'
          );
          const footerButtons = allBtns2
            .map((b) => b.textContent?.trim() || '')
            .filter(isHitlAction);

          const terminalOutput = extractTerminalOutput(wrapper, !!exitCode);

          toolCalls.push({
            id: wrapper.dataset.proxyToolId,
            status,
            type: classifyToolType(status),
            path: filePath,
            command: command || null,
            exitCode,
            hasCancelBtn,
            footerButtons,
            hasTerminal: !!wrapper.querySelector('.component-shared-terminal'),
            terminalOutput: terminalOutput || null,
          });
        }

        // Scan for nested inline tool rows inside the expanded content
        const nestedInlineRows = expandedDiv.querySelectorAll(
          'div.group.flex.w-full.min-w-0.items-center.min-h-8'
        );
        for (const nestedRow of nestedInlineRows) {
          const nestedEl = nestedRow as HTMLElement;
          const nestedText = nestedEl.textContent?.trim() || '';
          const nestedMatch = nestedText.match(statusPattern);
          if (!nestedMatch) continue;

          // Skip if already captured
          if (nestedEl.dataset.proxyToolId && toolCalls.some(
            (tc: BrowserToolCall) => tc.id === nestedEl.dataset.proxyToolId
          )) continue;

          if (!nestedEl.dataset.proxyToolId) {
            nestedEl.dataset.proxyToolId = String(toolCounter++);
          }

          const statusText = nestedMatch[1];
          const nestedSpans = Array.from(nestedEl.querySelectorAll('span'));
          let fileName = '';

          const fileSpan = nestedSpans.find((s) => {
            const cls = s.className || '';
            return cls.includes('inline-flex') && cls.includes('items-center');
          });
          fileName = fileSpan?.textContent?.trim() || '';

          const addSpan = nestedSpans.find((s) =>
            (s.className || '').includes('text-green')
          );
          const delSpan = nestedSpans.find((s) =>
            (s.className || '').includes('text-red')
          );
          const lineSpan = nestedSpans.find((s) =>
            /^#L\d/.test(s.textContent?.trim() || '')
          );

          toolCalls.push({
            id: nestedEl.dataset.proxyToolId,
            status: statusText,
            type: classifyToolType(statusText),
            path: fileName,
            command: null,
            exitCode: null,
            hasCancelBtn: false,
            footerButtons: [],
            hasTerminal: false,
            terminalOutput: null,
            additions: addSpan?.textContent?.trim() || null,
            deletions: delSpan?.textContent?.trim() || null,
            lineRange: lineSpan?.textContent?.trim() || null,
            mcpToolName: null,
            mcpArgs: null,
            mcpOutput: null,
          });
        }
      } catch {
        // Silent skip
      }
    }
    (window as any).__proxyToolCounter = toolCounter;

    // ── 4e. Permission dialogs (broad scan) ──
    // The Antigravity permission UI can appear as a standalone element anywhere
    // in the conversation turn — not just inside .flex.flex-col.space-y-2 rows.
    // Strategy: scan for ALL buttons with permission words inside scopeEl,
    // group them by their nearest common container, then register each group
    // as a permission tool call (or attach to the last unresolved tool call).
    try {
      const PERM_REGEX = /^(allow|deny|allow once|allow this conversation|block)$/i;

      // Collect all permission-word buttons in this turn's scope
      const allScopeButtons = Array.from(scopeEl.querySelectorAll('button')) as HTMLButtonElement[];
      const permButtons = allScopeButtons.filter(btn => {
        const text = (btn.textContent || '').trim();
        return PERM_REGEX.test(text) && !btn.disabled;
      });

      if (permButtons.length > 0) {
        // Group buttons by their nearest shared container (<= 4 levels up from button)
        const containerMap = new Map<HTMLElement, HTMLButtonElement[]>();
        for (const btn of permButtons) {
          // Walk up to find the most specific containing div that holds ALL buttons
          // in the same permission group. Use the button's grandparent (action row).
          let container: HTMLElement = btn.parentElement as HTMLElement;
          // Walk up until we find a div that also contains at least one sibling permission btn
          for (let depth = 0; depth < 4; depth++) {
            const parent = container?.parentElement as HTMLElement;
            if (!parent || parent === (scopeEl as HTMLElement)) break;
            const siblingsWithPerm = Array.from(parent.querySelectorAll('button')).filter(b =>
              PERM_REGEX.test((b.textContent || '').trim())
            );
            if (siblingsWithPerm.length >= 2) {
              container = parent;
              break;
            }
            container = parent;
          }

          if (!containerMap.has(container)) containerMap.set(container, []);
          containerMap.get(container)!.push(btn);
        }

        for (const [container, btns] of containerMap) {
          const containerEl = container as HTMLElement;
          const permBtnTexts = btns.map(b => (b.textContent || '').trim()).filter(Boolean);
          const actionButtons = permBtnTexts.filter(isHitlAction);
          if (actionButtons.length === 0) continue;

          // Check if this container was already captured
          const alreadyCaptured =
            containerEl.dataset?.proxyToolId &&
            toolCalls.some(
              (tc: BrowserToolCall) =>
                tc.id === containerEl.dataset.proxyToolId &&
                tc.footerButtons.length > 0
            );
          if (alreadyCaptured) continue;

          // Also check if any existing tool call already has these footerButtons
          const footerKey = JSON.stringify(actionButtons.slice().sort());
          const alreadyInTools = toolCalls.some(
            (tc: BrowserToolCall) =>
              JSON.stringify((tc.footerButtons || []).slice().sort()) === footerKey &&
              tc.footerButtons.length > 0
          );
          if (alreadyInTools) continue;

          // Get descriptive text from the container (e.g. what file/resource needs permission)
          const containerText = containerEl.textContent || '';
          const pathMatch = containerText.match(/access to\s+(.+?)(?:\?|$)/i) ||
                            containerText.match(/read\s+(.+?)(?:\?|$)/i) ||
                            containerText.match(/open\s+(.+?)(?:\?|$)/i);
          const permPath = pathMatch ? pathMatch[1].trim().substring(0, 120) : '';

          // Try to attach to the last tool call that has no footer buttons yet
          const lastToolWithoutButtons = [...toolCalls]
            .reverse()
            .find((tc: BrowserToolCall) => tc.footerButtons.length === 0);

          if (lastToolWithoutButtons) {
            lastToolWithoutButtons.footerButtons = actionButtons;
            lastToolWithoutButtons.hasCancelBtn = actionButtons.some(
              (t: string) => t.toLowerCase() === 'deny' || t.toLowerCase() === 'cancel'
            );
            // Tag the container element for next-poll dedup
            if (!containerEl.dataset.proxyToolId) {
              containerEl.dataset.proxyToolId = lastToolWithoutButtons.id;
            }
          } else {
            // Create a standalone permission entry
            if (!containerEl.dataset.proxyToolId) {
              containerEl.dataset.proxyToolId = String(
                (window as any).__proxyToolCounter++
              );
            }
            toolCalls.push({
              id: containerEl.dataset.proxyToolId,
              status: 'Permission Required',
              type: 'read',
              path: permPath,
              command: null,
              exitCode: null,
              hasCancelBtn: true,
              footerButtons: actionButtons,
              hasTerminal: false,
              terminalOutput: null,
              additions: null,
              deletions: null,
              lineRange: null,
              mcpToolName: null,
              mcpArgs: null,
              mcpOutput: null,
            });
          }
        }
      }

      // ── Legacy: also scan the space-y-2 row containers (kept for compatibility) ──
      const allPanelRows = panel.querySelectorAll(
        '.flex.flex-col.space-y-2 > .flex.flex-row:not(.my-2)'
      );
      for (const permRow of allPanelRows) {
        const permRowEl = permRow as HTMLElement;
        const permBtns = Array.from(permRowEl.querySelectorAll('button'));
        const permBtnTexts = permBtns
          .map((b) => b.textContent?.trim() || '')
          .filter(Boolean);
        const hasPermButtons = permBtnTexts.some((t) =>
          /^(allow|deny|allow once|allow this conversation)$/i.test(t)
        );
        if (!hasPermButtons) continue;

        const alreadyCaptured =
          permRowEl.dataset?.proxyToolId &&
          toolCalls.some(
            (tc: BrowserToolCall) =>
              tc.id === permRowEl.dataset.proxyToolId &&
              tc.footerButtons.length > 0
          );
        if (alreadyCaptured) continue;

        const actionButtons = permBtnTexts.filter(isHitlAction);
        if (actionButtons.length === 0) continue;

        // Also skip if these buttons were already captured by the broad scan above
        const footerKey = JSON.stringify(actionButtons.slice().sort());
        const alreadyInTools = toolCalls.some(
          (tc: BrowserToolCall) =>
            JSON.stringify((tc.footerButtons || []).slice().sort()) === footerKey &&
            tc.footerButtons.length > 0
        );
        if (alreadyInTools) continue;

        if (!permRowEl.dataset.proxyToolId) {
          permRowEl.dataset.proxyToolId = String(
            (window as any).__proxyToolCounter++
          );
        }
        const permText = permRowEl.textContent || '';
        const pathMatch = permText.match(/access to\s+(.+?)(?:\?|$)/i);
        const permPath = pathMatch ? pathMatch[1].trim() : '';

        toolCalls.push({
          id: permRowEl.dataset.proxyToolId,
          status: 'Permission Required',
          type: 'read',
          path: permPath,
          command: null,
          exitCode: null,
          hasCancelBtn: true,
          footerButtons: actionButtons,
          hasTerminal: false,
          terminalOutput: null,
          additions: null,
          deletions: null,
          lineRange: null,
          mcpToolName: null,
          mcpArgs: null,
          mcpOutput: null,
        });
      }
    } catch {
      // Silent skip for resilience
    }

    // Signal C: any tool still executing.
    // If the input send/cancel control gave a definitive idle state, do not let
    // stale/virtualized tool DOM override it. This fixes completed chats that
    // still contain historical "Cancel" or permission-looking controls.
    if (!isRunning && !buttonStateDefinitive && toolCalls.some((t: BrowserToolCall) => t.hasCancelBtn && !t.exitCode)) {
      isRunning = true;
    }

    // Signal D: Active task boundary / subagent execution
    if (!isRunning && !buttonStateDefinitive) {
      const lastStepGroup = stepGroups[stepGroups.length - 1];
      if (lastStepGroup) {
        const stepSpinners = lastStepGroup.querySelectorAll('.animate-spin');
        for (const spinner of stepSpinners) {
          if (
            spinner.classList.contains('w-4') &&
            spinner.classList.contains('h-4')
          )
            continue;
          let el: Element | null = spinner;
          let hidden = false;
          while (el && el !== lastStepGroup) {
            const cls = getClass(el);
            if (
              cls.includes('invisible') ||
              cls.includes('opacity-0') ||
              cls.includes('hidden')
            ) {
              hidden = true;
              break;
            }
            el = el.parentElement;
          }
          if (!hidden) {
            isRunning = true;
            break;
          }
        }

        if (!isRunning) {
          const indicators = lastStepGroup.querySelectorAll(
            '.animate-pulse, .in-progress-checkbox, .typing-indicator'
          );
          for (const ind of indicators) {
            let el: Element | null = ind;
            let hidden = false;
            while (el && el !== lastStepGroup) {
              const cls = getClass(el);
              if (
                cls.includes('invisible') ||
                cls.includes('opacity-0') ||
                cls.includes('hidden')
              ) {
                hidden = true;
                break;
              }
              el = el.parentElement;
            }
            if (!hidden) {
              isRunning = true;
              break;
            }
          }
        }

        if (!isRunning) {
          const statusTexts = lastStepGroup.querySelectorAll(
            '[class*="text-sm"][class*="opacity"]'
          );
          for (const st of statusTexts) {
            if (getClass(st).includes('invisible')) continue;
            const txt = (st.textContent || '').toLowerCase();
            if (
              txt.includes('running') ||
              txt.includes('progress') ||
              txt.includes('navigat') ||
              txt.includes('executing') ||
              txt.includes('analyzing') ||
              txt.includes('processing') ||
              txt.includes('subagent') ||
              txt.includes('browser')
            ) {
              isRunning = true;
              break;
            }
          }
        }
      }
    }

    // ── 5. Notify user containers ──
    const notifications: string[] = [];
    const notifyBlocks = scopeEl.querySelectorAll('.notify-user-container');
    for (const block of notifyBlocks) {
      const clone = block.cloneNode(true) as Element;
      clone.querySelectorAll('style, script').forEach((el) => el.remove());
      // Remove Antigravity interactive UI elements (@ mention buttons, copy buttons, etc.)
      clone.querySelectorAll('svg.cursor-pointer, [class*="cursor-pointer"][class*="opacity-70"], button[class*="opacity-70"]').forEach((el) => el.remove());
      const html = (clone as HTMLElement).innerHTML?.trim();
      if (html) notifications.push(html);
    }

    // ── 6. Final response blocks ──
    const responses: string[] = [];
    let lastTurnResponseHTML = '';
    const textBlocks = Array.from(
      scopeEl.querySelectorAll('.leading-relaxed.select-text')
    );
    const finalBlocks = textBlocks.filter((el) => {
      let ancestor = el.parentElement;
      let depth = 0;
      while (ancestor && ancestor !== scopeEl && depth < 10) {
        const cls = getClass(ancestor);
        if (cls.includes('max-h-0')) return false;
        ancestor = ancestor.parentElement;
        depth++;
      }
      const text = el.textContent?.trim() || '';
      return !!text;
    });
    for (const block of finalBlocks) {
      const clone = block.cloneNode(true) as Element;
      clone.querySelectorAll('style, script').forEach((el) => el.remove());
      // Remove Antigravity interactive UI chrome elements:
      // - SVGs with cursor-pointer (@ mention, copy icons near code blocks)
      // - Elements with opacity-70 hover:opacity-100 pattern (interactive buttons)
      // - Standalone action buttons that are part of the IDE, not the response
      clone.querySelectorAll(
        'svg.cursor-pointer, [class*="cursor-pointer"][class*="opacity-70"], button[class*="opacity-70"]'
      ).forEach((el) => el.remove());
      const html = (clone as HTMLElement).innerHTML?.trim();
      if (html) responses.push(html);
    }
    if (finalBlocks.length > 0) {
      const clone = finalBlocks[finalBlocks.length - 1].cloneNode(true) as Element;
      clone.querySelectorAll('style, script').forEach((el) => el.remove());
      clone.querySelectorAll(
        'svg.cursor-pointer, [class*="cursor-pointer"][class*="opacity-70"], button[class*="opacity-70"]'
      ).forEach((el) => el.remove());
      lastTurnResponseHTML =
        (clone as HTMLElement).innerHTML?.trim() || '';
    }

    // ── 7. Error detection ──
    let error: string | null = null;
    const panelText = panel.textContent || '';
    const errorPatterns = [
      'Agent terminated due to error',
      'error persists',
      'start a new conversation',
    ];
    for (const pattern of errorPatterns) {
      if (panelText.includes(pattern)) {
        const walker = document.createTreeWalker(
          panel,
          NodeFilter.SHOW_TEXT,
          null
        );
        let n;
        while ((n = walker.nextNode())) {
          if (n.textContent!.includes('Agent terminated')) {
            error = n.textContent!.trim();
            break;
          }
        }
        if (!error) error = '[Agent terminated due to error]';
        break;
      }
    }

    // ── 8. File change cards ──
    const fileChanges: { fileName: string; type: string }[] = [];
    const fileDiffIcons = panel.querySelectorAll('svg.lucide-file-diff');
    for (const icon of fileDiffIcons) {
      const parent = icon.closest('.flex.items-center');
      if (parent) {
        const nameSpan = parent.querySelector('span');
        if (nameSpan) {
          fileChanges.push({
            fileName: nameSpan.textContent?.trim() || '',
            type: 'diff',
          });
        }
      }
    }

    return {
      isRunning,
      turnCount,
      stepGroupCount,
      thinking,
      toolCalls,
      responses,
      notifications,
      error,
      fileChanges,
      lastTurnResponseHTML,
      inputBoxHTML: (window as any).__proxyInputBoxHTML || '',
    };
  }, SELECTORS.spinner);

  // Write debug state to file for inspection
  try {
    const debug = {
      timestamp: new Date().toISOString(),
      isRunning: state.isRunning,
      turnCount: state.turnCount,
      toolCallsCount: state.toolCalls.length,
      responsesCount: state.responses.length,
      rawLastTurnResponseHTML: state.lastTurnResponseHTML,
      extractedResponses: state.responses,
      toolCalls: state.toolCalls,
      thinking: state.thinking,
      notifications: state.notifications,
      error: state.error,
      inputBoxHTML: (state as any).inputBoxHTML || '',
    };
    fs.writeFileSync(getDebugFile(), JSON.stringify(debug, null, 2));
  } catch (err) {
    console.error('Failed to write debug file', err);
    // Silent — debug file writing should never break scraping
  }

  return state as AgentState;
}
