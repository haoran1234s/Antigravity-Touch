/**
 * CDP initialization.
 * Ensures the CDP connection is established before any API route runs.
 * Called lazily on first API request.
 * 
 * Auto-recovery handles three scenarios:
 * 1. CDP active with windows — just retry the connection (no kill).
 * 2. CDP active but 0 workbench pages (zombie) — wait for pages, then kill+restart.
 * 3. CDP not reachable — Antigravity not running or launched without CDP. Kill+restart.
 * 
 * Network-level recovery:
 * A background watchdog polls DNS every few seconds. When the network comes back
 * after a drop, it sets `initialized = false` and clears `initPromise` so the
 * next API request (or the next watchdog ping) re-runs the full init flow.
 * 
 * On Windows, extra settle time is given after killing processes because taskkill /F /T
 * can leave lock files and the process tree takes longer to fully terminate.
 */

import { connectToWorkbench } from './cdp/connection';
import {
  isCdpServerActive,
  isProcessControlAllowed,
  startCdpServer,
  waitForWorkbenchPages,
} from './cdp/process-manager';
import { getRecentProjects } from './cdp/recent-projects';
import { logger } from './logger';
import ctx from './context';
import * as dns from 'dns';

let initialized = false;
let initPromise: Promise<void> | null = null;

/** Maximum number of auto-recovery attempts before giving up */
const MAX_RECOVERY_ATTEMPTS = 3;

/** Windows needs extra time after process kills for lock file cleanup */
// Use string concatenation to defeat Turbopack DCE (same technique as process-manager.ts)
const IS_WIN = (() => { const p = 'plat', f = 'form'; return (process as any)[p + f] === 'win32'; })();
const POST_RESTART_SETTLE_MS = IS_WIN ? 5000 : 3000;

// Runtime-only home lookup. Keeping this out of static analysis prevents
// Next.js standalone tracing from globbing the entire user profile.
const runtimeHomedir = (): string => eval('require')('os').homedir();

// ── Network Watchdog ─────────────────────────────────────────────────────────
/** How often (ms) to probe for network connectivity in the watchdog */
const WATCHDOG_INTERVAL_MS = 5_000;
/** DNS host to probe */
const PROBE_HOST = 'dns.google';

let lastNetworkState: boolean | null = null;  // null = unknown (first run)
let watchdogTimer: NodeJS.Timeout | null = null;

/**
 * Probe network reachability via a DNS lookup.
 * Returns true if the network is up, false if down.
 */
function probeNetwork(): Promise<boolean> {
  return new Promise((resolve) => {
    dns.lookup(PROBE_HOST, (err) => resolve(!err));
  });
}

/**
 * Start the background network watchdog.
 * When the network transitions from DOWN → UP, the CDP connection is re-initialized.
 * Safe to call multiple times — it only starts one watchdog.
 */
export function startNetworkWatchdog() {
  if (watchdogTimer) return; // already running

  const tick = async () => {
    if (watchdogTimer === null) return; // stopped externally

    const online = await probeNetwork();

    if (online && lastNetworkState === false) {
      // Network just came back!
      logger.info('[Network] Connectivity restored. Triggering CDP reconnect...');
      if (!isProcessControlAllowed()) {
        logger.info('[Network] Desktop safe mode is enabled; skipping automatic CDP reconnect.');
        lastNetworkState = online;
        watchdogTimer = setTimeout(tick, WATCHDOG_INTERVAL_MS);
        return;
      }
      resetInitState();
      // Fire-and-forget: attempt reconnect now so the next request doesn't have to wait
      ensureCdpConnection().catch((e) => {
        logger.warn(`[Network] Post-recovery CDP init failed: ${e.message}`);
      });
    }

    if (!online && lastNetworkState !== false) {
      logger.warn('[Network] Connectivity lost. Will attempt CDP reconnect when network returns.');
      // Mark as disconnected so repeated polls don't spam logs
      initialized = false;
      initPromise = null;
    }

    lastNetworkState = online;
    watchdogTimer = setTimeout(tick, WATCHDOG_INTERVAL_MS);
  };

  // Start with a small delay so the server boots first
  watchdogTimer = setTimeout(tick, 2_000);
  logger.info('[Network] Watchdog started (polling every 5s).');
}

