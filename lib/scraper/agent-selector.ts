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
 * 抓取当前 Antigravity 模型弹窗里已经渲染出来的模型选项。
 */
async function scrapeVisibleAgentOptions(ctx: ProxyContext): Promise<AgentInfo[]> {
  if (!ctx.workbenchPage) throw new Error('Not connected to Antigravity');

  return ctx.workbenchPage.evaluate(() => {
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
    const collectFromDialog = (dialog: Element) => {
      Array.from(dialog.querySelectorAll('button')).forEach((button) => {
        const name = extractModelName(button);
        const classes = (button.getAttribute('class') || '').split(/\s+/);
        const hasCheck = button.querySelector('svg.lucide-check, svg[class*="check"]') !== null;
        const isHighlighted = classes.includes('bg-secondary') || classes.includes('font-medium');
        addAgent(name, hasCheck || isHighlighted);
      });

      Array.from(dialog.querySelectorAll('span.text-xs.font-medium')).forEach((span) => {
        const name = (span.textContent || '').trim();
        const row = span.closest('[class*="cursor-pointer"], [class*="hover"]');
        const hasCheck = row?.querySelector('svg.lucide-check, svg[class*="check"]') !== null;
        const rowClasses = (row?.getAttribute('class') || '').split(/\s+/);
        const isHighlighted = rowClasses.includes('bg-secondary') || rowClasses.includes('font-medium');
        addAgent(name, hasCheck || isHighlighted);
      });
    };

    Array.from(document.querySelectorAll('[role="dialog"]'))
      .filter((dialog) => {
        const content = (dialog.textContent || '').trim();
        return content.length >= 10 && /claude|gemini|gpt|sonnet|opus|flash|oss/i.test(content);
      })
      .forEach(collectFromDialog);

    if (results.length === 0) {
      Array.from(document.querySelectorAll('span.text-xs.font-medium')).forEach((span) => {
        addAgent((span.textContent || '').trim(), false);
      });
    }

    return results;
  });
}

/**
 * 找到模型弹窗内的可滚动容器，并把滚动位置重置到顶部。
 */
async function resetModelPopoverScroll(ctx: ProxyContext): Promise<void> {
  if (!ctx.workbenchPage) throw new Error('Not connected to Antigravity');

  await ctx.workbenchPage.evaluate(() => {
    const isModelDialog = (dialog: Element) =>
      /claude|gemini|gpt|sonnet|opus|flash|oss/i.test(dialog.textContent || '');
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"]')).filter(isModelDialog);
    const dialog = dialogs.at(-1);
    if (!dialog) return;

    [dialog, ...Array.from(dialog.querySelectorAll('*'))]
      .filter((el): el is HTMLElement =>
        el instanceof HTMLElement && el.scrollHeight > el.clientHeight + 4
      )
      .forEach((el) => { el.scrollTop = 0; });
  });
  await sleep(80);
}

/**
 * 将已打开的 Antigravity 模型弹窗向下滚动一屏。
 */
async function scrollModelPopover(ctx: ProxyContext): Promise<boolean> {
  if (!ctx.workbenchPage) throw new Error('Not connected to Antigravity');

  return ctx.workbenchPage.evaluate(() => {
    const isModelDialog = (dialog: Element) =>
      /claude|gemini|gpt|sonnet|opus|flash|oss/i.test(dialog.textContent || '');
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"]')).filter(isModelDialog);
    const dialog = dialogs.at(-1);
    if (!dialog) return false;

    const scrollables = [dialog, ...Array.from(dialog.querySelectorAll('*'))]
      .filter((el): el is HTMLElement =>
        el instanceof HTMLElement && el.scrollHeight > el.clientHeight + 4
      )
      .sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight));
    const scroller = scrollables[0];
    if (!scroller) return false;

    const before = scroller.scrollTop;
    const maxScroll = scroller.scrollHeight - scroller.clientHeight;
    if (before >= maxScroll - 2) return false;

    scroller.scrollTop = Math.min(maxScroll, before + Math.max(80, Math.floor(scroller.clientHeight * 0.85)));
    return scroller.scrollTop > before + 1;
  });
}

/**
 * 合并抓取到的模型选项，同时保留首次出现顺序和激活状态。
 */
