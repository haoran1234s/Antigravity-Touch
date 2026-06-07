/**
 * Start a new chat in the Antigravity IDE by clicking the new-chat button.
 */

import type { ProxyContext } from '../types';

export async function startNewChat(
  ctx: ProxyContext,
  options: { projectName?: string; projectPath?: string } = {},
) {
  if (!ctx.workbenchPage)
    return { success: false, error: 'Not connected' };

  const btnResult = await ctx.workbenchPage.evaluate(async ({ targetProjectName, targetProjectPath }) => {
    const panel =
      document.querySelector('.antigravity-agent-side-panel') ||
      document.querySelector('[role="navigation"][aria-label="Sidebar"]') ||
      document.body;
    if (!panel)
      return { success: false, error: 'No panel found' } as any;

    const allButtons = Array.from(panel.querySelectorAll('button'));

    const normalize = (value?: string | null) => (value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const cleanText = (el: Element | null) => ((el as HTMLElement | null)?.innerText || el?.textContent || '')
      .replace(/\s+/g, ' ')
      .trim();
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
    const matchesProject = (value: string, projectName?: string, projectPath?: string) => {
      const normalized = normalize(value);
      return (
        (!!projectName && normalized === normalize(projectName)) ||
        (!!projectPath && normalized === normalize(projectPath)) ||
        (!!projectPath && normalized.includes(normalize(projectPath)))
      );
    };
    const expandSeeAllRows = async (root: Element, projectName?: string, projectPath?: string) => {
      for (let pass = 0; pass < 4; pass++) {
        let candidates = Array.from(root.querySelectorAll('[role="button"]'))
          .filter((button) => /^see all\b/i.test(cleanText(button)));
        if (projectName || projectPath) {
          candidates = candidates.filter((button) => {
            let section = button.parentElement;
            while (section && !(section.getAttribute('class') || '').includes('group/section')) {
              section = section.parentElement;
            }
            if (!section) return false;
            const projectButton = Array.from(section.querySelectorAll('[role="button"]'))
              .find((candidate) => candidate !== button && !isConversationButton(candidate));
            return matchesProject(cleanText(projectButton || null), projectName, projectPath) ||
              matchesProject(cleanText(section), projectName, projectPath);
          });
        }
        if (candidates.length === 0) return;
        for (const button of candidates) clickElement(button);
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    };

    const sidebar = document.querySelector('[role="navigation"][aria-label="Sidebar"]');
    if (sidebar && (targetProjectName || targetProjectPath)) {
      await expandSeeAllRows(sidebar, targetProjectName, targetProjectPath);
      const projectButton = Array.from(sidebar.querySelectorAll('[role="button"]'))
        .find((button) => {
          if (isConversationButton(button)) return false;
          return matchesProject(cleanText(button), targetProjectName, targetProjectPath);
        });
      if (projectButton) {
        clickElement(projectButton);
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }

    const getCoords = (btn: Element, method: string) => {
      const rect = btn.getBoundingClientRect();
      return {
        success: true,
        method,
        clicked:
          (btn as HTMLElement).textContent?.trim() ||
          btn.getAttribute('aria-label') ||
          '+',
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
    };

    // Strategy 0: Exact match using known tooltip id
    const exactBtn = panel.querySelector(
      'a[data-tooltip-id="new-conversation-tooltip"]'
    );
    if (exactBtn) {
      if (
        exactBtn.classList.contains('cursor-not-allowed') ||
        exactBtn.classList.contains('disabled') ||
        getComputedStyle(exactBtn).opacity === '0.5'
      ) {
        return {
          success: true,
          method: 'tooltip-id-exact-disabled',
          clicked: 'Already in a new chat',
        };
      }
      return getCoords(exactBtn, 'tooltip-id-exact');
    }

    // Antigravity 2.x full-page sidebar: "New Conversation" is a div with
    // role="button" in the sidebar, not an <a> or a legacy side-panel button.
    const sidebarNewConversation = Array.from(panel.querySelectorAll('[role="button"]'))
      .find((el) => (el.textContent || '').trim() === 'New Conversation');
    if (sidebarNewConversation) {
      return getCoords(sidebarNewConversation, 'sidebar-new-conversation');
    }

    // Strategy 0.5: Structural match
    const header = panel.querySelector(
      '.title-actions, .actions-container, [class*="header"], [class*="titlebar"]'
    );
    if (header) {
      const headerBtns = Array.from(
        header.querySelectorAll('button, a.action-label')
      );
      if (headerBtns.length >= 4) {
        const target = headerBtns[headerBtns.length - 4];
        return getCoords(target, 'header-4th-from-right');
      }
    }

    // Strategy 1: aria-label or title
    for (const btn of allButtons) {
      const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
      const title = (btn.getAttribute('title') || '').toLowerCase();
      const combined = aria + ' ' + title;
      if (combined.includes('new') || combined.includes('start') || combined.includes('create')) {
        if (
          combined.includes('chat') ||
          combined.includes('conversation') ||
          combined.includes('session') ||
          aria.includes('new') ||
          title.includes('new')
        ) {
          return getCoords(btn, 'aria/title');
        }
      }
    }



    return {
      success: false,
      error: 'No new-chat button found',
      buttonCount: allButtons.length,
    } as any;
  }, { targetProjectName: options.projectName || '', targetProjectPath: options.projectPath || '' });

  if (btnResult.success && btnResult.x && btnResult.y) {
    await ctx.workbenchPage.mouse.click(btnResult.x, btnResult.y);
    await new Promise((r) => setTimeout(r, 100));
    return btnResult;
  } else if (
    btnResult.success &&
    btnResult.method === 'tooltip-id-exact-disabled'
  ) {
    return btnResult;
  }

  // Strategy 5: Keyboard shortcut fallback
  try {
    await ctx.workbenchPage.keyboard.down('Control');
    await ctx.workbenchPage.keyboard.press('l');
    await ctx.workbenchPage.keyboard.up('Control');
    return { success: true, method: 'keyboard-shortcut', clicked: 'Ctrl+L' };
  } catch (e: any) {
    return {
      success: false,
      error:
        'All strategies failed: ' + (btnResult.error || '') + ' | keyboard: ' + e.message,
    };
  }
}
