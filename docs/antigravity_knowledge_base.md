# Antigravity IDE 鈥?Technical Knowledge Base

> Compiled during remote access investigation 鈥?March 6, 2026  
> Antigravity version: **1.107.0** (installed via `.deb` package)

---

## Architecture

Antigravity is a **heavily modified VS Code fork** built on Electron, launched November 18, 2025 alongside Gemini 3. It takes an "agent-first" approach to software development.

- **Binary:** `/usr/bin/antigravity` (shell script wrapper)
- **Electron app:** `/usr/share/antigravity/antigravity`
- **CLI entry:** `/usr/share/antigravity/resources/app/out/cli.js` (run via `ELECTRON_RUN_AS_NODE=1`)
- **Package ID:** `antigravity` (amd64 `.deb`)
- **Description:** "Experience liftoff"

### Key Directories

```
/usr/share/antigravity/
鈹溾攢鈹€ antigravity                          # Electron binary
鈹溾攢鈹€ bin/
鈹?  鈹溾攢鈹€ antigravity                      # Shell script (CLI wrapper)
鈹?  鈹斺攢鈹€ antigravity-tunnel               # Tunnel/server binary (NOT shipped by default)
鈹斺攢鈹€ resources/app/
    鈹溾攢鈹€ out/cli.js                       # CLI logic
    鈹斺攢鈹€ extensions/
        鈹斺攢鈹€ antigravity/                 # Built-in agent extension
            鈹溾攢鈹€ package.json             # Extension manifest (google.antigravity)
            鈹溾攢鈹€ bin/
            鈹?  鈹溾攢鈹€ fd                   # File discovery tool
            鈹?  鈹溾攢鈹€ language_server_linux_x64  # Language server binary
            鈹?  鈹斺攢鈹€ sandbox-wrapper.sh
            鈹溾攢鈹€ dist/
            鈹?  鈹斺攢鈹€ languageServer/
            鈹?      鈹斺攢鈹€ cert.pem
            鈹溾攢鈹€ out/                     # Compiled extension code
            鈹溾攢鈹€ assets/
            鈹溾攢鈹€ customEditor/
            鈹斺攢鈹€ schemas/
                鈹斺攢鈹€ mcp_config.schema.json  # MCP configuration schema
```

---

## CLI Commands

### Standard Options
```bash
antigravity [paths...]              # Open files/folders
antigravity -d <file1> <file2>      # Diff two files
antigravity -m <p1> <p2> <base> <r> # Three-way merge
antigravity -g <file:line:col>      # Go to specific location
antigravity -n                      # Force new window
antigravity -r                      # Reuse existing window
antigravity --add-mcp <json>        # Add MCP server to profile
```

### Subcommands

#### `antigravity chat [prompt]`
Opens the agent chat panel with the given prompt.

| Flag | Description |
|---|---|
| `-m --mode <mode>` | `ask`, `edit`, `agent` (default), or custom mode ID |
| `-a --add-file <path>` | Add files as context (repeatable) |
| `--maximize` | Maximize the chat view |
| `-r --reuse-window` | Use last active window |
| `-n --new-window` | Open empty window for chat |
| `--profile <name>` | Use specific profile |
| Stdin support | `cat file.py \| antigravity chat "explain this" -` |

> 鈿狅笍 **Requires GUI** 鈥?opens the desktop app, does not run headlessly.

#### `antigravity serve-web`
Serves a web-based editor UI in browsers.

> 鈿狅笍 **Serves vanilla VS Code Server**, not Antigravity. The agent extension (`google.antigravity`) is rejected by the server.

#### `antigravity tunnel`
Creates a secure remote tunnel.

> 鈿狅笍 **Requires `antigravity-tunnel` binary** which is not shipped in the `.deb` package. Can be substituted with the VS Code CLI binary, but will only tunnel vanilla VS Code.

---

## Extension Details

The built-in agent extension (`google.antigravity v0.2.0`) includes:

### Agent Commands
- `antigravity.prioritized.chat.open` 鈥?Open agent chat
- `antigravity.prioritized.command.open` 鈥?Inline command (Ctrl+I / Cmd+I)
- `antigravity.terminalCommand.run` 鈥?Run terminal command (Ctrl+Enter)
- `antigravity.terminalCommand.accept` 鈥?Accept suggestion (Alt+Enter)
- `antigravity.terminalCommand.reject` 鈥?Reject suggestion (Ctrl+Backspace)
- `antigravity.generateCommitMessage` 鈥?AI commit message
- `antigravity.openBrowser` 鈥?Built-in browser
- `antigravity.startDemoMode` / `endDemoMode` 鈥?Demo mode (Beta)
- `antigravity.openConversationPicker` 鈥?Conversation picker (Ctrl+Shift+A)

