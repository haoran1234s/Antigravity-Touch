/**
 * Stop the currently running agent in the Antigravity IDE window.
 *
 * The IDE exposes a send/cancel control in the chat input area.
 * When the agent is running it transforms into a stop/cancel element —
 * either a <div data-tooltip-id*="cancel"> or a <button> with a stop icon.
 * We click whichever we find first.
 */

import type { ProxyContext } from '../types';
import { SELECTORS } from '../cdp/selectors';

export async function stopAgent(ctx: ProxyContext): Promise<{ success: boolean; clicked?: string; error?: string }> {
  if (!ctx.workbenchPage) return { success: false, error: 'Not connected' };

  return ctx.workbenchPage.evaluate((chatInputSel: string) => {
    // ── Strategy 1: data-tooltip-id="*cancel*" div (primary IDE control) ──
    const cancelDiv = document.querySelector<HTMLElement>(
      '[data-tooltip-id*="cancel"]'
    );
    if (cancelDiv) {
      cancelDiv.click();
      return { success: true, clicked: 'data-tooltip-id cancel div' };
    }

    // ── Strategy 2: data-tooltip-id="*send*" that is in cancel-mode ──
    // When the agent runs, the send element switches to cancel mode but the
    // tooltip id may still say "send" — detect cancel mode by inner HTML.
    const sendEl = document.querySelector<HTMLElement>('[data-tooltip-id*="send"]');
    if (sendEl) {
      const inner = sendEl.innerHTML || '';
      const isCancelMode =
        inner.includes('bg-red') ||
        inner.includes('rounded-xs') ||
        /lucide-square(?:[^a-z0-9-]|$)/i.test(inner);
      if (isCancelMode) {
        sendEl.click();
        return { success: true, clicked: 'send-div (cancel mode)' };
      }
    }

    // ── Strategy 3: <button> with a stop/cancel aria-label or icon ──
    const panel =
      document.querySelector('.antigravity-agent-side-panel') || document.body;

    // Look in the input area wrapper first (most specific)
    const inputArea =
      document.querySelector('#antigravity\\.agentSidePanelInputBox') ||
      panel.querySelector('[id*="InputBox"]');
    const searchRoot: Element = inputArea?.closest('.flex') ||
      inputArea?.parentElement?.parentElement ||
      panel;

    const allBtns = Array.from(searchRoot.querySelectorAll('button'));
    for (const btn of allBtns) {
      const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
      const tooltipId = (btn.getAttribute('data-tooltip-id') || '').toLowerCase();
      const text = (btn.textContent || '').trim().toLowerCase();
      const html = btn.innerHTML || '';

      const isStopBtn =
        ariaLabel.includes('stop') ||
        ariaLabel.includes('cancel') ||
        ariaLabel.includes('interrupt') ||
        tooltipId.includes('stop') ||
        tooltipId.includes('cancel') ||
        text === 'stop' ||
        text === 'cancel' ||
        /lucide-square(?:[^a-z0-9-]|$)/i.test(html) ||
        html.includes('lucide-circle-stop') ||
        html.includes('lucide-octagon') ||
        html.includes('bg-red');

      if (isStopBtn && !btn.disabled) {
        btn.click();
        return { success: true, clicked: btn.textContent?.trim() || 'stop button' };
      }
    }

    // ── Strategy 4: Keyboard shortcut Escape (last resort) ──
    // Antigravity may respond to Escape to cancel running agent.
    const inputEl = document.querySelector<HTMLElement>(
      chatInputSel
    );
    if (inputEl) {
      inputEl.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true,
      }));
      return { success: true, clicked: 'Escape key on input' };
    }

    return { success: false, error: 'No stop control found in IDE' };
  }, SELECTORS.chatInput);
}
