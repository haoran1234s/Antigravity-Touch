import { NextResponse } from 'next/server';
import {
  isCdpServerActive,
  isDesktopSafeMode,
  isProcessControlAllowed,
} from '@/lib/cdp/process-manager';
import * as dns from 'dns';

export const dynamic = 'force-dynamic';

function probeNetwork(): Promise<boolean> {
  return new Promise((resolve) => {
    dns.lookup('dns.google', (err) => resolve(!err));
  });
}

export async function GET() {
  const networkOnline = await probeNetwork();

  // Health checks must stay passive. Do not call ensureCdpConnection() here:
  // that path can auto-recover by killing/restarting Antigravity, which means
  // a phone/browser poll could unexpectedly mutate the desktop IDE.
  let cdpConnected = false;
  let cdpWindowCount = 0;
  let cdpError: string | null = null;
  if (networkOnline) {
    try {
      const cdpStatus = await isCdpServerActive();
      cdpConnected = cdpStatus.active && cdpStatus.windowCount > 0;
      cdpWindowCount = cdpStatus.windowCount;
      cdpError = cdpStatus.error || null;
    } catch (e: any) {
      cdpError = e.message;
    }
  }

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
