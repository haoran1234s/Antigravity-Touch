/**
 * Tunnel Manager — robust ngrok lifecycle controller.
 *
 * Features:
 *  - Automatic reconnect with exponential back-off (up to MAX_BACKOFF_MS)
 *  - Uses ngrok's built-in `on_status_change` callback to detect drops
 *  - Network reachability check before every reconnect attempt
 *  - Keeps tunnel URL stable (re-establishes same listener config each time)
 *  - Emits events so the CLI can print live status updates
 */

import { EventEmitter } from 'events';
import { probeInternet } from './net-probe';

// ── Constants ────────────────────────────────────────────────────────────────
const INITIAL_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 60_000;
const BACKOFF_MULTIPLIER = 1.8;

/** How often (ms) to poll DNS when we're waiting for the network to come back */
const NETWORK_POLL_MS = 3_000;

// ── Types ────────────────────────────────────────────────────────────────────
export type TunnelState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'reconnecting'
  | 'failed';

export interface TunnelConfig {
  port: number;
  authtoken: string;
  email: string;
  /** Path to the project root so we can resolve the local @ngrok/ngrok package */
  projectRoot: string;
}

export interface TunnelManagerEvents {
  state: (state: TunnelState) => void;
  connected: (url: string) => void;
  disconnected: (reason: string) => void;
  reconnecting: (attempt: number, delaySec: number) => void;
  error: (err: Error) => void;
}

// ── Tunnel Manager ───────────────────────────────────────────────────────────

export class TunnelManager extends EventEmitter {
  private config: TunnelConfig | null = null;
  private ngrokMod: any = null;
  private listener: any = null;

  private _state: TunnelState = 'idle';
  private _url: string | null = null;

  private reconnectTimer: NodeJS.Timeout | null = null;
  private networkPollTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private currentBackoff = INITIAL_BACKOFF_MS;
  private destroyed = false;

  // ── Public API ─────────────────────────────────────────────────────────────

  get state(): TunnelState { return this._state; }
  get url(): string | null { return this._url; }

  /**
   * Start the tunnel for the first time.
   */
  async start(config: TunnelConfig): Promise<void> {
    this.config = config;
    this.ngrokMod = this._loadNgrok(config.projectRoot);
    await this._connect();
  }

  /**
   * Permanently shut down the tunnel.
   */
  async stop(): Promise<void> {
    this.destroyed = true;
    this._clearTimers();
    await this._close();
    this._setState('idle');
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  private _loadNgrok(projectRoot: string): unknown {
    const path = require('path') as typeof import('path');
    const localNgrok = path.join(projectRoot, 'node_modules', '@ngrok', 'ngrok');
    try {
      return require(localNgrok);
    } catch {
      return require('@ngrok/ngrok');
    }
  }

  private _setState(s: TunnelState) {
    this._state = s;
    this.emit('state', s);
  }

  private async _connect(): Promise<void> {
    if (this.destroyed || !this.config) return;

    this._setState(this.reconnectAttempt === 0 ? 'connecting' : 'reconnecting');

    try {
      const ngrok = this.ngrokMod as any;

      // Traffic Policy with a unique auth_id per session so stale cookies
      // from previous tunnel sessions are ignored (fixes ERR_NGROK_3303).
      // Email restriction is enforced via an expression + deny rule.
      const trafficPolicy = JSON.stringify({
        on_http_request: [
          {
            actions: [
              {
                type: "oauth",
                config: {
                  provider: "google",
                  auth_id: `ag${Date.now()}`
                }
              }
            ]
          },
          {
            expressions: [
              `actions.ngrok.oauth.identity.email != '${this.config.email}'`
            ],
            actions: [
              { type: "deny" }
            ]
          }
        ]
      });

      this.listener = await ngrok.forward({
        addr: this.config.port,
        authtoken: this.config.authtoken,
        traffic_policy: trafficPolicy,

        // ── Key: built-in disconnect callback ─────────────────────────────
        on_status_change: (addr: string, error: string) => {
          if (this.destroyed) return;
          const reason = error || 'unknown';
          this._onDropped(reason);
        },
      });

      this._url = this.listener.url() as string;
      this.reconnectAttempt = 0;
      this.currentBackoff = INITIAL_BACKOFF_MS;
      this._clearTimers();
      this._setState('connected');
      this.emit('connected', this._url);

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.emit('error', err instanceof Error ? err : new Error(msg));
      this._onDropped(msg);
    }
  }

  private _onDropped(reason: string) {
    if (this.destroyed) return;

    this._url = null;
    this._setState('disconnected');
    this.emit('disconnected', reason);

    // Start the reconnect loop — wait for network first, then back off.
    this._scheduleReconnect();
  }

  private _scheduleReconnect() {
    if (this.destroyed) return;
    this._setState('reconnecting');

    this.reconnectAttempt++;
    const delay = this.currentBackoff;
    this.currentBackoff = Math.min(this.currentBackoff * BACKOFF_MULTIPLIER, MAX_BACKOFF_MS);

    this.emit('reconnecting', this.reconnectAttempt, Math.round(delay / 1000));

    this.reconnectTimer = setTimeout(async () => {
      // Wait until we actually have internet before hammering ngrok
      await this._waitForNetwork();
      if (!this.destroyed) {
        await this._connect();
      }
    }, delay);
  }

  /** Polls until the network is reachable, then resolves. */
  private _waitForNetwork(): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        probeInternet().then((online) => {
          if (online) {
            resolve();
          } else if (!this.destroyed) {
            this.networkPollTimer = setTimeout(check, NETWORK_POLL_MS);
          }
        });
      };
      check();
    });
  }

  private async _close() {
    if (this.listener) {
      try {
        await this.listener.close();
      } catch { /* ignore */ }
      this.listener = null;
    }
    if (this.ngrokMod) {
      try {
        await this.ngrokMod.disconnect();
      } catch { /* ignore */ }
    }
  }

  private _clearTimers() {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.networkPollTimer) { clearTimeout(this.networkPollTimer); this.networkPollTimer = null; }
  }
}

// ── Singleton for CLI use ────────────────────────────────────────────────────
export const tunnelManager = new TunnelManager();
