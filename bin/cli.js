#!/usr/bin/env node

const { spawn, execSync } = require('child_process');
const path = require('path');
const readline = require('readline');
const fs = require('fs');
const os = require('os');

// ── Colors & Formatting ─────────────────────────────────────────────────
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
  white: '\x1b[37m',
};

const fmt = {
  bold: (s) => `${c.bold}${s}${c.reset}`,
  dim: (s) => `${c.dim}${s}${c.reset}`,
  cyan: (s) => `${c.cyan}${s}${c.reset}`,
  green: (s) => `${c.green}${s}${c.reset}`,
  yellow: (s) => `${c.yellow}${s}${c.reset}`,
  red: (s) => `${c.red}${s}${c.reset}`,
  magenta: (s) => `${c.magenta}${s}${c.reset}`,
  blue: (s) => `${c.blue}${s}${c.reset}`,
  link: (s) => `${c.cyan}${c.underline}${s}${c.reset}`,
  success: (s) => `${c.green}✔${c.reset} ${s}`,
  error: (s) => `${c.red}✖${c.reset} ${s}`,
  warn: (s) => `${c.yellow}⚠${c.reset} ${s}`,
  info: (s) => `${c.cyan}ℹ${c.reset} ${s}`,
  step: (n, s) => `${c.dim}[${n}]${c.reset} ${s}`,
};

// ── Config file path ────────────────────────────────────────────────────
const CONFIG_DIR = path.join(os.homedir(), '.antigravity-touch');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    }
  } catch {}
  return {};
}

function saveConfig(config) {
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch {}
}

// ── Readline helpers ────────────────────────────────────────────────────
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

async function askWithDefault(question, defaultVal) {
  const hint = defaultVal ? ` ${c.dim}(${defaultVal})${c.reset}` : '';
  const answer = await ask(`${question}${hint}: `);
  return answer || defaultVal || '';
}

async function askYesNo(question, defaultYes = true) {
  const hint = defaultYes ? `${c.dim}(Y/n)${c.reset}` : `${c.dim}(y/N)${c.reset}`;
  const answer = await ask(`${question} ${hint}: `);
  if (!answer) return defaultYes;
  return answer.toLowerCase().startsWith('y');
}

async function askPassword(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;

    if (stdin.isTTY) {
      stdin.setRawMode(true);
    }

    let input = '';
    const onData = (char) => {
      const s = char.toString();

      if (s === '\n' || s === '\r') {
        stdin.removeListener('data', onData);
        if (stdin.isTTY) {
          stdin.setRawMode(wasRaw || false);
        }
        process.stdout.write('\n');
        resolve(input.trim());
        return;
      }

      if (s === '\u0003') {
        process.stdout.write('\n');
        process.exit(0);
      }

      if (s === '\u007f' || s === '\b') {
        if (input.length > 0) {
          input = input.slice(0, -1);
          process.stdout.write('\b \b');
        }
        return;
      }

      input += s;
      process.stdout.write('•');
    };

    stdin.resume();
    stdin.on('data', onData);
  });
}

function printSeparator() {
  console.log(c.dim + '  ─────────────────────────────────────────────' + c.reset);
}

function clearLine() {
  process.stdout.write('\x1b[2K\r');
}

// ── Browser Helper ──────────────────────────────────────────────────────
function openBrowser(url) {
  try {
    const cmd = process.platform === 'darwin' ? 'open'
              : process.platform === 'win32' ? 'start ""'
              : 'xdg-open';
    execSync(`${cmd} "${url}"`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// ── Banner ──────────────────────────────────────────────────────────────
function printBanner() {
  console.log('');
  console.log(`  ${c.bold}${c.cyan}╔═══════════════════════════════════════════════════════╗${c.reset}`);
  console.log(`  ${c.bold}${c.cyan}║${c.reset}  ${c.bold}🚀 Antigravity Touch${c.reset}                          ${c.bold}${c.cyan}║${c.reset}`);
  console.log(`  ${c.bold}${c.cyan}║${c.reset}  ${c.dim}Secure tunnel to your IDE with Google OAuth${c.reset}          ${c.bold}${c.cyan}║${c.reset}`);
  console.log(`  ${c.bold}${c.cyan}╚═══════════════════════════════════════════════════════╝${c.reset}`);
  console.log('');
}

// ── CLI Arg Parsing ─────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--email' && args[i + 1]) parsed.email = args[++i];
    else if (args[i] === '--port' && args[i + 1]) parsed.port = args[++i];
    else if (args[i] === '--host' && args[i + 1]) parsed.host = args[++i];
    else if (args[i] === '--authtoken' && args[i + 1]) parsed.authtoken = args[++i];
    else if (args[i] === '--no-tunnel') parsed.noTunnel = true;
    else if (args[i] === '--help') parsed.help = true;
    else if (args[i] === '--reset') parsed.reset = true;
    else if (args[i] === '--non-interactive') parsed.nonInteractive = true;
    else if (args[i] === '--install') parsed.install = true;
    else if (args[i] === '--uninstall') parsed.uninstall = true;
    else if (args[i] === '--status') parsed.status = true;
  }

  return parsed;
}

function printHelp() {
  printBanner();
  console.log(`  ${fmt.bold('Usage:')}`);
  console.log(`    ${fmt.cyan('npx antigravity-touch')}                ${fmt.dim('# Interactive setup wizard')}`);
  console.log(`    ${fmt.cyan('npx antigravity-touch --email me@gmail.com')}  ${fmt.dim('# Skip wizard')}`);
  console.log('');
  console.log(`  ${fmt.bold('Options:')}`);
  console.log(`    ${fmt.cyan('--email')} <email>       Google email to allow access`);
  console.log(`    ${fmt.cyan('--port')} <number>       Local port (default: 5555)`);
  console.log(`    ${fmt.cyan('--authtoken')} <token>   ngrok authtoken`);
  console.log(`    ${fmt.cyan('--no-tunnel')}           Run locally without ngrok`);
  console.log(`    ${fmt.cyan('--host')} <addr>         Bind address (no-tunnel default: 0.0.0.0 for LAN/phone)`);
  console.log(`    ${fmt.cyan('--reset')}               Reset saved configuration`);
  console.log(`    ${fmt.cyan('--install')}             Install as auto-start service (survives reboot)`);
  console.log(`    ${fmt.cyan('--uninstall')}           Remove the auto-start service`);
  console.log(`    ${fmt.cyan('--status')}              Check if the auto-start service is running`);
  console.log(`    ${fmt.cyan('--help')}                Show this help`);
  console.log('');
  console.log(`  ${fmt.bold('Environment Variables:')}`);
  console.log(`    ${fmt.cyan('NGROK_AUTHTOKEN')}       Your ngrok authtoken`);
  console.log('');
  console.log(`  ${fmt.bold('Always-on setup:')}`);
  console.log(`    ${fmt.dim('1.')} Run the wizard first: ${fmt.cyan('npx antigravity-touch')}`);
  console.log(`    ${fmt.dim('2.')} Install service:      ${fmt.cyan('npx antigravity-touch --install')}`);
  console.log(`    ${fmt.dim('   The proxy will now auto-start on login and restart on crashes.')}`);
  console.log('');
}

// ── Check if ngrok authtoken exists ─────────────────────────────────────
function detectAuthtoken() {
  if (process.env.NGROK_AUTHTOKEN) {
    return { token: process.env.NGROK_AUTHTOKEN, source: 'environment variable' };
  }

  const config = loadConfig();
  if (config.authtoken) {
    return { token: config.authtoken, source: 'saved config' };
  }

  const ngrokConfigPaths = [
    path.join(os.homedir(), '.config', 'ngrok', 'ngrok.yml'),
    path.join(os.homedir(), '.ngrok2', 'ngrok.yml'),
    path.join(os.homedir(), 'Library', 'Application Support', 'ngrok', 'ngrok.yml'),
    // Windows
    path.join(os.homedir(), 'AppData', 'Local', 'ngrok', 'ngrok.yml'),
  ];

  for (const configPath of ngrokConfigPaths) {
    try {
      if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, 'utf-8');
        const match = content.match(/authtoken:\s*(.+)/);
        if (match && match[1].trim()) {
          return { token: match[1].trim(), source: `ngrok config (${configPath})` };
        }
      }
    } catch {}
  }

  return null;
}