/** Stop the watchdog (useful in tests) */
export function stopNetworkWatchdog() {
  if (watchdogTimer) { clearTimeout(watchdogTimer); watchdogTimer = null; }
}

// ── CDP Init ─────────────────────────────────────────────────────────────────

/**
 * Determine the best project directory to open when auto-recovery restarts Antigravity.
 * Uses the most recently opened project from Antigravity's workspace storage.
 * Falls back to the user's home directory if no recent projects are found.
 * 
 * This avoids opening the .next/standalone/ build directory (which is what
 * resolve('.') would give in standalone mode).
 */
function getDefaultProjectDir(): string {
  try {
    const recent = getRecentProjects(1);
    if (recent.length > 0) {
      logger.info(`[CDP Init] Using most recent project as startup dir: ${recent[0].path}`);
      return recent[0].path;
    }
  } catch (e: any) {
    logger.warn(`[CDP Init] Failed to read recent projects: ${e.message}`);
  }
  const fallback = runtimeHomedir();
  logger.info(`[CDP Init] No recent projects found, using home dir: ${fallback}`);
  return fallback;
}

/** Reset init state so the next call to ensureCdpConnection performs a full init */
function resetInitState() {
  initialized = false;
  initPromise = null;
  if (ctx.browser) {
    try { ctx.browser.disconnect(); } catch {}
    ctx.browser = null;
    ctx.workbenchPage = null;
    ctx.allWorkbenches = [];
  }
}

