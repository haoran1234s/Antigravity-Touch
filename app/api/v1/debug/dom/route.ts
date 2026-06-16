import { NextRequest, NextResponse } from 'next/server';
import { ensureCdpConnection } from '@/lib/init';
import ctx from '@/lib/context';

export const dynamic = 'force-dynamic';

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(resolve).catch(reject).finally(() => clearTimeout(timer));
  });
}

/**
 * GET /api/v1/debug/dom — DOM diagnostics for the Antigravity workbench page.
 *
 * Default (`?target=conversations`) returns a JSON report describing the
 * conversation-list sidebar: which candidate selectors match, the navigation
 * landmarks present, and a cleaned HTML snapshot of the sidebar subtree. This
 * is what we use to keep `lib/scraper/ide-conversations.ts` in sync with new
 * Antigravity builds when the list fails to load.
 *
 * `?target=panel` keeps the legacy behavior of dumping the agent side-panel.
 */
export async function GET(request: NextRequest) {
  const target = request.nextUrl.searchParams.get('target') || 'conversations';

  try {
    await withTimeout(ensureCdpConnection(), 4000, 'CDP connect timeout');
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 503 });
  }
  if (!ctx.workbenchPage) {
    return NextResponse.json({ error: 'Not connected to Antigravity' }, { status: 503 });
  }

  if (target === 'panel') {
    try {
      const html = await withTimeout(
        ctx.workbenchPage.evaluate(() => {
          const panel = document.querySelector('.antigravity-agent-side-panel');
          return panel ? (panel as HTMLElement).innerHTML : 'Panel not found';
        }),
        5000,
        'DOM dump timeout',
      );
      return new Response(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
  }

  try {
    const report = await withTimeout(
      ctx.workbenchPage.evaluate(() => {
        const SELECTORS = [
          '[role="navigation"][aria-label="Sidebar"]',
          '[role="navigation"]',
          'a[data-past-conversations-toggle="true"]',
          '.text-quickinput-foreground.opacity-50',
          '.text-quickinput-foreground',
          '[class*="group/section"]',
          '.cursor-pointer.flex.items-center.justify-between.rounded-md.text-quickinput-foreground',
          '[role="button"]',
          'aside',
          'nav',
        ];
        const probes = SELECTORS.map((selector) => ({
          selector,
          count: document.querySelectorAll(selector).length,
        }));

        const navs = Array.from(document.querySelectorAll('[role="navigation"], nav, aside')).map((n) => ({
          tag: n.tagName.toLowerCase(),
          role: n.getAttribute('role'),
          ariaLabel: n.getAttribute('aria-label'),
          cls: (n.getAttribute('class') || '').slice(0, 240),
        }));

        const clean = (el: Element | null): string => {
          if (!el) return '';
          const c = el.cloneNode(true) as Element;
          c.querySelectorAll('style, script, svg, path, img, canvas').forEach((n) => n.remove());
          return (c as HTMLElement).outerHTML;
        };

        const sidebar =
          document.querySelector('[role="navigation"][aria-label="Sidebar"]') ||
          document.querySelector('[role="navigation"]') ||
          document.querySelector('aside') ||
          document.querySelector('[class*="sidebar"]');

        let html = clean(sidebar);
        const truncated = html.length > 60000;
        if (truncated) html = html.slice(0, 60000) + '\n<!-- …truncated… -->';

        return {
          title: document.title,
          url: location.href,
          sidebarFound: !!sidebar,
          sidebarTag: sidebar ? sidebar.tagName.toLowerCase() : null,
          probes,
          navs,
          truncated,
          html,
        };
      }),
      6000,
      'DOM dump timeout',
    );
    return NextResponse.json(report);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