// ── Interactive Setup Wizard ────────────────────────────────────────────
async function runWizard(cliArgs) {
  printBanner();

  const config = loadConfig();
  const isFirstRun = !config.email && !config.port;

  if (isFirstRun) {
    console.log(`  ${fmt.info('Welcome! Let\'s set up your Antigravity Touch.')}`);
    console.log(`  ${fmt.dim('This wizard will guide you through the configuration.')}`);
    console.log(`  ${fmt.dim('Your settings will be saved for next time.')}`);
    console.log('');
  } else {
    console.log(`  ${fmt.info('Welcome back! Loading your saved settings.')}`);
    console.log(`  ${fmt.dim('Press Enter to keep defaults, or type new values.')}`);
    console.log('');
  }

  printSeparator();

  // ── Step 1: ngrok Authtoken ───────────────────────────────────────
  console.log('');
  console.log(`  ${fmt.step('1/3', fmt.bold('ngrok Authentication'))}`);
  console.log('');

  const existingAuth = detectAuthtoken();
  let authtoken = null;

  if (existingAuth) {
    const masked = existingAuth.token.slice(0, 8) + '••••••••' + existingAuth.token.slice(-4);
    console.log(`  ${fmt.success(`Found authtoken from ${fmt.dim(existingAuth.source)}`)}`);
    console.log(`  ${fmt.dim('  Token:')} ${masked}`);
    console.log('');

    const useExisting = await askYesNo(`  Use this token?`);
    if (useExisting) {
      authtoken = existingAuth.token;
    }
  }

  if (!authtoken) {
    console.log('');
    console.log(`  ${fmt.warn('ngrok authtoken is required for tunneling.')}`);
    console.log('');

    const dashboardUrl = 'https://dashboard.ngrok.com/get-started/your-authtoken';
    const browserOpened = openBrowser(dashboardUrl);

    if (browserOpened) {
      console.log(`  ${fmt.success('Opened ngrok dashboard in your browser')}`);
      console.log('');
      console.log(`  ${fmt.bold('What to do:')}`);
      console.log(`    ${fmt.cyan('1.')} Log in or sign up ${fmt.dim('(it\'s free)')}`);
      console.log(`    ${fmt.cyan('2.')} Copy your authtoken from the dashboard`);
      console.log(`    ${fmt.cyan('3.')} Paste it below`);
      console.log('');
    } else {
      // ── Headless / no browser — show URL manually ──────────────
      console.log(`  ${fmt.bold('How to get your authtoken:')}`);
      console.log(`    ${fmt.cyan('1.')} Go to ${fmt.link('https://dashboard.ngrok.com/signup')}`);
      console.log(`    ${fmt.cyan('2.')} Sign up (it's free) or log in`);
      console.log(`    ${fmt.cyan('3.')} Go to ${fmt.link(dashboardUrl)}`);
      console.log(`    ${fmt.cyan('4.')} Copy your authtoken`);
      console.log('');
    }

    authtoken = await askPassword(`  ${fmt.cyan('?')} Paste your authtoken: `);

    if (!authtoken) {
      console.log('');
      console.log(`  ${fmt.error('Authtoken is required. Exiting.')}`);
      process.exit(1);
    }

    console.log(`  ${fmt.success('Authtoken received')}`);

    const shouldSave = await askYesNo(`  ${fmt.cyan('?')} Save authtoken for future use?`);
    if (shouldSave) {
      config.authtoken = authtoken;
      saveConfig(config);
      console.log(`  ${fmt.success(`Saved to ${fmt.dim(CONFIG_FILE)}`)}`);
    }
  }

  // ── Step 2: Email ─────────────────────────────────────────────────
  console.log('');
  printSeparator();
  console.log('');
  console.log(`  ${fmt.step('2/3', fmt.bold('Access Control'))}`);
  console.log(`  ${fmt.dim('  Only the specified Google email will be able to access your proxy.')}`);
  console.log('');

  const email = await askWithDefault(
    `  ${fmt.cyan('?')} Google email to allow`,
    config.email || ''
  );

  if (!email || !email.includes('@')) {
    console.log('');
    console.log(`  ${fmt.error('A valid email address is required.')}`);
    process.exit(1);
  }

  console.log(`  ${fmt.success(`Access restricted to ${fmt.cyan(email)}`)}`);

  // ── Step 3: Port ──────────────────────────────────────────────────
  console.log('');
  printSeparator();
  console.log('');
  console.log(`  ${fmt.step('3/3', fmt.bold('Server Configuration'))}`);
  console.log('');

  const port = await askWithDefault(
    `  ${fmt.cyan('?')} Local port for the server`,
    config.port || '5555'
  );

  console.log(`  ${fmt.success(`Server will run on port ${fmt.cyan(port)}`)}`);

  // ── Save config ───────────────────────────────────────────────────
  config.email = email;
  config.port = port;
  saveConfig(config);

  // ── Summary ───────────────────────────────────────────────────────
  console.log('');
  printSeparator();
  console.log('');
  console.log(`  ${fmt.bold('📋 Configuration Summary')}`);
  console.log('');
  console.log(`  ${fmt.dim('Server Port')}     ${fmt.cyan(port)}`);
  console.log(`  ${fmt.dim('Tunnel')}          ${fmt.green('ngrok + Google OAuth')}`);
  console.log(`  ${fmt.dim('Allowed Email')}   ${fmt.cyan(email)}`);
  console.log(`  ${fmt.dim('Authtoken')}       ${authtoken.slice(0, 8)}••••••••${authtoken.slice(-4)}`);
  console.log('');

  const proceed = await askYesNo(`  ${fmt.cyan('?')} Start the server?`);

  if (!proceed) {
    console.log('');
    console.log(`  ${fmt.dim('Settings saved. Run again anytime!')}`);
    rl.close();
    process.exit(0);
  }

  rl.close();

  return { email, port, authtoken };
}

// ── Project Setup ───────────────────────────────────────────────────────
function getPackageRoot() {
  return path.resolve(__dirname, '..');
}

function getStandaloneDir() {
  return path.join(getPackageRoot(), '.next', 'standalone');
}

function isPrebuilt() {
  const standaloneServer = path.join(getStandaloneDir(), 'server.js');
  return fs.existsSync(standaloneServer);
}

