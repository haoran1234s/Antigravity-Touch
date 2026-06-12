/**
 * Helpers for identifying the real Antigravity workbench target exposed by CDP.
 *
 * Older Antigravity builds used VS Code-style URLs containing `workbench.html`.
 * Current Windows builds can expose the main IDE page as a local HTTPS root such
 * as `https://127.0.0.1:65110/` with title `Antigravity`.  Counting only
 * `workbench.html` makes the proxy think CDP is a "zombie" and repeatedly kill
 * and restart Antigravity, which looks like an IDE crash to the user.
 */

export type CdpTargetLike = {
  type?: string;
  title?: string;
  url?: string;
};

export function isAntigravityWorkbenchTarget(target: CdpTargetLike): boolean {
  const type = target.type || 'page';
  const title = target.title || '';
  const url = target.url || '';

  if (type !== 'page') return false;
  if (!url || url === 'about:blank' || url.includes('jetski')) return false;

  // Legacy VS Code/Electron workbench URL.
  if (url.includes('workbench.html')) return true;

  // Current Antigravity builds expose the IDE through a local HTTPS app server
  // (e.g. `https://127.0.0.1:46073/`).  The page can route to any client-side
  // path — `/`, `/onboarding`, `/c/<conversation-id>`, etc. — and 2.x also
  // rewrites `document.title` to the active conversation title, so neither the
  // path nor the title is stable.  Any page served from the local app server on
  // the Antigravity CDP port is the workbench.
  if (/^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d+(?:\/|$)/i.test(url)) {
    return true;
  }

  // Keep a conservative fallback for future app URL variants that still carry
  // the Antigravity product name in the page title.
  return /^Antigravity\b/i.test(title) && /antigravity/i.test(url);
}