### Agent Step Controls
- `antigravity.agent.acceptAgentStep` 鈥?Accept agent step (Alt+Enter)
- `antigravity.agent.rejectAgentStep` 鈥?Reject agent step (Alt+Shift+Backspace)
- `antigravity.prioritized.agentFocusNextHunk` / `PreviousHunk` 鈥?Navigate diffs (Alt+J / Alt+K)
- `antigravity.prioritized.agentAcceptFocusedHunk` / `RejectFocusedHunk` 鈥?Accept/reject focused diff

### Import Commands
Supports migrating settings and extensions from:
- VS Code
- Cursor
- Windsurf
- Cider (Google internal)

### Configuration Properties
| Setting | Default | Description |
|---|---|---|
| `antigravity.marketplaceExtensionGalleryServiceURL` | `https://open-vsx.org/vscode/gallery` | Extension marketplace URL |
| `antigravity.marketplaceGalleryItemURL` | `https://open-vsx.org/vscode/item` | Extension page URL |
| `antigravity.searchMaxWorkspaceFileCount` | `5000` | Max files for workspace indexing |
| `antigravity.persistentLanguageServer` | `false` | Keep language server alive after editor close |

### Key Bindings
| Shortcut | Action |
|---|---|
| `Ctrl+I` (editor) | Open inline command |
| `Ctrl+I` (terminal) | Open terminal command |
| `Ctrl+Enter` | Run/accept terminal suggestion |
| `Alt+Enter` | Accept suggestion/agent step |
| `Ctrl+Backspace` | Reject suggestion |
| `Alt+J` / `Alt+K` | Navigate agent edit hunks |
| `Alt+\` | Trigger inline suggestion |
| `Tab` | Accept autocomplete |
| `Escape` | Dismiss suggestions |
| `Ctrl+Shift+A` | Open conversation picker |

### Marketplace
Antigravity uses **Open VSX** by default (not the official VS Code Marketplace). This can be changed in settings.

### MCP Support
Antigravity supports **Model Context Protocol** servers:
- CLI: `antigravity --add-mcp '{"name":"server-name","command":...}'`
- Config schema: `mcp_config.json` validated by built-in JSON schema
- Language support for `jsonc` in MCP config files

---

## Limitations Discovered

| Limitation | Detail |
|---|---|
| **No headless agent mode** | `antigravity chat` requires the desktop GUI 鈥?no terminal-only agent |
| **`serve-web` serves vanilla VS Code** | The command delegates to VS Code CLI which downloads a standard server |
| **Agent extension rejected by VS Code Server** | `Marked extension as removed google.antigravity-0.2.0` 鈥?cannot copy into `.vscode-server` |
| **`antigravity-tunnel` not shipped** | The binary at `/usr/share/antigravity/bin/antigravity-tunnel` is missing from the `.deb` package |
| **Tight desktop coupling** | The agent depends on Electron APIs and Antigravity-specific VS Code modifications not present in the server |

---

## Workarounds & Notes

1. **The VS Code CLI binary can substitute for `antigravity-tunnel`** 鈥?fixes `serve-web` and `tunnel` commands, but they serve vanilla VS Code
2. **VS Code Server extensions get stored at** `~/.vscode-server/extensions/` 鈥?separate from desktop extensions
3. **The server auto-installs `google.geminicodeassist`** 鈥?Gemini Code Assist works in the web version but is NOT the same as the Antigravity agent
4. **`loginctl enable-linger $USER`** may be needed for user-level systemd services to persist after logout
5. **SSE Stream Polling:** When migrating from Node.js `http.createServer` + `setInterval` to Next.js `ReadableStream`, use `setInterval` for polling instead of recursive `async` functions. `setInterval` survives per-tick errors; recursive `await` propagates errors and kills the stream. Also set `ctx.lastActionTimestamp` after `sendMessage` to activate the 15-second done-detection guard.

---

## CDP Process Management (Learned March 2026)

### Starting CDP
- **Must use the direct binary**, not the CLI wrapper
- **Process reuse is critical**: If ANY Antigravity window exists, new launched instances merge into the existing Electron process and immediately shut down their CDP server. Always kill all existing instances before a fresh CDP start.
- Launch command: `<binary> --remote-debugging-port=9223 /path/to/project`
- Verify with: `curl -s http://localhost:9223/json`

