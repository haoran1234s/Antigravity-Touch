/**
 * Antigravity Process Manager (Cross-Platform)
 * 
 * Manages the Antigravity IDE process lifecycle:
 * - Check if CDP server is active
 * - Start the Antigravity binary with remote debugging
 * - Open new windows in a specific directory
 * - Close individual windows
 * 
 * Supports: Linux, macOS, and Windows
 */

import { exec, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import { resolve } from 'path';
import * as os from 'os';
import { logger } from '../logger';
import { isAntigravityWorkbenchTarget } from './targets';

// Keep filesystem probes runtime-only. Next.js standalone tracing otherwise sees
// Antigravity/home-directory paths and tries to glob huge Windows profile
// folders (for example "Application Data"), which can make `next build` fail.
const runtimeFs = () => eval('require')('fs') as typeof import('fs');
const runtimeEnv = (): NodeJS.ProcessEnv => eval('process').env;
const existsSync = (path: import('fs').PathLike): boolean => runtimeFs().existsSync(path);
const statSync = (path: import('fs').PathLike): import('fs').Stats => runtimeFs().statSync(path);
const readFileSync = (path: import('fs').PathOrFileDescriptor, options?: any): any => runtimeFs().readFileSync(path, options);
const readdirSync = (path: import('fs').PathLike, options?: any): any => runtimeFs().readdirSync(path, options);

const execAsync = promisify(exec);

const CDP_PORT_RAW = process.env.CDP_PORT || '9223';
const CDP_PORT = parseInt(CDP_PORT_RAW, 10);

const isTruthyEnv = (value: string | undefined): boolean =>
  /^(1|true|yes|on)$/i.test((value || '').trim());

export function isDesktopSafeMode(): boolean {
  const env = runtimeEnv();
  return (
    isTruthyEnv(env.ANTIGRAVITY_DESKTOP_SAFE_MODE) ||
    isTruthyEnv(env.ANTIGRAVITY_SAFE_MODE) ||
    isTruthyEnv(env.ANTIGRAVITY_NO_PROCESS_CONTROL)
  );
}

export function isProcessControlAllowed(): boolean {
  return !isDesktopSafeMode();
}

// Use string concatenation to defeat incredibly aggressive Turbopack/Next.js static Dead Code Elimination
// which was previously executing os.platform() at build time and optimizing away the entire Windows block.
const getPlatform = () => {
  if (typeof process === 'undefined') return 'unknown';
  const p = 'plat';
  const f = 'form';
  const prop = p + f;
  return (process as any)[prop] || 'unknown';
};
const isWin = () => getPlatform() === 'win32';
const isMac = () => getPlatform() === 'darwin';
const isWsl = () => {
  if (isWin() || getPlatform() !== 'linux') return false;
  try {
    return /microsoft|wsl/i.test(readFileSync('/proc/version', 'utf8'));
  } catch { return false; }
};

// Log platform detection at startup for cross-platform debugging
logger.info(`[ProcessManager] Platform detection: runtimePlatform="${getPlatform()}", os.type()="${os.type()}", IS_WIN=${isWin()}, IS_MAC=${isMac()}, IS_WSL=${isWsl()}`);

if (isWsl()) {
  logger.info('[ProcessManager] WSL environment detected — will resolve Windows binary paths via /mnt/c/');
}

/**
 * Resolve the Antigravity binary path based on the OS.
 * Can be overridden with ANTIGRAVITY_BINARY env var.
 */
function getAntigravityBinary(): string {
  // Allow explicit override via env
  const env = runtimeEnv();
  if (env.ANTIGRAVITY_BINARY) {
    const customBin = env.ANTIGRAVITY_BINARY;
    if (!existsSync(customBin)) {
      logger.warn(`[ProcessManager] ANTIGRAVITY_BINARY set to "${customBin}" but file does not exist.`);
    }
    return customBin;
  }

  if (isWin()) {
    // Windows: check common install locations
    const candidates = [
      resolve(env.LOCALAPPDATA || '', 'Programs', 'Antigravity', 'Antigravity.exe'),
      resolve(env.PROGRAMFILES || 'C:\\Program Files', 'Google', 'Antigravity', 'Antigravity.exe'),
      resolve(env.PROGRAMFILES || 'C:\\Program Files', 'Antigravity', 'Antigravity.exe'),
      // Also check x86 Program Files
      resolve(env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Antigravity', 'Antigravity.exe'),
    ];
    for (const candidate of candidates) {
      if (candidate && existsSync(candidate)) return candidate;
    }
    // Fallback — assume it's in PATH
    logger.warn('[ProcessManager] Antigravity.exe not found in known locations. Falling back to PATH lookup.');
    return 'Antigravity.exe';
  }

  if (isWsl()) {
    // WSL: Linux kernel but Windows filesystem is mounted at /mnt/c/
    // Scan real user directories under /mnt/c/Users/ for the Antigravity binary
    const windowsUsersDir = '/mnt/c/Users';
    const wslCandidates: string[] = [];

    try {
      const skipDirs = new Set(['Public', 'Default', 'Default User', 'All Users', 'desktop.ini']);
      const userDirs = (readdirSync(windowsUsersDir) as string[]).filter((u: string) => !skipDirs.has(u));
      for (const user of userDirs) {
        wslCandidates.push(
          resolve(windowsUsersDir, user, 'AppData/Local/Programs/Antigravity/Antigravity.exe'),
          resolve(windowsUsersDir, user, 'AppData/Local/Programs/antigravity/Antigravity.exe'),
          resolve(windowsUsersDir, user, 'AppData/Local/Antigravity/Antigravity.exe'),
        );
      }
    } catch (e) {
      logger.warn(`[ProcessManager] Could not scan ${windowsUsersDir}: ${(e as Error).message}`);
    }

    // Also check Program Files locations
    wslCandidates.push(
      '/mnt/c/Program Files/Google/Antigravity/Antigravity.exe',
      '/mnt/c/Program Files/Antigravity/Antigravity.exe',
      '/mnt/c/Program Files (x86)/Antigravity/Antigravity.exe',
    );

    for (const candidate of wslCandidates) {
      if (existsSync(candidate)) {
        logger.info(`[ProcessManager] Found Antigravity binary via WSL at: ${candidate}`);
        return candidate;
      }
    }

    logger.warn('[ProcessManager] WSL detected but Antigravity.exe not found in /mnt/c/. Falling back to Linux path.');
    // Fall through to Linux path as last resort
  }

  if (isMac()) {
    // macOS: standard .app bundle location
    const macBinary = '/Applications/Antigravity.app/Contents/MacOS/Antigravity';
    if (existsSync(macBinary)) return macBinary;
    // Also check user Applications folder
    const userMacBinary = resolve(env.HOME || '', 'Applications', 'Antigravity.app', 'Contents', 'MacOS', 'Antigravity');
    if (existsSync(userMacBinary)) return userMacBinary;
    return macBinary; // fallback to standard path
  }

  // Linux
  return '/usr/share/antigravity/antigravity';
}

/**
 * Kill all existing Antigravity processes (cross-platform).
 */
async function killAllAntigravity(): Promise<void> {
  try {
    if (isWin()) {
      // taskkill is case-insensitive; /T kills the entire process tree
      await execAsync('taskkill /F /IM Antigravity.exe /T 2>nul || exit 0');
    } else if (isWsl()) {
      // In WSL, use taskkill.exe to kill the Windows process
      await execAsync('taskkill.exe /F /IM Antigravity.exe /T 2>/dev/null || true');
    } else {
      await execAsync('killall antigravity 2>/dev/null || true');
    }
    logger.info('[ProcessManager] Killed existing Antigravity processes.');
    // Wait for process cleanup — Windows process trees can take longer to tear down
    await new Promise(resolve => setTimeout(resolve, (isWin() || isWsl()) ? 2500 : 1500));
  } catch {
    // Ignore errors - process might not exist
  }
}

/** Track spawned processes so we can clean up if needed */
let spawnedProcess: ChildProcess | null = null;

/**
 * Check if the CDP server is accessible by pinging /json endpoint.
 */
export async function isCdpServerActive(): Promise<{
  active: boolean;
  windowCount: number;
  error?: string;
}> {
  try {
    const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      return { active: false, windowCount: 0, error: `HTTP ${response.status}` };
    }
    const pages = await response.json() as any[];
    const workbenches = pages.filter((p: any) => isAntigravityWorkbenchTarget(p));
    return { active: true, windowCount: workbenches.length };
  } catch (e: any) {
    return { active: false, windowCount: 0, error: e.message };
  }
}

/**
 * Start the Antigravity binary with CDP enabled.
 * 
 * IMPORTANT: From the KI, we know that if ANY Antigravity window exists,
 * new windows will merge into the existing Electron process and immediately
 * shut down the CDP server. So we must ensure a clean slate.
 * 
 * @param projectDir - The directory to open in Antigravity
 * @param killExisting - If true, kill all existing Antigravity processes first
 */
export async function startCdpServer(
  projectDir: string = '.',
  killExisting: boolean = false,
): Promise<{
  success: boolean;
  message: string;
  pid?: number;
}> {
  // Check if CDP is already active and healthy (has workbench pages)
  const status = await isCdpServerActive();
  if (status.active && status.windowCount > 0 && !killExisting) {
    return {
      success: true,
      message: `CDP server already active on port ${CDP_PORT} with ${status.windowCount} window(s).`,
    };
  }

  if (!isProcessControlAllowed()) {
    return {
      success: false,
      message:
        'Antigravity process control is disabled by ANTIGRAVITY_DESKTOP_SAFE_MODE. ' +
        'The proxy will not start, restart, or kill the desktop IDE.',
    };
  }

  // Kill existing Antigravity instances if requested (required for clean CDP start)
  if (killExisting) {
    await killAllAntigravity();
  }

  const binaryPath = getAntigravityBinary();
  // resolve() handles both absolute ('/home/user/proj' or 'C:\Users\proj') and relative ('my-proj') paths correctly
  const absoluteDir = resolve(projectDir || '.');

  // Validate the binary exists (unless it's a PATH-only fallback like 'Antigravity.exe')
  const isBinaryAbsolute = binaryPath.includes('/') || binaryPath.includes('\\');
  if (isBinaryAbsolute && !existsSync(binaryPath)) {
    return {
      success: false,
      message: `Antigravity binary not found at "${binaryPath}". Set the ANTIGRAVITY_BINARY environment variable to the correct path.`,
    };
  }

  // Validate the directory exists
  try {
    const stat = statSync(absoluteDir);
    if (!stat.isDirectory()) {
      return { success: false, message: `"${absoluteDir}" is not a directory.` };
    }
  } catch {
    return { success: false, message: `Directory not found: "${absoluteDir}"` };
  }

  // ── Pre-flight: Ensure a display server is available on Linux ─────────
  // Antigravity is an Electron (GUI) app. Without DISPLAY or WAYLAND_DISPLAY,
  // Chromium/Electron will crash immediately with exit code 0. This is the root
  // cause of post-reboot crashes when the systemd service starts before the
  // graphical session is ready.
  if (!isWin() && !isMac()) {
    const hasDisplay = !!(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
    if (!hasDisplay) {
      logger.error('[ProcessManager] No DISPLAY or WAYLAND_DISPLAY set. Cannot launch Antigravity (Electron GUI app) without a display server. Skipping spawn.');
      return {
        success: false,
        message: 'No display server available (DISPLAY/WAYLAND_DISPLAY not set). Antigravity requires a graphical session. The proxy will connect once you open Antigravity manually.',
      };
    }
  }

  // Spawn the Antigravity binary
  try {
    logger.info(`[ProcessManager] Starting Antigravity: ${binaryPath} --remote-debugging-port=${CDP_PORT} --new-window "${absoluteDir}"`);
    logger.info(`[ProcessManager] Platform: ${getPlatform()}, Binary: ${binaryPath}`);

    // Build spawn options — cross-platform:
    // - Linux/macOS: detached=true to create an orphan process, shell=false for direct exec
    // - Windows: detached=true to release the child from the parent's console,
    //   shell=false (use the resolved binary path directly, NOT through cmd.exe
    //   which would break paths with spaces), windowsHide=true to avoid a console flash
    spawnedProcess = spawn(
      binaryPath,
      [`--remote-debugging-port=${CDP_PORT}`, '--new-window', absoluteDir],
      {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env },
        shell: false,
        // Hide the console window on Windows (no flash)
        windowsHide: true,
      }
    );

    // Unref so the process doesn't keep Node alive
    spawnedProcess.unref();

    const pid = spawnedProcess.pid;

    spawnedProcess.on('error', (err) => {
      logger.error(`[ProcessManager] Antigravity process error: ${err.message}`);
      spawnedProcess = null;
    });

    spawnedProcess.on('exit', (code) => {
      logger.info(`[ProcessManager] Antigravity process exited with code ${code}`);
      spawnedProcess = null;
    });

    // Wait for CDP to become available (poll up to 15 seconds)
    const started = await waitForCdp(15000);
    if (started) {
      return {
        success: true,
        message: `Antigravity started with CDP on port ${CDP_PORT}.`,
        pid: pid || undefined,
      };
    } else {
      return {
        success: false,
        message: `Antigravity process started but CDP server did not become available on port ${CDP_PORT} within 15s.`,
        pid: pid || undefined,
      };
    }
  } catch (e: any) {
    logger.error(`[ProcessManager] Failed to start Antigravity: ${e.message}`);
    return {
      success: false,
      message: `Failed to start Antigravity: ${e.message}`,
    };
  }
}

/**
 * Open a new Antigravity window with a specified directory.
 * 
 * If CDP is already active (Antigravity is running), this will open
 * a new window in the existing Electron process.
 * If CDP is NOT active, it will start Antigravity fresh.
 */
export async function openNewWindow(projectDir: string): Promise<{
  success: boolean;
  message: string;
}> {
  if (!isProcessControlAllowed()) {
    return {
      success: false,
      message:
        'Antigravity process control is disabled by ANTIGRAVITY_DESKTOP_SAFE_MODE. ' +
        'The proxy will not open desktop IDE windows.',
    };
  }

  // resolve() handles both absolute ('/home/user/proj') and relative ('my-proj') paths correctly
  const absoluteDir = resolve(projectDir);

  // Validate the directory exists before trying to open
  try {
    const stat = statSync(absoluteDir);
    if (!stat.isDirectory()) {
      return { success: false, message: `"${absoluteDir}" is not a directory. Please provide a folder path.` };
    }
  } catch {
    return { success: false, message: `Directory not found: "${absoluteDir}". Make sure the path exists.` };
  }

  const status = await isCdpServerActive();
  const binaryPath = getAntigravityBinary();

  if (status.active) {
    // Antigravity is already running — open a new window via CLI
    // This will open a new window in the same Electron process
    try {
      logger.info(`[ProcessManager] Opening new window for: ${absoluteDir}`);
      const child = spawn(
        binaryPath,
        ['--new-window', absoluteDir],
        {
          detached: true,
          stdio: 'ignore',
          env: { ...process.env },
          shell: false,
          windowsHide: true,
        }
      );
      child.unref();

      // Wait for the new window to appear
      await new Promise(resolve => setTimeout(resolve, 3000));
      return {
        success: true,
        message: `Opened new window for "${absoluteDir}".`,
      };
    } catch (e: any) {
      return { success: false, message: `Failed to open window: ${e.message}` };
    }
  } else {
    // No CDP server — start fresh with this directory
    const result = await startCdpServer(projectDir, false);
    return { success: result.success, message: result.message };
  }
}

/**
 * Close a specific workbench window by its CDP page index.
 * Uses the CDP protocol to close the page's target.
 */
export async function closeWindow(targetId: string): Promise<{
  success: boolean;
  message: string;
}> {
  try {
    const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/close/${targetId}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) {
      return { success: true, message: 'Window closed successfully.' };
    } else {
      return { success: false, message: `Failed to close window: HTTP ${response.status}` };
    }
  } catch (e: any) {
    return { success: false, message: `Failed to close window: ${e.message}` };
  }
}

