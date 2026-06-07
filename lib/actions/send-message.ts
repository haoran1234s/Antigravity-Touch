/**
 * Send a chat message by typing into the Antigravity input and pressing Enter.
 */

import { SELECTORS } from '../cdp/selectors';
import { sleep } from '../utils';
import { logger } from '@/lib/logger';
import type { ProxyContext } from '../types';

export async function sendMessage(ctx: ProxyContext, text: string) {
  if (!ctx.workbenchPage) throw new Error('Not connected to Antigravity');

  logger.info(`[Chat] Sending message (${text.length} chars)...`);

  // Avoid Puppeteer's high-level page.click() here. On current Antigravity
  // Electron targets it can hang in Runtime.callFunctionOn while trying to
  // scroll/visibility-check the contenteditable input. Focusing via DOM and
  // then sending raw keyboard/mouse events is both faster and closer to what a
  // desktop user does.
  const focusResult = await ctx.workbenchPage.evaluate((sel: string) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) {
      return {
        success: false,
        error: 'Chat input not found',
        editableCount: document.querySelectorAll('[contenteditable="true"]').length,
      };
    }

    const click = (target: HTMLElement) => {
      target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, view: window }));
      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
      target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, view: window }));
      target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
      target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    };

    click(el);
    el.focus({ preventScroll: true });
    el.textContent = '';
    el.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'deleteContentBackward',
      data: null,
    }));

    const rect = el.getBoundingClientRect();
    return {
      success: true,
      x: rect.left + Math.max(12, Math.min(rect.width / 2, rect.width - 12)),
      y: rect.top + rect.height / 2,
    };
  }, SELECTORS.chatInput);
  if (!focusResult.success) {
    throw new Error(`${focusResult.error}; editableCount=${focusResult.editableCount}`);
  }
  if (typeof focusResult.x === 'number' && typeof focusResult.y === 'number') {
    await ctx.workbenchPage.mouse.click(focusResult.x, focusResult.y);
  }
  await sleep(120);

  await ctx.workbenchPage.keyboard.type(text);
  await sleep(180);

  const typed = await ctx.workbenchPage.evaluate((sel: string, expectedPrefix: string) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    const value = (el?.textContent || '').trim();
    return {
      ok: value.includes(expectedPrefix),
      length: value.length,
      preview: value.slice(0, 80),
    };
  }, SELECTORS.chatInput, text.slice(0, Math.min(24, text.length)));

  if (!typed.ok) {
    logger.warn(`[Chat] Keyboard typing did not reflect in editor (len=${typed.length}, preview="${typed.preview}"). Falling back to DOM insertion.`);
    await ctx.workbenchPage.evaluate((sel: string, value: string) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) throw new Error('Chat input not found during fallback insertion');
      el.focus({ preventScroll: true });
      el.textContent = value;
      el.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText',
        data: value,
      }));
    }, SELECTORS.chatInput, text);
    await sleep(180);
  }

  const sendPoint = await ctx.workbenchPage.evaluate(() => {
    const isVisible = (el: HTMLElement) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== 'hidden' &&
        style.display !== 'none' &&
        Number(style.opacity || '1') > 0.05
      );
    };

    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-tooltip-id*="send"], [aria-label*="Send" i], [title*="Send" i]'
      )
    ).filter((el) => {
      if (!isVisible(el)) return false;
      const label = [
        el.getAttribute('data-tooltip-id') || '',
        el.getAttribute('aria-label') || '',
        el.getAttribute('title') || '',
        el.innerHTML || '',
      ].join(' ').toLowerCase();
      // When the composer is empty Antigravity exposes a recorder control named
      // input-send-button-record-tooltip. It matches "*send*" but clicking it
      // starts voice input instead of sending text.
      if (label.includes('record') || label.includes('microphone')) return false;
      return (
        label.includes('send') ||
        label.includes('arrow-up') ||
        label.includes('lucide-send') ||
        label.includes('codicon-send')
      );
    });

    // Prefer the stable Antigravity input send control. It is usually a div
    // with data-tooltip-id="input-send-button-tooltip", not a <button>.
    const target =
      candidates.find((el) => (el.getAttribute('data-tooltip-id') || '').includes('input-send-button')) ||
      candidates[0] ||
      null;

    if (!target) return null;
    const rect = target.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      label:
        target.getAttribute('data-tooltip-id') ||
        target.getAttribute('aria-label') ||
        target.getAttribute('title') ||
        target.textContent?.trim() ||
        'send',
    };
  });

  if (sendPoint) {
    await ctx.workbenchPage.mouse.click(sendPoint.x, sendPoint.y);
    logger.info(`[Chat] Sent via ${sendPoint.label}.`);
  } else {
    await ctx.workbenchPage.keyboard.press('Enter');
    logger.info('[Chat] Sent via Enter fallback.');
  }
}
