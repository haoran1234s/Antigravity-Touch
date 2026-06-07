/**
 * Switch the active conversation in the IDE using CDP.
 */

import { sleep } from '../utils';
import { logger } from '@/lib/logger';
import type { ProxyContext } from '../types';

export async function switchIdeConversation(
  ctx: ProxyContext,
  conversationTitle: string,
  conversationIndex?: number,
  options: { id?: string; projectName?: string } = {},
): Promise<boolean> {
  if (!ctx.workbenchPage || (!conversationTitle && conversationIndex === undefined && !options.id)) return false;

  try {
    const success = await ctx.workbenchPage.evaluate(
      async ({
        targetTitle,
        targetIndex,
        targetId,
        targetProject,
      }: {
        targetTitle: string;
        targetIndex?: number;
        targetId?: string;
        targetProject?: string;
      }) => {
        const normalize = (value?: string | null) => (value || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const cleanText = (el: Element | null) => {
          if (!el) return '';
          const clone = el.cloneNode(true) as Element;
          clone.querySelectorAll('style, script').forEach((n) => n.remove());
          return ((clone as HTMLElement).textContent || '').replace(/\s+/g, ' ').trim();
        };
        const clickElement = (el: Element) => {
          el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, view: window }));
          el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
          el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, view: window }));
          el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
          el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        };
        const isConversationButton = (el: Element) => {
          const cls = el.getAttribute('class') || '';
          return (
            cls.includes('ml-[22px]') ||
            (cls.includes('min-h-[32px]') && cls.includes('justify-between'))
          );
        };
        const parseConversationTitle = (button: Element) => {
          const spans = Array.from(button.querySelectorAll('span'))
            .map((span) => cleanText(span))
            .filter(Boolean);
          return spans[0] || cleanText(button).replace(/(?:now|\d+\s*(?:m|h|d|w|mo|yr|y))$/i, '').trim();
        };
        const expandSeeAllRows = async (root: Element, projectName?: string) => {
          for (let pass = 0; pass < 4; pass++) {
            let candidates = Array.from(root.querySelectorAll('[role="button"]'))
              .filter((button) => /^see all\b/i.test(cleanText(button)));
            if (projectName) {
              candidates = candidates.filter((button) => {
                let section = button.parentElement;
                while (section && !(section.getAttribute('class') || '').includes('group/section')) {
                  section = section.parentElement;
                }
                if (!section) return false;
                const projectButton = Array.from(section.querySelectorAll('[role="button"]'))
                  .find((candidate) => candidate !== button && !isConversationButton(candidate));
                return normalize(cleanText(projectButton || null)) === normalize(projectName);
              });
            }
            if (candidates.length === 0) return;
            for (const button of candidates) clickElement(button);
            await new Promise((resolve) => setTimeout(resolve, 150));
          }
        };
        const getProjectName = (button: Element) => {
          let section = button.parentElement;
          while (section && !(section.getAttribute('class') || '').includes('group/section')) {
            section = section.parentElement;
          }
          if (!section) return '';
          const projectButton = Array.from(section.querySelectorAll('[role="button"]'))
            .find((candidate) => candidate !== button && !isConversationButton(candidate));
          return cleanText(projectButton || null);
        };

        // Antigravity 2.x full-page sidebar. Prefer this path because it keeps
        // project grouping intact and works even when the old history dropdown
        // no longer exists.
        const sidebar = document.querySelector('[role="navigation"][aria-label="Sidebar"]');
        if (sidebar) {
          await expandSeeAllRows(sidebar, targetProject);
          const buttons = Array.from(sidebar.querySelectorAll('[role="button"]')).filter(isConversationButton);

          const currentId = location.pathname.match(/\/c\/([0-9a-f-]{36})(?:[/?#]|$)/i)?.[1];
          if (targetId && currentId && normalize(targetId) === normalize(currentId)) {
            return true;
          }

          // A UUID is the only stable identifier across sidebar expansion,
          // sorting, and newly-created chats. Use it before positional index so
          // restoring a previous conversation is not broken by index drift.
          if (targetId && /^[0-9a-f-]{36}$/i.test(targetId)) {
            window.location.href = `${location.origin}/c/${targetId}`;
            return true;
          }

          let matchedRow: Element | null = null;

          if (
            Number.isInteger(targetIndex) &&
            targetIndex !== undefined &&
            targetIndex >= 0 &&
            targetIndex < buttons.length
          ) {
            const byIndex = buttons[targetIndex];
            if (!targetProject || normalize(getProjectName(byIndex)) === normalize(targetProject)) {
              matchedRow = byIndex;
            }
          }

          if (!matchedRow && targetTitle) {
            const exactMatches = buttons.filter((button) => normalize(parseConversationTitle(button)) === normalize(targetTitle));
            matchedRow =
              exactMatches.find((button) => !targetProject || normalize(getProjectName(button)) === normalize(targetProject)) ||
              exactMatches[0] ||
              null;
          }

          if (matchedRow) {
            clickElement(matchedRow);
            return true;
          }

          return false;
        }

        const historyBtn = document.querySelector('a[data-past-conversations-toggle="true"]');
        if (!historyBtn) return false;

        let isAlreadyOpen = !!document.querySelector('.text-quickinput-foreground.opacity-50');
        
        if (!isAlreadyOpen) {
          historyBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
          historyBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
          historyBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
          
          for (let i = 0; i < 20; i++) {
            await new Promise(r => setTimeout(r, 100));
            if (document.querySelector('.text-quickinput-foreground.opacity-50')) {
              isAlreadyOpen = true;
              break;
            }
          }
        }

        if (!isAlreadyOpen) return false;

        const rowSelector = '.cursor-pointer.flex.items-center.justify-between.rounded-md.text-quickinput-foreground';
        const rowElements = Array.from(document.querySelectorAll(rowSelector));
        
        let matchedRow: Element | null = null;
        if (
          Number.isInteger(targetIndex) &&
          targetIndex !== undefined &&
          targetIndex >= 0 &&
          targetIndex < rowElements.length
        ) {
          matchedRow = rowElements[targetIndex];
        }

        if (!matchedRow && targetTitle) {
          for (const row of rowElements) {
            const titleEl = row.querySelector('.truncate span');
            const title = titleEl ? titleEl.textContent?.trim() : row.textContent?.trim();

            if (title === targetTitle) {
              matchedRow = row;
              break;
            }
          }
        }

        if (matchedRow) {
          clickElement(matchedRow);
          
          // The modal usually auto-closes on click.
          // If it doesn't, we can simulate an escape or click body.
          setTimeout(() => {
             const stillOpen = !!document.querySelector('.text-quickinput-foreground.opacity-50');
             if (stillOpen && historyBtn) {
               historyBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
               historyBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
               historyBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
             }
          }, 300);
          
          return true;
        }

        // If not found, close modal
        historyBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
        historyBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
        historyBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));

        return false;
      },
      {
        targetTitle: conversationTitle,
        targetIndex: conversationIndex,
        targetId: options.id,
        targetProject: options.projectName,
      }
    );

    if (success) {
      await sleep(1000); // Give it a second to load the new conversation
    }
    return success;
  } catch (e: any) {
    logger.error('[Action] Error switching IDE conversation:', e);
    return false;
  }
}