/**
 * Get detailed info about all CDP targets (workbench windows).
 */
export async function getWindowTargets(): Promise<{
  targets: Array<{ id: string; title: string; url: string }>;
  error?: string;
}> {
  try {
    const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      return { targets: [], error: `HTTP ${response.status}` };
    }
    const pages = await response.json() as any[];
    const workbenches = pages
      .filter((p: any) => isAntigravityWorkbenchTarget(p))
      .map((p: any) => ({
        id: p.id,
        title: p.title || 'Untitled',
        url: p.url,
      }));
    return { targets: workbenches };
  } catch (e: any) {
    return { targets: [], error: e.message };
  }
}

/**
 * Poll until CDP server is accessible AND has at least one workbench page.
 * Previously this only checked server liveness, causing connectToWorkbench()
 * to fail immediately with "No workbench pages found" after a restart.
 */
async function waitForCdp(timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = await isCdpServerActive();
    if (status.active && status.windowCount > 0) return true;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return false;
}

/**
 * Poll until the CDP server has at least one workbench page.
 * Use when CDP is already reachable but workbench pages haven't loaded yet.
 */
export async function waitForWorkbenchPages(timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = await isCdpServerActive();
    if (!status.active) return false; // CDP server went away
    if (status.windowCount > 0) return true;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return false;
}