### Cross-Platform Binary Paths
| OS | Default Binary Path |
|---|---|
| **Linux** | `/usr/share/antigravity/antigravity` |
| **macOS** | `/Applications/Antigravity.app/Contents/MacOS/Antigravity` |
| **Windows** | `%LOCALAPPDATA%\Programs\Antigravity\Antigravity.exe` or `C:\Program Files\Google\Antigravity\Antigravity.exe` |
| **WSL** | Auto-scanned via `/mnt/c/Users/*/AppData/Local/Programs/Antigravity/Antigravity.exe` and `/mnt/c/Program Files/...` |

All can be overridden with the `ANTIGRAVITY_BINARY` environment variable.

### WSL Detection (Learned March 2026)
- **`process.platform` returns `'linux'` in WSL**, not `'win32'` 鈥?the code must explicitly detect WSL.
- **Detection method:** Read `/proc/version` and check for `/microsoft|wsl/i` regex match.
- **Binary resolution in WSL:** The Windows filesystem is mounted at `/mnt/c/`. Scan `/mnt/c/Users/` (skipping system dirs like `Public`, `Default`) to find user-installed binaries.
- **Process management in WSL:** Use `taskkill.exe` (with `.exe` suffix) instead of `killall`/`taskkill` to invoke the Windows process killer from WSL.

### Cross-Platform Process Kill
| OS | Command |
|---|---|
| **Linux/macOS** | `killall antigravity 2>/dev/null \|\| true` |
| **Windows** | `taskkill /F /IM Antigravity.exe 2>nul \|\| exit 0` |

### Spawn Differences
- **Linux/macOS**: Use `detached: true` to prevent the child from blocking Node
- **Windows**: Use `shell: true` for `.exe` resolution; `detached` is not needed

### Opening New Windows
- If CDP is already active (an Antigravity instance is running), launching the binary with just a directory path (`/usr/share/antigravity/antigravity /path/to/project`) opens a new window in the same Electron process 鈥?CDP remains active and discovers the new window.
- After opening, re-discover workbenches via the `/json` endpoint to pick up the new page.

### Closing Windows
- Individual windows can be closed via the CDP `/json/close/{targetId}` endpoint.
- The `targetId` comes from the `/json` endpoint's page listing.
- After closing, re-discover workbenches and reset the active window index if needed.

### CDP Health Checking
- Poll `http://localhost:{port}/json` 鈥?if it returns a valid JSON array, CDP is active.
- Filter for `workbench.html` pages (excluding `jetski`) to get the actual IDE windows.

### Recent Projects / Workspace Storage
- Antigravity stores workspace history in `<config>/Antigravity/User/workspaceStorage/`
- Each subdirectory contains `workspace.json` with `{"folder": "file:///absolute/path"}`
- Directory **mtime** indicates when the workspace was last active
- Config root by OS: Linux 鈫?`~/.config`, macOS 鈫?`~/Library/Application Support`, Windows 鈫?`%APPDATA%`
- Filter out `vscode-remote://` entries (remote SSH) and playground dirs
- Use `path.resolve()` (not `path.join()`) when the user provides directory paths 鈥?`join(cwd, '/abs/path')` produces wrong results

---

## Turbopack / Next.js Standalone Build 鈥?Dead Code Elimination (Learned March 2026)

### The Problem
Next.js's Turbopack (and Webpack) evaluates `process.platform` **at build time** during standalone builds. Any `if (process.platform === 'win32')` branches get statically resolved based on the **build machine's OS**, not the runtime OS. A standalone build done on Linux will strip the `win32` and `darwin` branches entirely, causing cross-platform failures.

### Affected Patterns
```typescript
// 鉂?BROKEN 鈥?Turbopack eliminates non-matching branches at build time
if (process.platform === 'win32') { /* eliminated on Linux builds */ }
const IS_WIN = process.platform === 'win32'; // always false on Linux builds
```

### The Fix 鈥?String Concatenation
Use string concatenation to access `process.platform` through a dynamic property key that the optimizer cannot statically resolve:
```typescript
// 鉁?SAFE 鈥?forces runtime resolution, optimizer can't fold this
const getRuntimePlatform = (): string => {
  const p = 'plat';
  const f = 'form';
  return (process as any)[p + f] || 'unknown';
};
```

For platform-specific data like config paths, use **resolver maps** with the dynamic key:
```typescript
// 鉁?SAFE 鈥?all branches survive because the key is runtime-resolved
const resolvers: Record<string, () => string> = {
  win32:  () => windowsPath(),
  darwin: () => macPath(),
  linux:  () => linuxPath(),
};
const resolve = resolvers[getRuntimePlatform()] || resolvers.linux;
```

