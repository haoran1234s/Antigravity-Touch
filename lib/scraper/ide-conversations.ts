import type { ProxyContext } from '../types';
import { logger } from '../logger';

export interface IdeConversation {
  title: string;
  active: boolean;
  index: number;
  id?: string | null;
  projectName?: string;
  projectPath?: string;
  mtimeText?: string;
  url?: string;
}

export interface ActiveIdeConversationSnapshot {
  id: string | null;
  title: string | null;
  projectName?: string;
  url: string;
}

const UUID_RE_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/**
 * Read only the currently active IDE conversation without opening any menus.
 * This is safe to call from the passive monitor loop.
 */
export async function getActiveIdeConversation(
  ctx: ProxyContext,
): Promise<ActiveIdeConversationSnapshot | null> {
  if (!ctx.workbenchPage) return null;

  try {
    return await ctx.workbenchPage.evaluate((uuidSource: string) => {
      const uuidRe = new RegExp(`/c/(${uuidSource})(?:[/?#]|$)`, 'i');

      const cleanText = (el: Element | null) => {
        if (!el) return '';
        const clone = el.cloneNode(true) as Element;
        clone.querySelectorAll('style, script').forEach((n) => n.remove());
        return ((clone as HTMLElement).textContent || '').replace(/\s+/g, ' ').trim();
      };

      const routeId = location.href.match(uuidRe)?.[1] || null;
      const sidebar = document.querySelector('[role="navigation"][aria-label="Sidebar"]');

      const isConversationButton = (el: Element) => {
        const cls = el.getAttribute('class') || '';
        return (
          cls.includes('ml-[22px]') ||
          (cls.includes('min-h-[32px]') && cls.includes('justify-between'))
        );
      };

      const clickElement = (el: Element) => {
        el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, view: window }));
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
        el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, view: window }));
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      };

      const expandSeeAllRows = async (root: Element) => {
        // Sidebar project sections can collapse older chats behind "See all".
        // Expand them before scraping so the mobile history mirrors desktop.
        for (let pass = 0; pass < 4; pass++) {
          const buttons = Array.from(root.querySelectorAll('[role="button"]'))
            .filter((button) => /^see all\b/i.test(cleanText(button)));
          if (buttons.length === 0) return;
          for (const button of buttons) clickElement(button);
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
      };

      const parseConversationButton = (button: Element | null) => {
        if (!button) return { title: null as string | null, mtimeText: undefined as string | undefined };
        const spans = Array.from(button.querySelectorAll('span'))
          .map((span) => cleanText(span))
          .filter(Boolean);
        const title = spans[0] || cleanText(button).replace(/(?:now|\d+\s*(?:m|h|d|w|mo|yr|y))$/i, '').trim();
        return { title: title || null, mtimeText: spans[1] };
      };

      const projectForConversation = (button: Element | null) => {
        if (!button) return undefined;
        let section = button.parentElement;
        while (section && !(section.getAttribute('class') || '').includes('group/section')) {
          section = section.parentElement;
        }
        if (!section) return undefined;
        const projectButton = Array.from(section.querySelectorAll('[role="button"]'))
          .find((candidate) => candidate !== button && !isConversationButton(candidate));
        const name = cleanText(projectButton || null);
        return name || undefined;
      };

      const activeButton = sidebar
        ? Array.from(sidebar.querySelectorAll('[role="button"]'))
            .find((button) =>
              isConversationButton(button) &&
              (button.getAttribute('class') || '').includes('bg-sidebar-secondary')
            )
        : null;
      const parsed = parseConversationButton(activeButton || null);

      return {
        id: routeId,
        title: parsed.title || document.title || null,
        projectName: projectForConversation(activeButton || null),
        url: location.href,
      };
    }, UUID_RE_SOURCE);
  } catch (err: any) {
    logger.warn(`[Scraper] Failed to read active IDE conversation: ${err.message}`);
    return null;
  }
}

/**
 * Gets the list of available conversations directly from the IDE's UI.
 *
 * Supports both:
 * - Antigravity 2.x full-page UI, where conversations are listed in the left
 *   sidebar grouped by project and the active item has `bg-sidebar-secondary`.
 * - Legacy side-panel UI, where conversations are inside the history dropdown.
 */