function mergeAgentOptions(target: Map<string, AgentInfo>, options: AgentInfo[]): void {
  options.forEach((agent) => {
    const previous = target.get(agent.name);
    target.set(agent.name, {
      name: agent.name,
      active: Boolean(previous?.active || agent.active),
    });
  });
}

/**
 * 通过逐屏滚动 Antigravity 的虚拟列表弹窗，收集所有模型选项。
 */
async function collectAllAgentOptions(ctx: ProxyContext): Promise<AgentInfo[]> {
  const collected = new Map<string, AgentInfo>();

  await resetModelPopoverScroll(ctx);

  const collectStep = async (remainingScrolls: number): Promise<void> => {
    mergeAgentOptions(collected, await scrapeVisibleAgentOptions(ctx));
    if (remainingScrolls <= 0) return;

    const moved = await scrollModelPopover(ctx);
    if (!moved) return;

    await sleep(140);
    await collectStep(remainingScrolls - 1);
  };

  await collectStep(24);
  await resetModelPopoverScroll(ctx);

  return Array.from(collected.values());
}

/**
 * 如果目标模型当前已经渲染在弹窗中，则点击该模型选项。
 */
async function clickVisibleAgentOption(ctx: ProxyContext, targetAgent: string): Promise<boolean> {
  if (!ctx.workbenchPage) throw new Error('Not connected to Antigravity');

  return ctx.workbenchPage.evaluate((target: string) => {
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
    const clickElement = (el: Element) => {
      const name = extractModelName(el);
      if (!matchesTarget(name)) return false;
      (el as HTMLElement).click();
      return true;
    };
    const clickSpan = (span: Element) => {
      const name = (span.textContent || '').trim();
      if (!matchesTarget(name)) return false;
      const clickTarget = span.closest('[class*="cursor-pointer"]') ||
                          span.closest('[class*="hover"]') ||
                          span.parentElement;
      if (!clickTarget) return false;
      (clickTarget as HTMLElement).click();
      return true;
    };

    const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
    return dialogs.some((dialog) =>
      Array.from(dialog.querySelectorAll('button')).some(clickElement) ||
      Array.from(dialog.querySelectorAll('span.text-xs.font-medium')).some(clickSpan)
    ) || Array.from(document.querySelectorAll('span.text-xs.font-medium')).some(clickSpan);
  }, targetAgent);
}

/**
 * 逐屏扫描模型弹窗并选择目标模型。
 */
async function clickAgentOptionByScrolling(ctx: ProxyContext, targetAgent: string): Promise<boolean> {
  await resetModelPopoverScroll(ctx);

  const selectStep = async (remainingScrolls: number): Promise<boolean> => {
    if (await clickVisibleAgentOption(ctx, targetAgent)) return true;
    if (remainingScrolls <= 0) return false;

    const moved = await scrollModelPopover(ctx);
    if (!moved) return false;

    await sleep(140);
    return selectStep(remainingScrolls - 1);
  };

  return selectStep(24);
}

/**
 * 从 Antigravity 的模型选择器下拉层读取可用模型列表。
 */
export async function getAvailableAgents(ctx: ProxyContext): Promise<AgentInfo[]> {
  if (!ctx.workbenchPage) throw new Error('Not connected to Antigravity');

  const clicked = await ctx.workbenchPage.evaluate(() => {
    const root =
      document.querySelector('.antigravity-agent-side-panel') ||
      document.querySelector('#root') ||
      document.body;
    if (!root) return false;

    // 新版全页布局：模型选择器是输入框附近的真实按钮。
    const newSelectorBtn = root.querySelector(
      '.no-focus-agent-input button[aria-label^="Select model"], button[aria-label^="Select model"], button[aria-label*="current:"]'
    );
    if (newSelectorBtn) {
      (newSelectorBtn as HTMLElement).click();
      return true;
    }

    // 旧版侧边栏布局：通过模型文字所在的可点击父元素打开选择器。
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

  const agents = await collectAllAgentOptions(ctx);

  const activeAgent = agents.find((a) => a.active)?.name || agents[0]?.name || '';
  // 部分 Antigravity 2.x 弹窗不会响应合成 Escape。
  // 点击当前已激活模型可以关闭模型弹窗，且不会改变模型状态。
  // 这里不要点击输入区底部，否则可能误打开 Worktree 选择器。
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

  const selected = await clickAgentOptionByScrolling(ctx, targetAgent);

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
