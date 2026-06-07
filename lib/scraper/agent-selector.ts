/**
 * Agent/model selector scraper and switcher.
 * Reads the current AI agent and available agents from the Antigravity IDE,
 * and can switch between them via CDP.
 */

import { logger } from '@/lib/logger';
import { sleep } from '@/lib/utils';
import type { ProxyContext } from '../types';

export interface AgentInfo {
  /** Display name of the agent, e.g. "Claude Opus 4.6 (Thinking)" */
  name: string;
  /** Whether this agent is currently selected */
  active: boolean;
}

/**
 * Read the currently selected agent/model from the IDE's agent panel DOM.
 */
export async function getCurrentAgent(ctx: ProxyContext): Promise<string | null> {
  if (!ctx.workbenchPage) throw new Error('Not connected to Antigravity');

  const agent = await ctx.workbenchPage.evaluate(() => {
    const root =
      document.querySelector('.antigravity-agent-side-panel') ||
      document.querySelector('#root') ||
      document.body;
    if (!root) return null;

    const isModelName = (text: string) =>
      /claude|gemini|gpt|sonnet|opus|haiku|flash|deepseek|llama|mistral|oss/i.test(text) &&
      !/^(fast|planning|plan|agent|worktree|model)$/i.test(text.trim());

    // New full-page layout: current model is exposed in the model selector aria-label.
    const selectModelButton = root.querySelector(
      'button[aria-label^="Select model"], button[aria-label*="current:"]'
    );
    const aria = selectModelButton?.getAttribute('aria-label') || '';
    const currentMatch = aria.match(/current:\s*(.+)$/i);
    if (currentMatch?.[1]?.trim()) return currentMatch[1].trim();

    // New full-page footer wrapper used by Antigravity 2.x.
    const noFocus = root.querySelector('.no-focus-agent-input');
    const noFocusText = (noFocus?.textContent || '').trim();
    if (noFocusText && isModelName(noFocusText)) return noFocusText;

    const spans = root.querySelectorAll('span.text-xs');

    // Legacy side panel: span.text-xs.select-none.opacity-70 inside clickable selector.
    for (const span of spans) {
      const cls = span.getAttribute('class') || '';
      if (!cls.includes('select-none') || !cls.includes('opacity-70')) continue;
      const text = (span.textContent || '').trim();
      if (!isModelName(text)) continue;
      const parent = span.closest('[class*="cursor-pointer"]');
      if (parent) return text;
    }

    // Fallback for layouts that omit opacity classes.
    for (const span of spans) {
      const text = (span.textContent || '').trim();
      if (!isModelName(text)) continue;
      const parent = span.closest(
        'button[aria-label^="Select model"], [role="button"][aria-haspopup="dialog"], [class*="cursor-pointer"]'
      );
      if (parent) return text;
    }

    return null;
  });

  if (!agent) {
    logger.warn('[AgentSelector] Could not detect current agent');
  }

  return agent;
}

/**
 * Get the list of available agents from the agent selector dropdown.
 */
