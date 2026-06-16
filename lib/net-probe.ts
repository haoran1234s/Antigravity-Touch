import * as dns from 'dns';

/**
 * Best-effort internet reachability probe.
 *
 * Historically the app probed a single host (`dns.google`). That host is
 * unreachable in some regions (e.g. mainland China) and on offline LANs, which
 * made the app incorrectly decide it was "offline" — perpetually showing
 * "Reconnecting to server…" and churning the CDP watchdog — even though the
 * local IDE was connected and working.
 *
 * This races several well-known hosts (one of which is reachable from virtually
 * any network) and caps the wait so a slow/blocked resolver can't stall callers.
 * It resolves `true` as soon as any host resolves, and `false` only if all fail
 * or the timeout elapses.
 */
export function probeInternet(timeoutMs = 2000): Promise<boolean> {
  const hosts = ['cloudflare.com', 'dns.google', 'baidu.com'];
  return new Promise((resolve) => {
    let pending = hosts.length;
    let settled = false;
    const settle = (value: boolean) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    for (const host of hosts) {
      dns.lookup(host, (err) => {
        if (!err) return settle(true);
        if (--pending === 0) settle(false);
      });
    }
    setTimeout(() => settle(false), timeoutMs);
  });
}