export async function ensureCdpConnection(): Promise<void> {
  if (initialized && ctx.workbenchPage) return;

  if (!initPromise) {
    initPromise = (async () => {
      // First, try a normal connection
      try {
        await connectToWorkbench(ctx);
        initialized = true;
        setupDisconnectHandlers();
        return;
      } catch (e: any) {
        logger.warn('[CDP Init] Initial connection failed:', e.message);
        // Don't give up — try auto-recovery below
      }

      // ── Auto-Recovery ────────────────────────────────────────────
      // Detect the state and attempt to fix it automatically.
      logger.info('[CDP Init] Attempting auto-recovery...');
      const canControlProcess = isProcessControlAllowed();

      for (let attempt = 1; attempt <= MAX_RECOVERY_ATTEMPTS; attempt++) {
        logger.info(`[CDP Init] Recovery attempt ${attempt}/${MAX_RECOVERY_ATTEMPTS}`);

        // Check if CDP endpoint is reachable at all
        const status = await isCdpServerActive();

        if (status.active && status.windowCount > 0) {
          // ── CASE 1: CDP is active with windows ───────────────────
          // Something else went wrong in connectToWorkbench (timing, page filter, etc.).
          // Do NOT kill Antigravity — just reset context and retry.
          logger.info(`[CDP Init] CDP active with ${status.windowCount} window(s). Retrying connection without restart...`);

          resetBrowserContext();

          try {
            await connectToWorkbench(ctx);
            initialized = true;
            setupDisconnectHandlers();
            logger.info('[CDP Init] Auto-recovery successful! Connected to workbench.');
            return;
          } catch (retryErr: any) {
            logger.warn(`[CDP Init] Retry ${attempt} failed: ${retryErr.message}`);
            // Wait a bit before next attempt
            await new Promise(resolve => setTimeout(resolve, 2000));
            continue;
          }
        }

        if (status.active && status.windowCount === 0) {
          // ── CASE 2: Zombie CDP — server active but 0 workbench pages ─
          // This often happens right after a restart when pages haven't loaded yet.
          // First, wait up to 10s for workbench pages to appear before resorting to kill.
          logger.warn('[CDP Init] CDP server active but 0 workbench pages. Waiting for pages to load...');

          const pagesAppeared = await waitForWorkbenchPages(10000);
          if (pagesAppeared) {
            logger.info('[CDP Init] Workbench pages appeared! Connecting...');
            resetBrowserContext();
            try {
              await connectToWorkbench(ctx);
              initialized = true;
              setupDisconnectHandlers();
              logger.info('[CDP Init] Auto-recovery successful! Connected to workbench.');
              return;
            } catch (retryErr: any) {
              logger.warn(`[CDP Init] Connection after page wait failed: ${retryErr.message}`);
            }
          } else {
            logger.warn(
              canControlProcess
                ? '[CDP Init] No workbench pages appeared after 10s. Will kill and restart...'
                : '[CDP Init] No workbench pages appeared after 10s. Desktop safe mode is enabled; leaving the IDE untouched.'
            );
          }
        } else if (!status.active) {
          // ── CASE 3: CDP not reachable ────────────────────────────
          // Antigravity is not running, or was launched without --remote-debugging-port.
          logger.warn(
            canControlProcess
              ? '[CDP Init] CDP server not reachable. Starting Antigravity with CDP...'
              : '[CDP Init] CDP server not reachable. Desktop safe mode is enabled; leaving the IDE untouched.'
          );
        }

        if (!canControlProcess) {
          const reason = status.active
            ? 'CDP is reachable but no Antigravity workbench page is available'
            : 'CDP is not reachable';
          const message =
            `${reason}. Antigravity process control is disabled by ` +
            'ANTIGRAVITY_DESKTOP_SAFE_MODE, so the proxy will not kill, restart, or start the desktop IDE.';
          logger.warn(`[CDP Init] ${message}`);
          initPromise = null;
          throw new Error(message);
        }

        // ── Kill + Restart ────────────────────────────────────────
        // Only reached for zombie (after page wait failed) and unreachable cases.
        const projectDir = getDefaultProjectDir();
        const result = await startCdpServer(projectDir, true);

        if (!result.success) {
          logger.error(`[CDP Init] Auto-recovery failed: ${result.message}`);
          // Wait before next attempt to let things settle
          await new Promise(resolve => setTimeout(resolve, 3000));
          continue;
        }

        logger.info(`[CDP Init] Antigravity restarted: ${result.message}`);

        // Wait for workbench pages to fully load (startCdpServer already waits for
        // CDP liveness + pages, but give extra time for the UI to settle)
        await new Promise(resolve => setTimeout(resolve, POST_RESTART_SETTLE_MS));

        // Reset browser state for a fresh connection
        resetBrowserContext();

        // Try connecting
        try {
          await connectToWorkbench(ctx);
          initialized = true;
          setupDisconnectHandlers();
          logger.info('[CDP Init] Auto-recovery successful! Connected to workbench.');
          return;
        } catch (retryErr: any) {
          logger.error(`[CDP Init] Recovery attempt ${attempt} connection failed: ${retryErr.message}`);
          // Wait before next attempt
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      // All recovery attempts failed
      logger.error(`[CDP Init] All ${MAX_RECOVERY_ATTEMPTS} recovery attempts failed. Please start Antigravity manually with --remote-debugging-port=9223`);
      initPromise = null; // Allow retry on next request
    })();
  }

  await initPromise;
}

/**
 * Reset the browser context so a fresh connection can be established.
 */
function resetBrowserContext() {
  if (ctx.browser) {
    try { ctx.browser.disconnect(); } catch {}
    ctx.browser = null;
    ctx.workbenchPage = null;
    ctx.allWorkbenches = [];
  }
}

/**
 * Set up handlers for browser disconnect and page close events.
 * This allows auto-reconnect on the next incoming request.
 */
function setupDisconnectHandlers() {
  ctx.browser?.on('disconnected', () => {
    logger.error('[CDP] Browser disconnected. Will reconnect on next request.');
    initialized = false;
    initPromise = null;
    ctx.workbenchPage = null;
    ctx.browser = null;
    ctx.allWorkbenches = [];
  });

  ctx.workbenchPage?.on('close', () => {
    logger.warn('[CDP] Workbench page closed. Will reconnect on next request.');
    initialized = false;
    initPromise = null;
    ctx.workbenchPage = null;
  });
}
