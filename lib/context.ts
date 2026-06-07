/**
 * Shared server-side context singleton.
 *
 * Module-level state persists across API route invocations in the same
 * Node.js process (Next.js dev server keeps the process alive).
 * This replaces the mutable `ctx` object passed through the old codebase.
 */

import type { ProxyContext } from './types';

declare global {
  var __PROXY_CTX: ProxyContext | undefined;
}

const ctx: ProxyContext = globalThis.__PROXY_CTX || {
  workbenchPage: null,
  browser: null,
  allWorkbenches: [],
  activeWindowIdx: 0,
  activeConversationId: null,
  activeTitle: null,
  activeConversationSource: null,
  lastActionTimestamp: 0,
};

// In development, HMR clears module state but keeps globalThis.
// In production, Next.js server retains module state per Node process,
// but using globalThis ensures a single source of truth across all 
// dynamic route executions.
if (process.env.NODE_ENV !== 'production') {
  globalThis.__PROXY_CTX = ctx;
}

export function getContext(): ProxyContext {
  return ctx;
}

export default ctx;
