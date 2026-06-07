/**
 * Chat history scraper.
 * Scrolls the Antigravity conversation view viewport-by-viewport,
 * waiting for content to load at each position, then extracts
 * user/agent messages in document order.
 *
 * Key design decisions:
 * - Viewport-pinned extraction: collect content at each scroll position
 *   rather than scrolling everything first, because Antigravity re-virtualizes
 *   content that scrolls out of view.
 * - Wait for skeleton resolution: skeleton blocks (.bg-gray-500/10) appear
 *   temporarily while content loads; we wait for them to clear.
 * - Clean deduplication: dedup keys are built from cleaned text (without
 *   injected <style> content) to avoid false collisions.
 * - User message filtering: excludes CODE tags, tool containers, and
 *   notify blocks that incorrectly match .whitespace-pre-wrap.
 * - Agent response categorization: distinguishes between thinking summaries,
 *   tool descriptions, notify messages, and final responses.
 */

import type { ProxyContext, ChatHistory } from '../types';

export async function getChatHistory(ctx: ProxyContext): Promise<ChatHistory> {
  if (!ctx.workbenchPage) {
    return { isRunning: false, turnCount: 0, turns: [] };
  }

  return await ctx.workbenchPage.evaluate(async () => {
    const sidePanel = document.querySelector('.antigravity-agent-side-panel');
    const panel =
      sidePanel ||
      document.querySelector('#root') ||
      document.querySelector('[data-vscode-theme-kind]') ||
      document.body;
    if (!panel) return { isRunning: false, turnCount: 0, turns: [] };

    const findConversationSurface = (): { scrollArea: Element; msgList: Element } | null => {
      const conversation =
        panel.querySelector('#conversation') ||
        document.querySelector('#conversation');
      const legacyScrollArea = conversation?.querySelector('.overflow-y-auto');
      if (legacyScrollArea) {
        return {
          scrollArea: legacyScrollArea,
          msgList: (legacyScrollArea as Element).querySelector('.mx-auto') || legacyScrollArea,
        };
      }

      // Antigravity 2.x full-page layout has no `#conversation`; the message
      // list is a `.mx-auto.w-full` inside the main scroll container.
      const candidates = Array.from(
        document.querySelectorAll('.mx-auto.w-full, .mx-auto[class*="w-full"]')
      );
      const scored = candidates
        .map((el) => {
          const responseCount = el.querySelectorAll('.leading-relaxed.select-text').length;
          const userCount = el.querySelectorAll('[class*="group/user-input-step"]').length;
          const textLen = ((el as HTMLElement).innerText || el.textContent || '').trim().length;
          return { el, score: responseCount * 1000 + userCount * 600 + Math.min(textLen, 500) };
        })
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score);
      const msgList = scored[0]?.el;
      if (!msgList) return null;

      let scrollArea: Element | null = msgList.parentElement;
      while (scrollArea && scrollArea !== document.body) {
        const style = getComputedStyle(scrollArea);
        if (
          /(auto|scroll)/.test(style.overflowY) &&
          (scrollArea as HTMLElement).scrollHeight > (scrollArea as HTMLElement).clientHeight
        ) {
          break;
        }
        scrollArea = scrollArea.parentElement;
      }

      return {
        scrollArea: scrollArea || document.scrollingElement || document.documentElement,
        msgList,
      };
    };

    const surface = findConversationSurface();
    if (!surface) return { isRunning: false, turnCount: 0, turns: [] };

    const { scrollArea, msgList } = surface;

    // 鈹€鈹€ Helper: wait for skeleton blocks in current viewport to resolve 鈹€鈹€
    async function waitForLoad(maxWait = 3000) {
      const start = Date.now();
      while (Date.now() - start < maxWait) {
        const skeletons = Array.from(msgList.querySelectorAll(
          '.rounded-lg.bg-gray-500\\/10'
        ));
        let visibleSkeletons = 0;
        const panelRect = scrollArea!.getBoundingClientRect();
        for (const sk of skeletons) {
          const rect = sk.getBoundingClientRect();
          const relTop = rect.top - panelRect.top;
          const relBottom = rect.bottom - panelRect.top;
          if (
            relBottom > -50 &&
            relTop < scrollArea!.clientHeight + 50
          ) {
            visibleSkeletons++;
          }
        }
        if (visibleSkeletons === 0) break;
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    // 鈹€鈹€ Helper: extract clean text from an element (strips <style>) 鈹€鈹€
    function getCleanText(el: Element): string {
      const clone = el.cloneNode(true) as Element;
      clone.querySelectorAll('style, script').forEach((n) => n.remove());
      return (clone as HTMLElement).textContent?.trim() || '';
    }

    // 鈹€鈹€ Helper: extract clean HTML from an element 鈹€鈹€
    function getCleanHTML(el: Element): string {
      const clone = el.cloneNode(true) as Element;
      clone.querySelectorAll('style, script').forEach((n) => n.remove());
      // Remove Antigravity interactive UI chrome
      clone
        .querySelectorAll(
          'svg.cursor-pointer, [class*="cursor-pointer"][class*="opacity-70"], button[class*="opacity-70"]'
        )
        .forEach((n) => n.remove());
      // Remove <img> tags whose src is a VS Code webview filesystem path.
      // These are absolute OS paths (e.g. /usr/share/antigravity/resources/...)
      // or vscode-resource:// URIs that are valid inside VS Code's renderer but
      // produce 404s when the browser requests them from the Next.js server.
      clone.querySelectorAll('img').forEach((img) => {
        const src = img.getAttribute('src') || '';
        if (
          src.startsWith('/usr/') ||
          src.startsWith('/home/') ||
          src.startsWith('/opt/') ||
          src.startsWith('/var/') ||
          src.startsWith('vscode-resource:') ||
          src.startsWith('vscode-webview-resource:') ||
          src.includes('/resources/app/extensions/')
        ) {
          img.remove();
        }
      });
      return (clone as HTMLElement).innerHTML?.trim() || '';
    }

    // 鈹€鈹€ Helper: check if element is visually hidden 鈹€鈹€
    function isHidden(el: Element, root: Element): boolean {
      let ancestor = el.parentElement;
      let depth = 0;
      while (ancestor && ancestor !== root && depth < 15) {
        const cls = ancestor.getAttribute('class') || '';
        if (cls.includes('max-h-0') || cls.includes('hidden')) {
          return true;
        }
        // Check inline styles too
        const style = (ancestor as HTMLElement).style;
        if (
          style &&
          (style.display === 'none' || style.maxHeight === '0px')
        ) {
          return true;
        }
        // Check if the element has zero height (collapsed)
        if ((ancestor as HTMLElement).offsetHeight === 0) {
          return true;
        }
        ancestor = ancestor.parentElement;
        depth++;
      }
      return false;
    }

    // 鈹€鈹€ Viewport-by-viewport extraction 鈹€鈹€
    // Items are tagged with their absolute Y position at collection time
    // so we can sort chronologically even after elements get re-virtualized.
    const seen = new Set<string>();
    const candidates: {
      absY: number;   // scrollTop + element offset 鈥?for chronological sorting
      role: 'user' | 'agent';
      content: string;
      contentType?: string;
    }[] = [];


    let historyElementCounter = (window as any).__proxyHistoryElementCounter || 0;
    function getElementKey(role: 'user' | 'agent', el: Element, text: string, absY: number) {
      const htmlEl = el as HTMLElement;
      if (!htmlEl.dataset.proxyHistoryId) {
        htmlEl.dataset.proxyHistoryId = String(historyElementCounter++);
        (window as any).__proxyHistoryElementCounter = historyElementCounter;
      }
      return `${role}:el:${htmlEl.dataset.proxyHistoryId}:${text.substring(0, 300)}`;
    }

    function collectAtCurrentPosition() {
      const panelRect = scrollArea!.getBoundingClientRect();
      const currentScroll = scrollArea!.scrollTop;

      // 鈹€鈹€ Collect user messages 鈹€鈹€
      for (const el of Array.from(msgList.querySelectorAll('.whitespace-pre-wrap'))) {
        const text = el.textContent?.trim();
        if (!text || text.length < 2) continue;

        // Skip if inside agent response block
        if (el.closest('.leading-relaxed.select-text')) continue;
        // Skip editor / input box
        if (el.closest('[data-lexical-editor]')) continue;
        if (
          el.closest('#antigravity\\.agentSidePanelInputBox')
        )
          continue;
        // Skip CODE tags (inline code references like `file.ts`)
        if (el.tagName === 'CODE') continue;
        // Skip elements inside tool containers
        if (
          el.closest(
            '.flex.flex-col.gap-2.border.rounded-lg'
          )
        )
          continue;
        // Skip elements inside notify containers (these are agent content)
        if (el.closest('.notify-user-container')) continue;

        // Check if in current viewport
        const rect = el.getBoundingClientRect();
        const relTop = rect.top - panelRect.top;
        if (
          relTop < -100 ||
          relTop > scrollArea!.clientHeight + 100
        )
          continue;

        // Absolute Y position = scroll offset + element's position relative to scroll container
        const absY = currentScroll + relTop;
        const key = getElementKey('user', el, text, absY);
        if (seen.has(key)) continue;
        seen.add(key);

        candidates.push({ absY, role: 'user', content: text });
      }

      // 鈹€鈹€ Collect agent response blocks 鈹€鈹€
      for (const el of Array.from(msgList.querySelectorAll(
        '.leading-relaxed.select-text'
      ))) {
        if (isHidden(el, msgList)) continue;

        // Check if in current viewport
        const rect = el.getBoundingClientRect();
        const relTop = rect.top - panelRect.top;
        if (
          relTop < -100 ||
          relTop > scrollArea!.clientHeight + 100
        )
          continue;

        // Get clean HTML (strips <style>, <script>, UI chrome)
        const html = getCleanHTML(el);
        if (!html) continue;

        // Build dedup key from CLEAN text (not raw textContent which includes <style>)
        const cleanText = getCleanText(el);
        if (!cleanText) continue;

        // Categorize the response
        const inNotify = !!el.closest('.notify-user-container');
        const parentClass =
          el.parentElement?.getAttribute('class') || '';
        const isThinkingSummary =
          parentClass.includes('font-medium') &&
          parentClass.includes('pb-0');

        // Skip thinking summaries (these are short descriptions of agent thoughts,
        // not the actual response to the user)
        if (isThinkingSummary) continue;

        const contentType = inNotify ? 'notify' : 'response';
        const absY = currentScroll + relTop;
        const key = getElementKey('agent', el, cleanText, absY);
        if (seen.has(key)) continue;
        seen.add(key);

        candidates.push({
          absY,
          role: 'agent',
          content: html,
          contentType,
        });
      }
    }

    // 鈹€鈹€ Scroll through entire conversation, collecting at each stop 鈹€鈹€
    const overallStart = Date.now();
    const OVERALL_TIMEOUT = 30000; // 30s max for the entire scroll

    scrollArea.scrollTop = 0;
    await waitForLoad(2000);
    await new Promise((r) => setTimeout(r, 200));
    collectAtCurrentPosition();

    const step = scrollArea.clientHeight * 0.8; // 80% viewport step
    let pos = step;
    let scrollSteps = 0;
    const maxScrollSteps = 200; // Safety limit

    while (pos < scrollArea.scrollHeight + scrollArea.clientHeight) {
      if (Date.now() - overallStart > OVERALL_TIMEOUT) break;
      scrollArea.scrollTop = pos;
      await waitForLoad(1500);
      await new Promise((r) => setTimeout(r, 50));
      collectAtCurrentPosition();
      pos += step;
      scrollSteps++;
      if (scrollSteps > maxScrollSteps) break;
    }

    // Final collection at bottom
    scrollArea.scrollTop = scrollArea.scrollHeight;
    await waitForLoad(1500);
    await new Promise((r) => setTimeout(r, 200));
    collectAtCurrentPosition();

    // 鈹€鈹€ Sort by absolute Y position (chronological order) 鈹€鈹€
    candidates.sort((a, b) => a.absY - b.absY);

    // 鈹€鈹€ Build final turn list 鈹€鈹€
    const turns: { role: 'user' | 'agent'; content: string }[] = [];
    for (const c of candidates) {
      turns.push({ role: c.role, content: c.content });
    }

    // Scroll back to bottom
    scrollArea.scrollTop = scrollArea.scrollHeight;

    return {
      isRunning: false,
      turnCount: turns.length,
      turns,
    };
  });
}