function setupStandaloneAssets() {
  const packageRoot = getPackageRoot();
  const standaloneDir = getStandaloneDir();

  // The standalone output needs static files and public assets to be in the right place.
  // Copy .next/static → .next/standalone/.next/static
  const srcStatic = path.join(packageRoot, '.next', 'static');
  const destStatic = path.join(standaloneDir, '.next', 'static');

  if (fs.existsSync(srcStatic) && !fs.existsSync(destStatic)) {
    copyDirSync(srcStatic, destStatic);
  }

  // Copy public/ → .next/standalone/public
  const srcPublic = path.join(packageRoot, 'public');
  const destPublic = path.join(standaloneDir, 'public');

  if (fs.existsSync(srcPublic) && !fs.existsSync(destPublic)) {
    copyDirSync(srcPublic, destPublic);
  }

  // ── Fix: Copy puppeteer-core + deps to standalone ────────────────────
  // Next.js's file tracer only copies individually traced files (~10 of 1572)
  // for puppeteer-core, missing critical modules like ws (WebSocket with mask()),
  // chromium-bidi, debug, etc. This causes "b.mask is not a function" at runtime.
  // We copy the full packages so the native require() can resolve them properly.
  const externalPkgs = [
    'puppeteer-core',
    'ws',
    'chromium-bidi',
    'debug',
    'ms',
    'devtools-protocol',
    '@puppeteer/browsers',
    'typed-query-selector',
    'webdriver-bidi-protocol',
  ];

  const destModules = path.join(standaloneDir, 'node_modules');
  for (const pkg of externalPkgs) {
    const src = path.join(packageRoot, 'node_modules', pkg);
    const dest = path.join(destModules, pkg);
    // Only copy if the source exists and the destination doesn't have a package.json
    // (the tracer may have created a partial directory)
    if (fs.existsSync(src) && !fs.existsSync(path.join(dest, 'package.json'))) {
      try {
        // Remove the partial directory if the tracer left one
        if (fs.existsSync(dest)) {
          fs.rmSync(dest, { recursive: true, force: true });
        }
        copyDirSync(src, dest);
      } catch (e) {
        console.log(`  ${fmt.dim(`[setup] Warning: could not copy ${pkg}: ${e.message}`)}`);
      }
    }
  }
}

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// ── Server Startup ──────────────────────────────────────────────────────
/**
 * Determine which network interface the server should bind to.
 *
 * In no-tunnel (LAN) mode we must bind 0.0.0.0 so phones/other devices on the
 * same Wi-Fi can reach the server. Binding 127.0.0.1 (loopback) makes the app
 * reachable only from the host PC, which is why the mobile project list came up
 * empty. In tunnel mode 127.0.0.1 is enough because ngrok runs on the same host.
 */
function resolveBindHost({ host, noTunnel }) {
  if (host && host.trim()) return host.trim();
  return noTunnel ? '0.0.0.0' : '127.0.0.1';
}

function getLanIps() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
    }
  }
  return ips;
}

