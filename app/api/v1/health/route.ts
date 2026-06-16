import { NextResponse } from 'next/server';
import {
  isCdpServerActive,
  isDesktopSafeMode,
  isProcessControlAllowed,
} from '@/lib/cdp/process-manager';
import { probeInternet } from '@/lib/net-probe';

export const dynamic = 'force-dynamic';

export async function GET() {
  // The local IDE bridge is what "connected" actually means for this tool, so
  // check CDP unconditionally. Never gate it behind internet reachability: a
  // LAN-only/offline machine — or one where the internet probe is blocked — is
  // still fully functional. (Health checks stay passive: we never call
  // ensureCdpConnection() here, which could restart the desktop IDE.)
  let cdpConnected = false;
  let cdpWindowCount = 0;
  let cdpError: string | null = null;
  try {
    const cdpStatus = await isCdpServerActive();
    cdpConnected = cdpStatus.active && cdpStatus.windowCount > 0;
    cdpWindowCount = cdpStatus.windowCount;
    cdpError = cdpStatus.error || null;
  } catch (e: any) {
    cdpError = e.message;
  }

  // If the local IDE is reachable we are, by definition, "online" for this
  // tool's purposes; only bother probing the internet when it isn't.
  const networkOnline = cdpConnected ? true : await probeInternet();

  const status = cdpConnected ? 'ok' : networkOnline ? 'cdp_error' : 'offline';

  return NextResponse.json({
    status,
    connected: cdpConnected,
    cdpWindowCount,
    network: networkOnline,
    desktopSafeMode: isDesktopSafeMode(),
    processControlAllowed: isProcessControlAllowed(),
    ...(cdpError ? { error: cdpError } : {}),
    timestamp: Date.now(),
  });
}