export async function getAvailableAgents(ctx: ProxyContext): Promise<AgentInfo[]> {
  if (!ctx.workbenchPage) throw new Error('Not connected to Antigravity');

  const clicked = await ctx.workbenchPage.evaluate(() => {
    const root =
      document.querySelector('.antigravity-agent-side-panel') ||
      document.querySelector('#root') ||
      document.body;
    if (!root) return false;

    // New full-page layout: the model selector is a real button near the input.
    const newSelectorBtn = root.querySelector(
      '.no-focus-agent-input button[aria-label^="Select model"], button[aria-label^="Select model"], button[aria-label*="current:"]'
    );
    if (newSelectorBtn) {
      (newSelectorBtn as HTMLElement).click();
      return true;
    }

    // Legacy side panel selector.
    const spans = root.querySelectorAll('span.text-xs');
    for (const span of spans) {
      const cls = span.getAttribute('class') || '';
      if (!cls.includes('select-none') || !cls.includes('opacity-70')) continue;
      const text = (span.textContent || '').trim();
      if (text === 'Fast' || text === 'Planning') continue;
      const parent = span.closest('[class*="cursor-pointer"]');
      if (parent) {
        (parent as HTMLElement).click();
        return true;
      }
    }
    return false;
  });

  if (!clicked) {
    logger.warn('[AgentSelector] Could not find agent selector button to click');
    const current = await getCurrentAgent(ctx);
    return current ? [{ name: current, active: true }] : [];
  }

  await sleep(400);

  const agents = await ctx.workbenchPage.evaluate(() => {
    const results: { name: string; active: boolean }[] = [];
    const seen = new Set<string>();
    const modelPatterns = [
      /claude/i, /gemini/i, /gpt/i, /sonnet/i, /opus/i,
      /haiku/i, /flash/i, /deepseek/i, /llama/i, /mistral/i, /oss/i,
    ];
    const isModelName = (name: string) =>
      !!name && modelPatterns.some((p) => p.test(name)) &&
      !/^(fast|planning|model|plan|agent|worktree)$/i.test(name.trim());
    const addAgent = (name: string, active: boolean) => {
      const cleaned = name.trim().replace(/\s+/g, ' ');
      if (!isModelName(cleaned) || seen.has(cleaned)) return;
      seen.add(cleaned);
      results.push({ name: cleaned, active });
    };
    const extractModelName = (row: Element) => {
      const direct =
        row.querySelector('.text-xs.text-left > span') ||
        row.querySelector('span.text-xs.font-medium') ||
        row.querySelector('span.text-xs span') ||
        row.querySelector('span.text-xs');
      const directText = (direct?.textContent || '').trim();
      if (isModelName(directText)) return directText;
      return (row.textContent || '')
        .replace(/\bFast\b/g, '')
        .replace(/\bPlanning\b/g, '')
        .trim();
    };

    const dialogs = document.querySelectorAll('[role="dialog"]');
    for (const dialog of dialogs) {
      const content = (dialog.textContent || '').trim();
      if (!content || content.length < 10) continue;

      // New Antigravity model popover: options are buttons.
      const optionButtons = dialog.querySelectorAll('button');
      for (const button of optionButtons) {
        const name = extractModelName(button);
        const classes = (button.getAttribute('class') || '').split(/\s+/);
        const hasCheck = button.querySelector('svg.lucide-check, svg[class*="check"]') !== null;
        const isHighlighted = classes.includes('bg-secondary') || classes.includes('font-medium');
        addAgent(name, hasCheck || isHighlighted);
      }

      // Legacy option rows.
      const optionSpans = dialog.querySelectorAll('span.text-xs.font-medium');
      for (const span of optionSpans) {
        const name = (span.textContent || '').trim();
        const row = span.closest('[class*="cursor-pointer"], [class*="hover"]');
        const hasCheck = row?.querySelector('svg.lucide-check, svg[class*="check"]') !== null;
        const rowClasses = (row?.getAttribute('class') || '').split(/\s+/);
        const isHighlighted = rowClasses.includes('bg-secondary') || rowClasses.includes('font-medium');
        addAgent(name, hasCheck || isHighlighted);
      }

      if (results.length > 0) break;
    }

    if (results.length === 0) {
      const allFontMedium = document.querySelectorAll('span.text-xs.font-medium');
      for (const span of allFontMedium) {
        addAgent((span.textContent || '').trim(), false);
      }
    }

    return results;
  });

  const activeAgent = agents.find((a) => a.active)?.name || agents[0]?.name || '';
  // Some Antigravity 2.x popovers do not close on synthetic Escape. Selecting
  // the already-active model closes the model popover without changing state.
  // Do not click the input footer here: it can open the Worktree selector.
  try {
    const closedBySelection = await ctx.workbenchPage.evaluate((name: string) => {
      const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
      for (const dialog of dialogs) {
        const text = dialog.textContent || '';
        if (!/claude|gemini|gpt|sonnet|opus|flash|oss/i.test(text)) continue;
        const buttons = Array.from(dialog.querySelectorAll('button'));
        const target =
          buttons.find((button) => name && (button.textContent || '').includes(name)) ||
          buttons.find((button) => {
            const classes = (button.getAttribute('class') || '').split(/\s+/);
            return classes.includes('bg-secondary') || classes.includes('font-medium');
          });
        if (target) {
          (target as HTMLElement).click();
          return true;
        }
      }
      return false;
    }, activeAgent);
    if (!closedBySelection) {
      await ctx.workbenchPage.keyboard.press('Escape');
    }
  } catch {
    // best-effort close only
  }
  await sleep(200);

  const currentAgent = await getCurrentAgent(ctx);
  if (currentAgent) {
    for (const a of agents) {
      a.active = a.name === currentAgent;
    }
    if (agents.length === 0) {
      agents.push({ name: currentAgent, active: true });
    }
  }

  return agents;
}