function startServer({ email, port, authtoken, noTunnel, host }) {
  const bindHost = resolveBindHost({ host, noTunnel });
  console.log('');
  printSeparator();
  console.log('');
  console.log(`  ${fmt.bold('🔧 Starting up...')}`);
  console.log('');

  const packageRoot = getPackageRoot();

  if (isPrebuilt()) {
    // ── Pre-built standalone mode (npx / published package) ─────
    console.log(`  ${fmt.success('Using pre-built app (no build needed)')}`);

    // Ensure static assets are in the right place
    setupStandaloneAssets();

    // Start the standalone server directly
    process.stdout.write(`  ${fmt.dim('▸ Starting server on port ' + port + '...')}`);

    const standaloneDir = getStandaloneDir();
    const serverJs = path.join(standaloneDir, 'server.js');

    const nextServer = spawn(process.execPath, [serverJs], {
      cwd: standaloneDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PORT: port, HOSTNAME: bindHost },
    });

    let serverStarted = false;

    nextServer.stdout.on('data', (data) => {
      const line = data.toString();
      if (!serverStarted && (line.includes('Ready') || line.includes('started') || line.includes(port))) {
        serverStarted = true;
        clearLine();
        console.log(`  ${fmt.success('Server running on port ' + port)}`);

        if (!noTunnel) {
          startTunnel({ port, email, authtoken, projectRoot: packageRoot });
        } else {
          printLocalOnly(port, bindHost);
        }
      }
    });

    nextServer.stderr.on('data', (data) => {
      const line = data.toString().trim();
      if (!line) return;
      // Suppress expected CDP auto-recovery noise — these are handled internally
      if (line.includes('[CDP]') || line.includes('[CDP Init]')) {
        // Only show the final "all attempts failed" message
        if (line.includes('All') && line.includes('recovery attempts failed')) {
          console.log(`  ${fmt.warn(line)}`);
        }
        return;
      }
      if (line.includes('[ProcessManager]')) {
         console.log(`  ${fmt.dim('[CDP]')} ${line}`);
         return;
      }
      if (line.toLowerCase().includes('error')) {
        console.log(`  ${fmt.dim('[next]')} ${line}`);
      }
    });

    nextServer.on('close', (exitCode) => {
      console.log(`\n  ${fmt.dim('Server stopped.')}`);
      process.exit(exitCode);
    });

    // ── Graceful shutdown ─────────────────────────────────────────
    const cleanup = () => {
      console.log('');
      console.log(`  ${fmt.dim('👋 Shutting down...')}`);
      nextServer.kill();
      process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    // Fallback: if we don't detect "Ready", start tunnel after timeout
    setTimeout(() => {
      if (!serverStarted) {
        serverStarted = true;
        clearLine();
        console.log(`  ${fmt.success('Server likely running on port ' + port)}`);
        if (!noTunnel) {
          startTunnel({ port, email, authtoken, projectRoot: packageRoot });
        } else {
          printLocalOnly(port, bindHost);
        }
      }
    }, 8000);

  } else {
    // ── Dev mode (running from source, not published) ────────────
    console.log(`  ${fmt.dim('No pre-built app found, building from source...')}`);

    const nextEntry = path.join(packageRoot, 'node_modules', 'next', 'dist', 'bin', 'next');

    // Build
    process.stdout.write(`  ${fmt.dim('▸ Building Next.js app...')}`);

    const build = spawn(process.execPath, [nextEntry, 'build'], {
      cwd: packageRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let buildOutput = '';
    build.stdout.on('data', (data) => { buildOutput += data.toString(); });
    build.stderr.on('data', (data) => { buildOutput += data.toString(); });

    build.on('close', (code) => {
      clearLine();

      if (code !== 0) {
        console.log(`  ${fmt.error('Build failed!')}`);
        console.log('');
        console.log(buildOutput);
        process.exit(1);
      }

      console.log(`  ${fmt.success('Build complete')}`);

      // Start using standalone if it was just built
      if (isPrebuilt()) {
        setupStandaloneAssets();
        const standaloneDir = getStandaloneDir();
        const serverJs = path.join(standaloneDir, 'server.js');

        process.stdout.write(`  ${fmt.dim('▸ Starting server on port ' + port + '...')}`);

        const nextServer = spawn(process.execPath, [serverJs], {
          cwd: standaloneDir,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, PORT: port, HOSTNAME: bindHost },
        });

        let serverStarted = false;

        nextServer.stdout.on('data', (data) => {
          const line = data.toString();
          if (!serverStarted && (line.includes('Ready') || line.includes('started') || line.includes(port))) {
            serverStarted = true;
            clearLine();
            console.log(`  ${fmt.success('Server running on port ' + port)}`);

            if (!noTunnel) {
              startTunnel({ port, email, authtoken, projectRoot: packageRoot });
            } else {
              printLocalOnly(port, bindHost);
            }
          }
        });

        nextServer.stderr.on('data', (data) => {
          const line = data.toString().trim();
          if (!line) return;
          if (line.includes('[CDP]') || line.includes('[CDP Init]') || line.includes('[ProcessManager]')) {
            if (line.includes('All') && line.includes('recovery attempts failed')) {
              console.log(`  ${fmt.warn(line)}`);
            }
            return;
          }
          if (line && line.toLowerCase().includes('error')) {
            console.log(`  ${fmt.dim('[next]')} ${line}`);
          }
        });

        nextServer.on('close', (exitCode) => {
          console.log(`\n  ${fmt.dim('Server stopped.')}`);
          process.exit(exitCode);
        });

        const cleanup = () => {
          console.log('');
          console.log(`  ${fmt.dim('👋 Shutting down...')}`);
          nextServer.kill();
          process.exit(0);
        };

        process.on('SIGINT', cleanup);
        process.on('SIGTERM', cleanup);

        setTimeout(() => {
          if (!serverStarted) {
            serverStarted = true;
            clearLine();
            console.log(`  ${fmt.success('Server likely running on port ' + port)}`);
            if (!noTunnel) {
              startTunnel({ port, email, authtoken, projectRoot: packageRoot });
            } else {
              printLocalOnly(port, bindHost);
            }
          }
        }, 8000);

      } else {
        // Fallback: use next start
        process.stdout.write(`  ${fmt.dim('▸ Starting server on port ' + port + '...')}`);

        const nextServer = spawn(process.execPath, [nextEntry, 'start', '-p', port, '-H', bindHost], {
          cwd: packageRoot,
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        let serverStarted = false;

        nextServer.stdout.on('data', (data) => {
          const line = data.toString();
          if (!serverStarted && (line.includes('Ready') || line.includes('started') || line.includes(port))) {
            serverStarted = true;
            clearLine();
            console.log(`  ${fmt.success('Server running on port ' + port)}`);
            if (!noTunnel) {
              startTunnel({ port, email, authtoken, projectRoot: packageRoot });
            } else {
              printLocalOnly(port, bindHost);
            }
          }
        });

        nextServer.stderr.on('data', (data) => {
          const line = data.toString().trim();
          if (!line) return;
          if (line.includes('[CDP]') || line.includes('[CDP Init]') || line.includes('[ProcessManager]')) {
            if (line.includes('All') && line.includes('recovery attempts failed')) {
              console.log(`  ${fmt.warn(line)}`);
            }
            return;
          }
          if (line && line.toLowerCase().includes('error')) {
            console.log(`  ${fmt.dim('[next]')} ${line}`);
          }
        });

        nextServer.on('close', (exitCode) => {
          console.log(`\n  ${fmt.dim('Next.js server stopped.')}`);
          process.exit(exitCode);
        });

        const cleanup = () => {
          console.log('');
          console.log(`  ${fmt.dim('👋 Shutting down...')}`);
          nextServer.kill();
          process.exit(0);
        };

        process.on('SIGINT', cleanup);
        process.on('SIGTERM', cleanup);

        setTimeout(() => {
          if (!serverStarted) {
            serverStarted = true;
            clearLine();
            console.log(`  ${fmt.success('Server likely running on port ' + port)}`);
            if (!noTunnel) {
              startTunnel({ port, email, authtoken, projectRoot: packageRoot });
            } else {
              printLocalOnly(port, bindHost);
            }
          }
        }, 8000);
      }
    });
  }
}

// ── Tunnel Manager ───────────────────────────────────────────────────────────
// Stateful ngrok controller with automatic reconnect + network recovery.

const dns = require('dns');

const TUNNEL_INITIAL_BACKOFF_MS = 2_000;
const TUNNEL_MAX_BACKOFF_MS     = 60_000;
const TUNNEL_BACKOFF_MULTIPLIER = 1.8;
const TUNNEL_NETWORK_POLL_MS    = 3_000;
const TUNNEL_PROBE_HOST         = 'dns.google';

function probeNetwork() {
  return new Promise((resolve) => {
    dns.lookup(TUNNEL_PROBE_HOST, (err) => resolve(!err));
  });
}

function waitForNetwork() {
  return new Promise((resolve) => {
    const check = async () => {
      const online = await probeNetwork();
      if (online) { resolve(); } else { setTimeout(check, TUNNEL_NETWORK_POLL_MS); }
    };
    check();
  });
}

class TunnelManager {
  constructor({ port, email, authtoken, projectRoot }) {
    this.port        = port;
    this.email       = email;
    this.authtoken   = authtoken;
    this.projectRoot = projectRoot;
    this.ngrok       = this._loadNgrok();
    this.listener    = null;
    this.url         = null;
    this.attempt     = 0;
    this.backoff     = TUNNEL_INITIAL_BACKOFF_MS;
    this.destroyed   = false;
    this._reconnectTimer = null;
  }

  _loadNgrok() {
    const localNgrok = path.join(this.projectRoot, 'node_modules', '@ngrok', 'ngrok');
    try { return require(localNgrok); } catch { return require('@ngrok/ngrok'); }
  }

  /** Kill any lingering ngrok sessions from a previous run (cross-platform). */
  _killStaleAgents() {
    try {
      const { execSync } = require('child_process');
      const isWin = process.platform === 'win32';
      let killed = 0;

      if (isWin) {
        // Windows: use tasklist + taskkill
        const result = execSync('tasklist /FI "IMAGENAME eq ngrok.exe" /FO CSV /NH 2>NUL || echo ""', { encoding: 'utf-8' }).trim();
        if (result && !result.startsWith('INFO:') && result.includes('ngrok')) {
          try {
            execSync('taskkill /F /IM ngrok.exe 2>NUL', { encoding: 'utf-8' });
            killed++;
          } catch {}
        }
      } else {
        // Linux / macOS: use pgrep
        const result = execSync('pgrep -f "ngrok" 2>/dev/null || true', { encoding: 'utf-8' }).trim();
        if (result) {
          const pids = result.split('\n').filter(pid => pid && parseInt(pid, 10) !== process.pid);
          for (const pid of pids) {
            try { process.kill(parseInt(pid, 10), 'SIGTERM'); killed++; } catch {}
          }
        }
      }

      if (killed > 0) {
        console.log(`  ${fmt.dim(`Cleaned up ${killed} stale ngrok process(es)`)}`);
      }
    } catch {}
  }

  async start() {
    // Fully disconnect any sessions held by the in-process ngrok SDK
    try { await this.ngrok.kill(); } catch {}
    // Also kill orphan OS-level ngrok processes from prior crashed runs
    this._killStaleAgents();
    // Brief pause so ngrok's servers can release the old endpoint
    await new Promise(r => setTimeout(r, 1500));
    await this._connect();
  }

  async _connect() {
    if (this.destroyed) return;

    if (this.attempt === 0) {
      process.stdout.write(`  ${fmt.dim('▸ Opening ngrok tunnel...')}`);
    } else {
      console.log(`  ${fmt.yellow(`⟳ Reconnecting ngrok… (attempt ${this.attempt})`)} `);
    }

    try {

      // Traffic Policy with a unique auth_id per session so stale cookies
      // from previous tunnel sessions are ignored (fixes ERR_NGROK_3303).
      // Email restriction is enforced via an expression + deny rule.
      //
      // IMPORTANT: PWA-critical files (manifest, service worker, icons) are
      // excluded from BOTH OAuth and the deny rule. Mobile browsers fetch
      // these via non-authenticated background contexts — OAuth redirects
      // break them, preventing PWA installation on mobile.
      const pwaPaths = [
        "req.url.path.startsWith('/manifest')",
        "req.url.path.startsWith('/sw.')",
        "req.url.path.startsWith('/workbox-')",
        "req.url.path.startsWith('/fallback-')",
        "req.url.path.startsWith('/icons/')",
        "req.url.path.startsWith('/favicon')"
      ];
      const notPwaExpr = pwaPaths.map(p => `!${p}`);

      const trafficPolicy = JSON.stringify({
        on_http_request: [
          {
            // Rule 1: Apply OAuth to all non-PWA paths
            expressions: notPwaExpr,
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
            // Rule 2: Deny non-allowed emails (only for OAuth-protected paths)
            // The same PWA exclusion prevents denying unauthenticated PWA requests
            expressions: [
              ...notPwaExpr,
              `actions.ngrok.oauth.identity.email != '${this.email}'`
            ],
            actions: [
              { type: "deny" }
            ]
          }
        ]
      });

      this.listener = await this.ngrok.forward({
        addr:               parseInt(this.port, 10),
        authtoken:          this.authtoken,
        traffic_policy:     trafficPolicy,

        // Keep the same URL across reconnections (prevents ERR_NGROK_3200)
        pooling_enabled:    true,

        // Built-in ngrok disconnect callback
        on_status_change: (addr, error) => {
          if (this.destroyed) return;
          const reason = error || 'connection lost';
          this._onDropped(reason);
        },
      });

      this.url = this.listener.url();
      this.backoff = TUNNEL_INITIAL_BACKOFF_MS; // reset on success

      clearLine();
      this._printConnected(this.url);

    } catch (err) {
      clearLine();

      // Only real auth errors are fatal — NOT endpoint conflicts (ERR_NGROK_334)
      const isFatalAuth = err.message && (
        err.message.includes('authtoken') ||
        err.message.includes('authentication')
      );

      if (isFatalAuth) {
        // Auth errors are fatal — don't retry.
        console.log(`  ${fmt.error('ngrok tunnel failed (auth error)!')}`);
        console.log(`  ${fmt.red(err.message)}`);
        console.log('');
        console.log(`  ${fmt.warn('Your authtoken may be invalid or expired.')}`);
        console.log(`  ${fmt.dim('Get a new one at:')} ${fmt.link('https://dashboard.ngrok.com/get-started/your-authtoken')}`);
        console.log(`  ${fmt.dim('Then run:')} ${fmt.cyan('npx antigravity-touch --reset')}`);
        return;
      }

      // Transient error (including ERR_NGROK_334 endpoint conflict) — schedule reconnect
      this._onDropped(err.message || 'connection error');
    }
  }

  _onDropped(reason) {
    if (this.destroyed) return;

    // Guard: prevent duplicate reconnects if on_status_change fires multiple times
    if (this._reconnectTimer) return;

    console.log(`\n  ${fmt.warn(`ngrok tunnel dropped: ${reason}`)}`);

    // Fully tear down old session so ngrok's servers release the endpoint.
    // Without this, the old endpoint stays registered and the next forward()
    // hits ERR_NGROK_334 ("endpoint already exists").
    if (this.listener) {
      try { this.listener.close(); } catch {}
      this.listener = null;
    }
    this.url = null;
    // kill() is more thorough than disconnect() — it tears down the entire
    // agent session, not just the individual listener.  This frees the
    // session slot on ngrok's servers and prevents ERR_NGROK_108.
    try { this.ngrok.kill(); } catch {}
    try { this.ngrok.disconnect(); } catch {}

    this.attempt++;
    const delay = this.backoff;
    this.backoff = Math.min(this.backoff * TUNNEL_BACKOFF_MULTIPLIER, TUNNEL_MAX_BACKOFF_MS);

    console.log(`  ${fmt.dim(`Will reconnect in ${Math.round(delay / 1000)}s (attempt ${this.attempt})… waiting for network`)}`);

    this._reconnectTimer = setTimeout(async () => {
      this._reconnectTimer = null;
      if (this.destroyed) return;
      await waitForNetwork();      // Block until network is alive again
      if (!this.destroyed) await this._connect();
    }, delay);
  }

  _printConnected(url) {
    console.log(`  ${fmt.success('ngrok tunnel established')}`);
    console.log('');

    // Generate QR code for the URL so users can scan from their phone
    try {
      const qrcode = require('qrcode-terminal');
      qrcode.generate(url, { small: true }, (qrString) => {
        console.log(`  ${c.bold}${c.cyan}╔═══════════════════════════════════════════════════════╗${c.reset}`);
        console.log(`  ${c.bold}${c.cyan}║${c.reset}                                                       ${c.bold}${c.cyan}║${c.reset}`);
        console.log(`  ${c.bold}${c.cyan}║${c.reset}   ${c.green}${c.bold}🌐 Your app is live!${c.reset}                              ${c.bold}${c.cyan}║${c.reset}`);
        console.log(`  ${c.bold}${c.cyan}║${c.reset}                                                       ${c.bold}${c.cyan}║${c.reset}`);
        console.log(`  ${c.bold}${c.cyan}║${c.reset}   ${c.dim}Scan the QR code to open on your phone:${c.reset}            ${c.bold}${c.cyan}║${c.reset}`);
        console.log(`  ${c.bold}${c.cyan}║${c.reset}                                                       ${c.bold}${c.cyan}║${c.reset}`);

        // Print each line of the QR code, centered in the box
        const qrLines = qrString.split('\n').filter(l => l.length > 0);
        for (const line of qrLines) {
          const visibleLen = line.replace(/\x1b\[[0-9;]*m/g, '').length;
          const padLeft = Math.max(0, Math.floor((55 - visibleLen) / 2));
          const padRight = Math.max(0, 55 - visibleLen - padLeft);
          console.log(`  ${c.bold}${c.cyan}║${c.reset}${' '.repeat(padLeft)}${c.green}${line}${c.reset}${' '.repeat(padRight)}${c.bold}${c.cyan}║${c.reset}`);
        }

        console.log(`  ${c.bold}${c.cyan}║${c.reset}                                                       ${c.bold}${c.cyan}║${c.reset}`);
        console.log(`  ${c.bold}${c.cyan}║${c.reset}   ${c.dim}Or open manually:${c.reset}                                  ${c.bold}${c.cyan}║${c.reset}`);
        console.log(`  ${c.bold}${c.cyan}║${c.reset}   ${url} ${' '.repeat(Math.max(0, 39 - url.length))}${c.bold}${c.cyan}║${c.reset}`);
        console.log(`  ${c.bold}${c.cyan}║${c.reset}                                                       ${c.bold}${c.cyan}║${c.reset}`);
        console.log(`  ${c.bold}${c.cyan}║${c.reset}   ${c.dim}🔒 Google OAuth → ${this.email}${' '.repeat(Math.max(0, 23 - this.email.length))}${c.reset}${c.bold}${c.cyan}║${c.reset}`);
        console.log(`  ${c.bold}${c.cyan}║${c.reset}                                                       ${c.bold}${c.cyan}║${c.reset}`);
        console.log(`  ${c.bold}${c.cyan}╚═══════════════════════════════════════════════════════╝${c.reset}`);
        console.log('');
        console.log(`  ${fmt.dim('Press Ctrl+C to stop.')}`);
        console.log('');
      });
    } catch {
      // Fallback: if qrcode-terminal is not available, show URL only
      console.log(`  ${c.bold}${c.cyan}╔═══════════════════════════════════════════════════════╗${c.reset}`);
      console.log(`  ${c.bold}${c.cyan}║${c.reset}                                                       ${c.bold}${c.cyan}║${c.reset}`);
      console.log(`  ${c.bold}${c.cyan}║${c.reset}   ${c.green}${c.bold}🌐 Your app is live!${c.reset}                              ${c.bold}${c.cyan}║${c.reset}`);
      console.log(`  ${c.bold}${c.cyan}║${c.reset}                                                       ${c.bold}${c.cyan}║${c.reset}`);
      console.log(`  ${c.bold}${c.cyan}║${c.reset}   ${url} ${' '.repeat(Math.max(0, 39 - url.length))}${c.bold}${c.cyan}║${c.reset}`);
      console.log(`  ${c.bold}${c.cyan}║${c.reset}                                                       ${c.bold}${c.cyan}║${c.reset}`);
      console.log(`  ${c.bold}${c.cyan}║${c.reset}   ${c.dim}🔒 Google OAuth → ${this.email}${' '.repeat(Math.max(0, 23 - this.email.length))}${c.reset}${c.bold}${c.cyan}║${c.reset}`);
      console.log(`  ${c.bold}${c.cyan}║${c.reset}                                                       ${c.bold}${c.cyan}║${c.reset}`);
      console.log(`  ${c.bold}${c.cyan}╚═══════════════════════════════════════════════════════╝${c.reset}`);
      console.log('');
      console.log(`  ${fmt.dim('Press Ctrl+C to stop.')}`);
      console.log('');
    }
  }

  async stop() {
    this.destroyed = true;
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); }
    if (this.listener) { try { await this.listener.close(); } catch {} }
    try { await this.ngrok.kill(); } catch {}
    try { await this.ngrok.disconnect(); } catch {}
  }
}

// ── Start ngrok Tunnel ──────────────────────────────────────────────────
function startTunnel({ port, email, authtoken, projectRoot }) {
  const mgr = new TunnelManager({ port, email, authtoken, projectRoot });
  mgr.start().catch((err) => {
    clearLine();
    console.log(`  ${fmt.error('ngrok tunnel failed!')}`);
    console.log(`  ${fmt.red(err.message)}`);
  });
  return mgr; // returned so cleanup can call mgr.stop()
}

function printLocalOnly(port, host) {
  const lanReachable = host === '0.0.0.0' || host === '::';
  console.log('');
  console.log(`  ${c.bold}${c.cyan}╔═══════════════════════════════════════════════════════╗${c.reset}`);
  console.log(`  ${c.bold}${c.cyan}║${c.reset}                                                       ${c.bold}${c.cyan}║${c.reset}`);
  console.log(`  ${c.bold}${c.cyan}║${c.reset}   ${c.green}${c.bold}🖥  Running locally${c.reset}                               ${c.bold}${c.cyan}║${c.reset}`);
  console.log(`  ${c.bold}${c.cyan}║${c.reset}   ${fmt.cyan(`http://localhost:${port}`)}                            ${c.bold}${c.cyan}║${c.reset}`);
  console.log(`  ${c.bold}${c.cyan}║${c.reset}                                                       ${c.bold}${c.cyan}║${c.reset}`);
  console.log(`  ${c.bold}${c.cyan}╚═══════════════════════════════════════════════════════╝${c.reset}`);
  console.log('');

  if (lanReachable) {
    const ips = getLanIps();
    if (ips.length > 0) {
      console.log(`  ${fmt.bold('📱 On your phone (same Wi-Fi):')}`);
      for (const ip of ips) {
        console.log(`     ${fmt.link(`http://${ip}:${port}`)}`);
      }
      console.log('');
    } else {
      console.log(`  ${fmt.dim('Tip: open http://<this-PC-LAN-IP>:' + port + ' on your phone (same Wi-Fi).')}`);
      console.log('');
    }
  } else {
    console.log(`  ${fmt.dim('Bound to ' + host + ' (loopback only). For phone access, use --host 0.0.0.0.')}`);
    console.log('');
  }

  console.log(`  ${fmt.dim('Press Ctrl+C to stop.')}`);
  console.log('');
}

// ── Auto-Start Service Manager ──────────────────────────────────────────
// Cross-platform: systemd (Linux), launchd (macOS), Task Scheduler (Windows)

const SERVICE_NAME = 'antigravity-touch';

function getServicePaths() {
  const platform = process.platform;
  const home = os.homedir();

  if (platform === 'linux') {
    return {
      type: 'systemd',
      dir: path.join(home, '.config', 'systemd', 'user'),
      file: path.join(home, '.config', 'systemd', 'user', `${SERVICE_NAME}.service`),
    };
  } else if (platform === 'darwin') {
    return {
      type: 'launchd',
      dir: path.join(home, 'Library', 'LaunchAgents'),
      file: path.join(home, 'Library', 'LaunchAgents', `com.antigravity.touch.plist`),
    };
  } else if (platform === 'win32') {
    return {
      type: 'taskscheduler',
      dir: null, // Task Scheduler doesn't use a file directory
      file: null,
      taskName: 'AntigravityTouch',
    };
  }
  return { type: 'unknown' };
}

function buildServiceConfig({ email, port, authtoken }) {
  const nodePath = process.execPath;
  const cliPath = path.resolve(__filename);
  const projectRoot = getPackageRoot();
  const svc = getServicePaths();

  if (svc.type === 'systemd') {
    // ── Linux: systemd user service ─────────────────────────────────
    // IMPORTANT: Antigravity is an Electron (GUI) app. The service must:
    // 1. Wait for the graphical session to be ready (graphical-session.target)
    // 2. Pass DISPLAY and XDG_RUNTIME_DIR so Electron can find the display server
    // Without these, spawning Antigravity from auto-recovery will crash (exit 0)
    // and the process reuse mechanism may corrupt manually-opened instances.
    return `[Unit]
Description=Antigravity Touch (ngrok tunnel + Next.js server)
After=network-online.target graphical-session.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${nodePath} ${cliPath} --non-interactive --email ${email} --port ${port} --authtoken ${authtoken}
WorkingDirectory=${projectRoot}
Environment="PATH=${path.dirname(nodePath)}:/usr/local/bin:/usr/bin:/bin"
Environment="NODE_ENV=production"
Environment="HOME=${os.homedir()}"
Environment="DISPLAY=:1"
Environment="XDG_RUNTIME_DIR=/run/user/${process.getuid ? process.getuid() : 1000}"
Restart=on-failure
RestartSec=10
TimeoutStopSec=15
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE_NAME}

[Install]
WantedBy=default.target
`;
  }

  if (svc.type === 'launchd') {
    // ── macOS: launchd plist ─────────────────────────────────────────
    const logDir = path.join(os.homedir(), '.antigravity-touch', 'logs');
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.antigravity.touch</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${cliPath}</string>
    <string>--non-interactive</string>
    <string>--email</string>
    <string>${email}</string>
    <string>--port</string>
    <string>${port}</string>
    <string>--authtoken</string>
    <string>${authtoken}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${projectRoot}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${logDir}/stdout.log</string>
  <key>StandardErrorPath</key>
  <string>${logDir}/stderr.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key>
    <string>production</string>
    <key>PATH</key>
    <string>${path.dirname(nodePath)}:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>
`;
  }

  if (svc.type === 'taskscheduler') {
    // ── Windows: schtasks command args ───────────────────────────────
    // We use a VBScript wrapper to launch Node invisibly (no console window).
    // The VBS file is written during --install and the scheduled task
    // invokes wscript.exe pointing at that .vbs file.
    const vbsDir = path.join(os.homedir(), '.antigravity-touch');
    const vbsPath = path.join(vbsDir, 'launcher.vbs');

    // VBScript content: Run(..., 0, False) → 0 = hidden window, False = don't wait
    const vbsContent = `CreateObject("WScript.Shell").Run """${nodePath}"" ""${cliPath}"" --non-interactive --email ${email} --port ${port} --authtoken ${authtoken}", 0, False`;

    return {
      vbsDir,
      vbsPath,
      vbsContent,
      command: `schtasks /Create /F /SC ONLOGON /TN "${svc.taskName}" /TR "wscript.exe '${vbsPath}'" /RL HIGHEST`,
      uninstall: `schtasks /Delete /F /TN "${svc.taskName}"`,
      status: `schtasks /Query /TN "${svc.taskName}"`,
    };
  }

  return null;
}

async function installService() {
  printBanner();
  console.log(`  ${fmt.bold('🔧 Installing Auto-Start Service')}`);
  console.log('');

  // ── Gather config (from saved config + authtoken detection) ────────
  const config = loadConfig();
  const auth = detectAuthtoken();

  const email = config.email;
  const port = config.port || '5555';
  const authtoken = auth ? auth.token : null;

  if (!email) {
    console.log(`  ${fmt.error('No email configured yet.')}`);
    console.log(`  ${fmt.dim('Run the wizard first:')} ${fmt.cyan('npx antigravity-touch')}`);
    console.log(`  ${fmt.dim('Then run:')} ${fmt.cyan('npx antigravity-touch --install')}`);
    process.exit(1);
  }

  if (!authtoken) {
    console.log(`  ${fmt.error('No ngrok authtoken found.')}`);
    console.log(`  ${fmt.dim('Run the wizard first:')} ${fmt.cyan('npx antigravity-touch')}`);
    process.exit(1);
  }

  const svc = getServicePaths();

  console.log(`  ${fmt.dim('Platform:')}   ${fmt.cyan(process.platform + ' (' + svc.type + ')')}`);
  console.log(`  ${fmt.dim('Email:')}      ${fmt.cyan(email)}`);
  console.log(`  ${fmt.dim('Port:')}       ${fmt.cyan(port)}`);
  console.log(`  ${fmt.dim('Node:')}       ${fmt.cyan(process.execPath)}`);
  console.log('');

  if (svc.type === 'systemd') {
    // ── Linux: systemd ──────────────────────────────────────────────
    const content = buildServiceConfig({ email, port, authtoken });

    if (!fs.existsSync(svc.dir)) {
      fs.mkdirSync(svc.dir, { recursive: true });
    }
    fs.writeFileSync(svc.file, content);
    console.log(`  ${fmt.success('Service file written to:')}`);
    console.log(`  ${fmt.dim(svc.file)}`);
    console.log('');

    // Enable and start
    try {
      execSync('systemctl --user daemon-reload', { stdio: 'pipe' });
      console.log(`  ${fmt.success('Reloaded systemd daemon')}`);
    } catch (e) {
      console.log(`  ${fmt.warn('Could not reload systemd: ' + e.message)}`);
    }

    try {
      execSync(`systemctl --user enable ${SERVICE_NAME}.service`, { stdio: 'pipe' });
      console.log(`  ${fmt.success('Enabled service (will start on login)')}`);
    } catch (e) {
      console.log(`  ${fmt.warn('Could not enable service: ' + e.message)}`);
    }

    try {
      execSync(`systemctl --user restart ${SERVICE_NAME}.service`, { stdio: 'pipe' });
      console.log(`  ${fmt.success('Started service')}`);
    } catch (e) {
      console.log(`  ${fmt.warn('Could not start service: ' + e.message)}`);
    }

    // Enable lingering so the service runs even when not logged in via GUI
    try {
      execSync(`loginctl enable-linger ${os.userInfo().username}`, { stdio: 'pipe' });
      console.log(`  ${fmt.success('Enabled linger (service runs even without active session)')}`);
    } catch {
      console.log(`  ${fmt.dim('Note: "loginctl enable-linger" may need sudo for persistence without login')}`);
    }

    console.log('');
    printSeparator();
    console.log('');
    console.log(`  ${fmt.bold('✅ Auto-start installed!')}`);
    console.log('');
    console.log(`  ${fmt.dim('View logs:')}     ${fmt.cyan(`journalctl --user -u ${SERVICE_NAME} -f`)}`);
    console.log(`  ${fmt.dim('Check status:')} ${fmt.cyan(`systemctl --user status ${SERVICE_NAME}`)}`);
    console.log(`  ${fmt.dim('Stop:')}          ${fmt.cyan(`systemctl --user stop ${SERVICE_NAME}`)}`);
    console.log(`  ${fmt.dim('Restart:')}       ${fmt.cyan(`systemctl --user restart ${SERVICE_NAME}`)}`);
    console.log(`  ${fmt.dim('Uninstall:')}     ${fmt.cyan('npx antigravity-touch --uninstall')}`);
    console.log('');

  } else if (svc.type === 'launchd') {
    // ── macOS: launchd ──────────────────────────────────────────────
    const content = buildServiceConfig({ email, port, authtoken });
    const logDir = path.join(os.homedir(), '.antigravity-touch', 'logs');

    if (!fs.existsSync(svc.dir)) {
      fs.mkdirSync(svc.dir, { recursive: true });
    }
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    // Unload the existing agent first (if any)
    try { execSync(`launchctl unload ${svc.file}`, { stdio: 'pipe' }); } catch {}

    fs.writeFileSync(svc.file, content);
    console.log(`  ${fmt.success('Plist written to:')}`);
    console.log(`  ${fmt.dim(svc.file)}`);
    console.log('');

    try {
      execSync(`launchctl load ${svc.file}`, { stdio: 'pipe' });
      console.log(`  ${fmt.success('Service loaded and started')}`);
    } catch (e) {
      console.log(`  ${fmt.warn('Could not load service: ' + e.message)}`);
    }

    console.log('');
    printSeparator();
    console.log('');
    console.log(`  ${fmt.bold('✅ Auto-start installed!')}`);
    console.log('');
    console.log(`  ${fmt.dim('View logs:')}     ${fmt.cyan(`tail -f ${logDir}/stdout.log`)}`);
    console.log(`  ${fmt.dim('Check status:')} ${fmt.cyan('launchctl list | grep antigravity')}`);
    console.log(`  ${fmt.dim('Stop:')}          ${fmt.cyan(`launchctl unload ${svc.file}`)}`);
    console.log(`  ${fmt.dim('Start:')}         ${fmt.cyan(`launchctl load ${svc.file}`)}`);
    console.log(`  ${fmt.dim('Uninstall:')}     ${fmt.cyan('npx antigravity-touch --uninstall')}`);
    console.log('');

  } else if (svc.type === 'taskscheduler') {
    // ── Windows: Task Scheduler ─────────────────────────────────────
    const cmds = buildServiceConfig({ email, port, authtoken });

    // Write the VBS launcher script (runs Node invisibly, no console window)
    if (!fs.existsSync(cmds.vbsDir)) {
      fs.mkdirSync(cmds.vbsDir, { recursive: true });
    }
    fs.writeFileSync(cmds.vbsPath, cmds.vbsContent);
    console.log(`  ${fmt.success('Launcher script written to:')}`);
    console.log(`  ${fmt.dim(cmds.vbsPath)}`);
    console.log('');

    try {
      execSync(cmds.command, { stdio: 'pipe' });
      console.log(`  ${fmt.success('Task created in Windows Task Scheduler')}`);
    } catch (e) {
      console.log(`  ${fmt.error('Failed to create task: ' + e.message)}`);
      console.log(`  ${fmt.dim('You may need to run this terminal as Administrator')}`);
      process.exit(1);
    }

    // Start it immediately (runs hidden via VBS)
    try {
      execSync(`schtasks /Run /TN "${svc.taskName}"`, { stdio: 'pipe' });
      console.log(`  ${fmt.success('Service started (running in background)')}`);
    } catch {}

    console.log('');
    printSeparator();
    console.log('');
    console.log(`  ${fmt.bold('✅ Auto-start installed!')}`);
    console.log(`  ${fmt.dim('The proxy runs silently in the background — no console window.')}`);
    console.log('');
    console.log(`  ${fmt.dim('Check status:')} ${fmt.cyan(`schtasks /Query /TN "${svc.taskName}"`)}`);
    console.log(`  ${fmt.dim('Uninstall:')}     ${fmt.cyan('npx antigravity-touch --uninstall')}`);
    console.log('');

  } else {
    console.log(`  ${fmt.error(`Unsupported platform: ${process.platform}`)}`);
    console.log(`  ${fmt.dim('Supported: Linux (systemd), macOS (launchd), Windows (Task Scheduler)')}`);
    process.exit(1);
  }
}

async function uninstallService() {
  printBanner();
  console.log(`  ${fmt.bold('🗑  Removing Auto-Start Service')}`);
  console.log('');

  const svc = getServicePaths();

  if (svc.type === 'systemd') {
    try { execSync(`systemctl --user stop ${SERVICE_NAME}.service`, { stdio: 'pipe' }); } catch {}
    try { execSync(`systemctl --user disable ${SERVICE_NAME}.service`, { stdio: 'pipe' }); } catch {}
    if (fs.existsSync(svc.file)) {
      fs.unlinkSync(svc.file);
    }
    try { execSync('systemctl --user daemon-reload', { stdio: 'pipe' }); } catch {}
    console.log(`  ${fmt.success('systemd service removed')}`);

  } else if (svc.type === 'launchd') {
    try { execSync(`launchctl unload ${svc.file}`, { stdio: 'pipe' }); } catch {}
    if (fs.existsSync(svc.file)) {
      fs.unlinkSync(svc.file);
    }
    console.log(`  ${fmt.success('launchd agent removed')}`);

  } else if (svc.type === 'taskscheduler') {
    try {
      execSync(`schtasks /Delete /F /TN "${svc.taskName}"`, { stdio: 'pipe' });
      console.log(`  ${fmt.success('Scheduled task removed')}`);
    } catch (e) {
      console.log(`  ${fmt.warn('Could not remove task (may not exist): ' + e.message)}`);
    }

    // Clean up the VBS launcher script
    const vbsPath = path.join(os.homedir(), '.antigravity-touch', 'launcher.vbs');
    try {
      if (fs.existsSync(vbsPath)) {
        fs.unlinkSync(vbsPath);
        console.log(`  ${fmt.success('Launcher script removed')}`);
      }
    } catch {}

  } else {
    console.log(`  ${fmt.error(`Unsupported platform: ${process.platform}`)}`);
    process.exit(1);
  }

  console.log('');
  console.log(`  ${fmt.dim('The proxy will no longer auto-start.')}`);
  console.log(`  ${fmt.dim('You can still run it manually:')} ${fmt.cyan('npx antigravity-touch')}`);
  console.log('');
}

async function showServiceStatus() {
  printBanner();
  console.log(`  ${fmt.bold('📊 Service Status')}`);
  console.log('');

  const svc = getServicePaths();

  if (svc.type === 'systemd') {
    if (!fs.existsSync(svc.file)) {
      console.log(`  ${fmt.warn('Service not installed.')}`);
      console.log(`  ${fmt.dim('Install with:')} ${fmt.cyan('npx antigravity-touch --install')}`);
      console.log('');
      process.exit(0);
    }
    try {
      const status = execSync(`systemctl --user status ${SERVICE_NAME}.service 2>&1 || true`, { encoding: 'utf-8' });
      // Color the status output
      const lines = status.split('\n');
      for (const line of lines) {
        if (line.includes('Active: active')) {
          console.log(`  ${fmt.green('●')} ${line.trim()}`);
        } else if (line.includes('Active: inactive') || line.includes('Active: failed')) {
          console.log(`  ${fmt.red('●')} ${line.trim()}`);
        } else if (line.trim()) {
          console.log(`  ${fmt.dim(line.trim())}`);
        }
      }
    } catch (e) {
      console.log(`  ${fmt.error('Could not get status: ' + e.message)}`);
    }

  } else if (svc.type === 'launchd') {
    if (!fs.existsSync(svc.file)) {
      console.log(`  ${fmt.warn('Service not installed.')}`);
      console.log(`  ${fmt.dim('Install with:')} ${fmt.cyan('npx antigravity-touch --install')}`);
      console.log('');
      process.exit(0);
    }
    try {
      const result = execSync('launchctl list | grep antigravity || echo "Not running"', { encoding: 'utf-8' });
      if (result.includes('Not running')) {
        console.log(`  ${fmt.red('●')} Service is installed but not running`);
      } else {
        console.log(`  ${fmt.green('●')} Service is running`);
        console.log(`  ${fmt.dim(result.trim())}`);
      }
    } catch (e) {
      console.log(`  ${fmt.error('Could not get status: ' + e.message)}`);
    }

  } else if (svc.type === 'taskscheduler') {
    try {
      const result = execSync(`schtasks /Query /TN "${svc.taskName}" 2>&1`, { encoding: 'utf-8' });
      if (result.includes('Running')) {
        console.log(`  ${fmt.green('●')} Task is running`);
      } else {
        console.log(`  ${fmt.yellow('●')} Task is registered but not currently running`);
      }
      console.log(`  ${fmt.dim(result.trim())}`);
    } catch {
      console.log(`  ${fmt.warn('Service not installed.')}`);
      console.log(`  ${fmt.dim('Install with:')} ${fmt.cyan('npx antigravity-touch --install')}`);
    }
  } else {
    console.log(`  ${fmt.error(`Unsupported platform: ${process.platform}`)}`);
  }

  console.log('');
}

// ── Main ────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs();

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (args.install) {
    await installService();
    process.exit(0);
  }

  if (args.uninstall) {
    await uninstallService();
    process.exit(0);
  }

  if (args.status) {
    await showServiceStatus();
    process.exit(0);
  }

  if (args.reset) {
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        fs.unlinkSync(CONFIG_FILE);
        console.log(fmt.success('Configuration reset. Run again to reconfigure.'));
      } else {
        console.log(fmt.info('No saved configuration found.'));
      }
    } catch {}
    process.exit(0);
  }

  if (args.noTunnel) {
    printBanner();
    startServer({
      email: null,
      port: args.port || '5555',
      authtoken: null,
      noTunnel: true,
      host: args.host,
    });
    return;
  }

  if (args.nonInteractive || (args.email && (args.authtoken || process.env.NGROK_AUTHTOKEN))) {
    printBanner();
    const authtoken = args.authtoken || process.env.NGROK_AUTHTOKEN;
    const port = args.port || '5555';

    console.log(`  ${fmt.dim('Port:')}     ${fmt.cyan(port)}`);
    console.log(`  ${fmt.dim('Email:')}    ${fmt.cyan(args.email)}`);
    console.log(`  ${fmt.dim('Tunnel:')}   ${fmt.green('ngrok + Google OAuth')}`);
    console.log('');

    startServer({
      email: args.email,
      port,
      authtoken,
      noTunnel: false,
      host: args.host,
    });
    return;
  }

  try {
    const settings = await runWizard(args);
    startServer({
      email: settings.email,
      port: settings.port,
      authtoken: settings.authtoken,
      noTunnel: false,
      host: args.host,
    });
  } catch (err) {
    if (err.message === 'readline was closed') {
      process.exit(0);
    }
    console.error(`\n  ${fmt.error(err.message)}`);
    process.exit(1);
  }
}

main();