export async function getIdeConversations(ctx: ProxyContext): Promise<IdeConversation[]> {
  try {
    logger.info('[Scraper] Fetching conversations from IDE UI...');

    if (!ctx.workbenchPage) {
      logger.info('[Scraper] No active workbench page.');
      return [];
    }

    const result = await ctx.workbenchPage.evaluate(async (uuidSource: string) => {
      const uuidRe = new RegExp(`/c/(${uuidSource})(?:[/?#]|$)`, 'i');

      const cleanText = (el: Element | null) => {
        if (!el) return '';
        const clone = el.cloneNode(true) as Element;
        clone.querySelectorAll('style, script').forEach((n) => n.remove());
        return ((clone as HTMLElement).textContent || '').replace(/\s+/g, ' ').trim();
      };

      const isConversationButton = (el: Element) => {
        const cls = el.getAttribute('class') || '';
        return (
          cls.includes('ml-[22px]') ||
          (cls.includes('min-h-[32px]') && cls.includes('justify-between'))
        );
      };

      const clickElement = (el: Element) => {
        el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, view: window }));
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
        el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, view: window }));
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      };

      const expandSeeAllRows = async (root: Element) => {
        // Sidebar project sections can collapse older chats behind "See all".
        // Expand them before scraping so the mobile project list mirrors desktop.
        for (let pass = 0; pass < 4; pass++) {
          const buttons = Array.from(root.querySelectorAll('[role="button"]'))
            .filter((button) => /^see all\b/i.test(cleanText(button)));
          if (buttons.length === 0) return;
          for (const button of buttons) clickElement(button);
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
      };

      const parseConversationButton = (button: Element) => {
        const spans = Array.from(button.querySelectorAll('span'))
          .map((span) => cleanText(span))
          .filter(Boolean);
        const fullText = cleanText(button);
        const title = spans[0] || fullText.replace(/(?:now|\d+\s*(?:m|h|d|w|mo|yr|y))$/i, '').trim();
        const mtimeText = spans[1] || undefined;
        return { title, mtimeText };
      };

      const parseProjectButton = (button: Element | null) => cleanText(button);

      const routeId = location.href.match(uuidRe)?.[1] || null;

      // ── Antigravity 2.x full-page sidebar ───────────────────────────────
      const sidebar = document.querySelector('[role="navigation"][aria-label="Sidebar"]');
      if (sidebar) {
        await expandSeeAllRows(sidebar);

        const sections = Array.from(sidebar.querySelectorAll('div'))
          .filter((el) => (el.getAttribute('class') || '').includes('group/section'));

        const rows: Array<{
          title: string;
          active: boolean;
          index: number;
          id?: string | null;
          projectName?: string;
          mtimeText?: string;
          url?: string;
        }> = [];
        let index = 0;

        for (const section of sections) {
          const buttons = Array.from(section.querySelectorAll('[role="button"]'));
          const projectButton = buttons.find((button) => !isConversationButton(button));
          const projectName = parseProjectButton(projectButton || null) || undefined;

          for (const button of buttons.filter(isConversationButton)) {
            const { title, mtimeText } = parseConversationButton(button);
            if (!title || /^see all\b/i.test(title)) continue;
            const cls = button.getAttribute('class') || '';
            const active =
              cls.includes('bg-sidebar-secondary') ||
              (!!document.title && title === document.title);

            rows.push({
              title,
              active,
              index: index++,
              id: active ? routeId : null,
              projectName,
              mtimeText,
              url: active ? location.href : undefined,
            });
          }
        }

        if (rows.length > 0) {
          // If the active conversation is not currently visible in the sidebar
          // (for example during a just-created untitled chat), add it so the
          // phone always mirrors the desktop state.
          const hasActive = rows.some((row) => row.active);
          if (!hasActive && document.title) {
            rows.unshift({
              title: document.title,
              active: true,
              index: -1,
              id: routeId,
              url: location.href,
            });
          }
          return { rows, activeTitle: document.title || null, source: 'sidebar' };
        }
      }

      // ── Legacy side-panel history dropdown ──────────────────────────────
      const historyBtn = document.querySelector('a[data-past-conversations-toggle="true"]');
      if (!historyBtn) return { error: 'History button not found' };

      const headerRow = historyBtn.parentElement?.parentElement;
      const activeTitleEl = headerRow?.querySelector('div.flex.min-w-0');
      const activeTitle = activeTitleEl?.textContent?.trim() || null;

      let isOpen = !!document.querySelector('.text-quickinput-foreground.opacity-50');
      if (!isOpen) {
        ['mousedown', 'mouseup', 'click'].forEach(evt =>
          historyBtn.dispatchEvent(new MouseEvent(evt, { bubbles: true, cancelable: true, view: window }))
        );
        for (let i = 0; i < 20; i++) {
          await new Promise(r => setTimeout(r, 100));
          if (document.querySelector('.text-quickinput-foreground.opacity-50')) { isOpen = true; break; }
        }
      }
      if (!isOpen) return { error: 'History dropdown did not appear', activeTitle };

      const rowSelector = '.cursor-pointer.flex.items-center.justify-between.rounded-md.text-quickinput-foreground';
      const rows = Array.from(document.querySelectorAll(rowSelector)).map((row, index) => {
        const titleEl = row.querySelector('.truncate span') || row.querySelector('.truncate');
        const title = titleEl ? titleEl.textContent?.trim() || '' : row.textContent?.trim() || '';
        return {
          title,
          index,
          active: activeTitle
            ? title === activeTitle || title.includes(activeTitle) || activeTitle.includes(title)
            : false,
        };
      });

      ['mousedown', 'mouseup', 'click'].forEach(evt =>
        historyBtn.dispatchEvent(new MouseEvent(evt, { bubbles: true, cancelable: true, view: window }))
      );

      return { rows, activeTitle, source: 'legacy' };
    }, UUID_RE_SOURCE);

    if (result?.error && !result?.activeTitle) {
      throw new Error(`Failed to scrape IDE conversations: ${result.error}`);
    }

    const rows: IdeConversation[] = result?.rows || [];
    const activeTitle: string | null = result?.activeTitle || null;

    logger.info(
      `[Scraper] Scraped ${rows.length} rows from ${result?.source || 'unknown'}. ` +
      `Active title: "${activeTitle ?? 'unknown'}"`
    );

    let foundActive = rows.some((r) => r.active);
    const conversations: IdeConversation[] = rows.map((r) => {
      const isActive = r.active || (
        !!activeTitle &&
        (r.title === activeTitle || r.title.includes(activeTitle) || activeTitle.includes(r.title))
      );
      if (isActive) foundActive = true;
      return { ...r, active: isActive };
    });

    if (!foundActive && activeTitle) {
      logger.warn(`[Scraper] Active title "${activeTitle}" not found in rows — prepending as current.`);
      conversations.unshift({ title: activeTitle, active: true, index: -1 });
    }

    if (!foundActive && !activeTitle && conversations.length > 0) {
      logger.warn('[Scraper] Could not read active title — using first row as fallback.');
      conversations[0] = { ...conversations[0], active: true };
    }

    return conversations;
  } catch (err: any) {
    logger.error(`[Scraper] Error fetching IDE conversations: ${err.message}`);
    throw err;
  }
}