/**
 * Switch to a different agent/model by clicking it in the agent selector.
 */
export async function setAgent(ctx: ProxyContext, targetAgent: string): Promise<boolean> {
  if (!ctx.workbenchPage) throw new Error('Not connected to Antigravity');

  logger.info(`[AgentSelector] Switching to agent: "${targetAgent}"...`);

  const clicked = await ctx.workbenchPage.evaluate(() => {
    const root =
      document.querySelector('.antigravity-agent-side-panel') ||
      document.querySelector('#root') ||
      document.body;
    if (!root) return false;

    const newSelectorBtn = root.querySelector(
      '.no-focus-agent-input button[aria-label^="Select model"], button[aria-label^="Select model"], button[aria-label*="current:"]'
    );
    if (newSelectorBtn) {
      (newSelectorBtn as HTMLElement).click();
      return true;
    }

    const spans = root.querySelectorAll('span.text-xs');
    for (const span of spans) {
      const cls = span.getAttribute('class') || '';
      if (!cls.includes('select-none') || !cls.includes('opacity-70')) continue;
      const text = (span.textContent || '').trim();
      if (text === 'Fast' || text === 'Planning') continue;
      const parent = span.closest('[class*="cursor-pointer"]');
      if (parent) {
        (parent as HTMLElement).click();
        return true;
      }
    }
    return false;
  });

  if (!clicked) {
    throw new Error('Could not find agent selector button');
  }

  await sleep(400);

  const selected = await ctx.workbenchPage.evaluate((target: string) => {
    const targetLower = target.toLowerCase();
    const extractModelName = (row: Element) => {
      const direct =
        row.querySelector('.text-xs.text-left > span') ||
        row.querySelector('span.text-xs.font-medium') ||
        row.querySelector('span.text-xs span') ||
        row.querySelector('span.text-xs');
      const directText = (direct?.textContent || '').trim();
      if (directText) return directText;
      return (row.textContent || '')
        .replace(/\bFast\b/g, '')
        .replace(/\bPlanning\b/g, '')
        .trim();
    };

    const matchesTarget = (name: string) => {
      const lower = name.toLowerCase();
      return lower === targetLower || lower.includes(targetLower) || targetLower.includes(lower);
    };

    const dialogs = document.querySelectorAll('[role="dialog"]');
    for (const dialog of dialogs) {
      const optionButtons = dialog.querySelectorAll('button');
      for (const button of optionButtons) {
        const name = extractModelName(button);
        if (matchesTarget(name)) {
          (button as HTMLElement).click();
          return true;
        }
      }

      const optionSpans = dialog.querySelectorAll('span.text-xs.font-medium');
      for (const span of optionSpans) {
        const name = (span.textContent || '').trim();
        if (matchesTarget(name)) {
          const clickTarget = span.closest('[class*="cursor-pointer"]') ||
                              span.closest('[class*="hover"]') ||
                              span.parentElement;
          if (clickTarget) {
            (clickTarget as HTMLElement).click();
            return true;
          }
        }
      }
    }

    const allFontMedium = document.querySelectorAll('span.text-xs.font-medium');
    for (const span of allFontMedium) {
      const name = (span.textContent || '').trim();
      if (matchesTarget(name)) {
        const clickTarget = span.closest('[class*="cursor-pointer"]') ||
                            span.closest('[class*="hover"]') ||
                            span.parentElement;
        if (clickTarget) {
          (clickTarget as HTMLElement).click();
          return true;
        }
      }
    }

    return false;
  }, targetAgent);

  if (!selected) {
    await ctx.workbenchPage.keyboard.press('Escape');
    await sleep(200);
    throw new Error(`Could not find agent "${targetAgent}" in the selector`);
  }

  await sleep(300);

  const newAgent = await getCurrentAgent(ctx);
  logger.info(`[AgentSelector] Agent is now: "${newAgent}"`);

  return true;
}