For platform-specific pattern matching (like stripping `/` from Windows `file://` URIs), prefer **content-based detection** instead of platform checks:
```typescript
// 鉁?SAFE 鈥?detects Windows paths by their content, not by process.platform
if (/^\/[A-Za-z]:/.test(fsPath)) fsPath = fsPath.substring(1);
```

### Files Using This Pattern
| File | Technique |
|---|---|
| `lib/cdp/process-manager.ts` | `getPlatform()` via string concatenation (original fix) |
| `lib/cdp/recent-projects.ts` | `getRuntimePlatform()` + resolver map + regex path detection |
| `lib/init.ts` | IIFE with string concatenation for `IS_WIN` |

---

## Windows `schtasks` Path Quoting (Learned March 2026)

### The Problem
When using `schtasks /Create ... /TR "..."` on Windows, paths containing spaces (e.g. `C:\Program Files\nodejs\node.exe`) must NOT use escaped double-quotes (`\"...\"`). The `schtasks` command parser does not handle nested escaped double-quotes 鈥?it splits on the first space after the opening `"` and treats the remainder as a separate, invalid argument.

**Error message:**
```
ERROR: Invalid argument/option - 'Files\nodejs\node.exe ...'
```

### The Fix 鈥?VBScript Hidden Launcher
Running `node.exe` directly from `schtasks` opens a visible console window. The solution is a **VBScript wrapper** that launches Node invisibly:

1. Write a `.vbs` file to `~/.antigravity-touch/launcher.vbs`:
```vbs
CreateObject("WScript.Shell").Run """C:\Program Files\nodejs\node.exe"" ""path\to\cli.js"" --args", 0, False
```
   - The `0` parameter = **hidden window**
   - `False` = don't wait for completion

2. Point `schtasks /TR` at `wscript.exe` running the VBS file:
```
schtasks /Create /F /SC ONLOGON /TN "AntigravityTouch" /TR "wscript.exe 'path\to\launcher.vbs'" /RL HIGHEST
```

### Previous Attempt (Broken)
Escaped double-quotes (`\"path\"`) in `/TR` don't work 鈥?`schtasks` parser splits on spaces and treats the rest as invalid arguments:
```
ERROR: Invalid argument/option - 'Files\nodejs\node.exe ...'
```

### Affected File
| File | Location |
|---|---|
| `bin/cli.js` | `buildServiceConfig()` 鈫?`taskscheduler` branch |

---

## Agent DOM Scraping & Permission Dialogs (Learned April 2026)

### Permission Dialog DOM Structure
The Antigravity agent panel handles permission prompts (e.g., "Allow Once", "Deny", "Allow This Conversation") very differently from standard tool execution cards:
- **Location**: Unlike standard tool cards that are grouped in `.flex.flex-col.space-y-2 > .flex.flex-row:not(.my-2)` containers, permission dialogs render as independent flex containers anywhere within the conversation turn (`#conversation .mx-auto > div`).
- **Nesting**: The buttons are deeply nested containing text like "Allow Once", typically matching `DIV.ml-auto.flex.flex-row.gap-x-2.gap-y-2` as their immediate container.
- **Scraping Strategy**: Instead of targeting specific predefined row classes, a **broad scan** approach is required. The scraper must search the current scope (or full panel) for any `<button>` matching the permission text regex `/^(allow|deny|allow once|allow this conversation|block)$/i`, then trace up `parentElement` chains to cluster them by a shared container, then assign them a `data-proxy-tool-id`. 

### Button Click Fallbacks
When invoking clicks via CDP (`page.evaluate`), scoping strictly to a `[data-proxy-tool-id]` can fail if the permission bar renders as a sibling to the active tool call instead of inside it. The robust approach is a multi-tiered search:
1. Search inside the element tagged with `data-proxy-tool-id`.
2. Fallback to searching the **next sibling** and **previous sibling**, as permission warnings often insert themselves adjacently.
3. Final fallback to scanning the entire panel, matching on the exact button text (case-insensitive).

### Next.js HMR vs Cached Production Bundles
When testing server-side scraping logic updates (e.g., Route Handlers or `lib/` dependencies):
- Running via `npm run dev` supports Hot Module Replacement (HMR) for most `lib/` files.
- **However**, if the dev server was started via a globally installed CLI bin (e.g., `antigravity-touch`), it runs the **compiled production `.next` cache**. In this state, touching source files will not apply changes. Diagnostic scripts running direct `puppeteer` evaluations are necessary to prove the logic works, after which the proxy must be fully rebuilt (`npm run build`) and restarted to serve the new logic.
