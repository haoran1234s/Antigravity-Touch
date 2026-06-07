<div align="center">

# 🚀 Antigravity Touch

**Chat with the Antigravity AI Agent from your phone, tablet, or any browser**

Control your [Antigravity IDE](https://github.com/anthropics/antigravity) remotely — ask questions, run commands, edit files, and approve actions — all from a beautiful mobile-friendly chat interface with a secure tunnel to your machine.

[![npm version](https://img.shields.io/npm/v/antigravity-touch?color=CB3837&logo=npm)](https://www.npmjs.com/package/antigravity-touch)
[![npm downloads](https://img.shields.io/npm/dm/antigravity-touch?color=blue&logo=npm)](https://www.npmjs.com/package/antigravity-touch)
[![CI](https://github.com/Belal33/antigravity-touch/actions/workflows/ci.yml/badge.svg)](https://github.com/Belal33/antigravity-touch/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/Node.js-≥18-339933?logo=node.js)](https://nodejs.org)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/Belal33/antigravity-touch?style=social)](https://github.com/Belal33/antigravity-touch)

<img src="https://raw.githubusercontent.com/Belal33/antigravity-touch/main/public/demo.gif" alt="Antigravity Touch Demo" width="300" />

</div>

---

## 🤔 What Is This?

Antigravity is an AI coding agent that lives inside your IDE. Normally, you can only interact with it from the IDE window on your computer.

**Antigravity Touch** lets you chat with that same agent from **any device** — your phone, your tablet, another computer — through a web browser. It creates a secure link (tunnel) so you can:

- 💬 **Send messages** to the AI agent from anywhere
- 👀 **See everything** the agent does in real-time — file edits, terminal commands, search results
- ✅ **Approve or reject** actions that need your permission (like running commands or modifying files)
- 📁 **Browse artifacts** the agent creates during your conversation
- 🪟 **Switch between IDE windows** if you have multiple open
- 🔒 **Stay secure** — only your Google account can access the tunnel

---

## 📦 Installation

### Option 1: Run directly with npx (no install needed)

```bash
npx antigravity-touch@latest
```

This downloads and runs the latest version every time — no global install required.

### Option 2: Install globally via npm

```bash
npm install -g antigravity-touch@latest
```

Then run it anytime with:

```bash
antigravity-touch
```

> 💡 **Which should I use?** Use `npx` if you want to always run the latest version with zero setup. Use `npm install -g` if you prefer a persistent global command or plan to use the `--install` service feature.

---

## ⚡ Quick Start

### What You Need

1. **Node.js 18 or newer** — [Download here](https://nodejs.org) if you don't have it
2. **Antigravity IDE** installed (it doesn't need to be running — the proxy will start it automatically)

### Run the Proxy

Open your terminal and run:

```bash
npx antigravity-touch@latest
```

That's it! The proxy will **automatically detect and connect to Antigravity** (or start it if it's not running). A setup wizard will walk you through the tunnel configuration:

```
  ╔═══════════════════════════════════════════════════════╗
  ║  🚀 Antigravity Touch                          ║
  ║  Secure tunnel to your IDE with Google OAuth          ║
  ╚═══════════════════════════════════════════════════════╝

  ℹ Welcome! Let's set up your Antigravity Touch.
  
  [1/3] ngrok Authentication
  [2/3] Access Control (your Google email)
  [3/3] Server Configuration (port)
```

Once complete, you'll get a **public URL** that you can open on any device:

```
  ╔═══════════════════════════════════════════════════════╗
  ║   🌐 Your app is live!                                ║
  ║                                                       ║
  ║   https://abc123.ngrok-free.app                       ║
  ║                                                       ║
  ║   🔒 Google OAuth → you@gmail.com                     ║
  ╚═══════════════════════════════════════════════════════╝
```

Open that URL on your phone or any browser — sign in with your Google account, and you're chatting with your AI agent! 🎉

---

## Windows one-click startup / remote access

When running from this repository on Windows, use the bundled scripts:

```powershell
# Public mode: phone can access even outside the same Wi-Fi (ngrok + Google OAuth)
.\start-remote.cmd

# LAN mode: phone and computer are on the same Wi-Fi
.\start-local.cmd
```

For the first run, create a local config file:

```powershell
copy .env.example .env.local
```

Then fill `NGROK_AUTHTOKEN` and `ALLOWED_EMAIL` in `.env.local`. If you have an ngrok reserved domain, set `NGROK_DOMAIN` for a stable URL.

When switching computers: clone the repo, copy `.env.example` to `.env.local`, fill the local values, then run `.\start-remote.cmd`. See [docs/REMOTE_ACCESS.md](docs/REMOTE_ACCESS.md) for the full Chinese guide.

---

## 🔧 Setup Details

### ngrok Account (Free)

The proxy uses [ngrok](https://ngrok.com) to create a secure tunnel from the internet to your local machine. You need a free ngrok account:

1. Run the proxy — it will **automatically open** the ngrok dashboard in your browser
2. Sign up or log in (it's free)
3. Click the **copy** button next to your authtoken
4. The CLI **detects it from your clipboard** automatically ✨

> 💡 Your token is saved locally so you only need to do this once.
>
> If clipboard detection isn't available (e.g., headless server), you can paste the token manually or pass it via `--authtoken` or the `NGROK_AUTHTOKEN` environment variable.

### Google OAuth Protection

Your tunnel is protected by Google OAuth — only the email address you specify during setup can access it. Nobody else can see or use your proxy, even if they have the URL.

---

## 📱 Usage Examples

### Run with the Interactive Wizard (Recommended)

```bash
npx antigravity-touch@latest
```

The wizard remembers your settings, so next time it will just ask you to confirm and start.

### Run with Command-Line Options (Skip the Wizard)

```bash
npx antigravity-touch@latest --email you@gmail.com
```

### Run Locally (No Tunnel)

If you want to access the proxy on your local network without ngrok:

```bash
npx antigravity-touch@latest --no-tunnel
```

This binds the server to `0.0.0.0` and prints a LAN/mobile URL such as
`http://192.168.1.23:5555`. Open that URL from your phone while it is on the
same Wi-Fi. If Windows Firewall prompts, allow Node.js on Private networks.

To force desktop-only access, bind explicitly to localhost:

```bash
npx antigravity-touch@latest --no-tunnel --host 127.0.0.1
```

### Use a Different Port

```bash
npx antigravity-touch@latest --port 8080
```

### Run Always-On (Recommended)

Want the proxy to be **always available** whenever your computer is on? Install it as a background service:

```bash
# First run the wizard once to save your settings
npx antigravity-touch@latest

# Then install the auto-start service
npx antigravity-touch@latest --install
```

This works automatically on:
- 🐧 **Linux** — creates a `systemd` user service
- 🍎 **macOS** — creates a `launchd` agent  
- 🪟 **Windows** — creates a Task Scheduler task

The service **auto-starts on login** and **auto-restarts on crashes**. Your ngrok URL stays active as long as your computer is on.

```bash
# Check if the service is running
npx antigravity-touch@latest --status

# Remove the auto-start service
npx antigravity-touch@latest --uninstall
```

### Reset Your Saved Settings

```bash
npx antigravity-touch@latest --reset
```

### All Options

| Option | Description |
|--------|-------------|
| `--email <email>` | Your Google email (skips the wizard question) |
| `--port <number>` | Server port (default: `5555`) |
| `--host <address>` | Bind address (default: `127.0.0.1`, or `0.0.0.0` with `--no-tunnel`) |
| `--authtoken <token>` | ngrok auth token (skips the wizard question) |
| `--no-tunnel` | Run locally without creating a public URL |
| `--install` | Install as auto-start background service (survives reboot) |
| `--uninstall` | Remove the auto-start service |
| `--status` | Check if the auto-start service is running |
| `--reset` | Clear saved settings and start fresh |
| `--help` | Show all available options |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `NGROK_AUTHTOKEN` | Your ngrok auth token (alternative to passing `--authtoken`) |
| `CDP_PORT` | Antigravity IDE debugging port (default: `9223`) |
| `PROXY_PAGE` | Which IDE window to connect to (default: `0`, the first one) |

---

## ✨ Features

### 💬 Real-Time Chat
Send messages and see the AI agent's responses stream in real-time — just like chatting in the IDE, but from any device.

### 🔧 Live Tool Execution
Watch the agent work in real-time:
- **Terminal commands** — see the command, its output, and exit code
- **File edits** — see what files are being created or modified with additions/deletions
- **Search results** — see what the agent finds in your codebase
- **MCP tools** — see any external tool calls and their results

### ✅ Remote Approve / Reject
When the agent wants to do something that needs your permission (like running a command or modifying a file), you'll see an approve/reject dialog right in the chat — tap to allow or deny.

### 📁 Artifact Browser
Browse files the agent creates during your conversation — documentation, code, reports, and more.

### 🪟 Multi-Window Support
If you have multiple Antigravity IDE windows open, you can switch between them from the proxy UI.

### 💬 Conversation Management
Switch between conversations, start new chats, and load conversation history — all from the web interface.

### 🎨 Beautiful Dark Theme
A premium glassmorphism dark UI with:
- Smooth animated gradients (indigo → purple → pink)
- Tool call cards with status-based colors and animations
- Thinking indicators, typing animations, and micro-interactions
- Optimized for both desktop and mobile screens

---

## ❓ Troubleshooting

### "Cannot connect to Antigravity IDE"

The proxy automatically starts Antigravity if it's not running. If it still can't connect:

- Make sure Antigravity IDE is **installed** on your system
- On Linux, check that `/usr/share/antigravity/antigravity` exists
- On macOS, check that Antigravity is in your Applications folder
- On Windows, check the standard install location or set the `ANTIGRAVITY_BINARY` env var
- You can also start Antigravity manually with: `antigravity --remote-debugging-port=9223`

### "ngrok auth token is invalid"

Your token may have expired. Get a new one from [dashboard.ngrok.com/get-started/your-authtoken](https://dashboard.ngrok.com/get-started/your-authtoken) and run:

```bash
npx antigravity-touch@latest --reset
```

### The tunnel disconnects

The proxy automatically reconnects when the tunnel drops (e.g., if your network temporarily goes offline). You'll see a message in the terminal when it reconnects. Just wait — it handles this for you.

### Port 5555 is already in use

Use a different port:

```bash
npx antigravity-touch@latest --port 8080
```

---

## 🏗️ How It Works (Technical Overview)

```
┌─────────────────┐       ┌──────────────────────┐       ┌─────────────────┐
│                 │       │                      │       │                 │
│  Your Phone /   │◄─SSE──│  Antigravity Touch   │◄─CDP──│  Antigravity    │
│  Any Browser    │──REST─│  Proxy (Next.js)     │──────│  IDE (Electron) │
│                 │       │                      │       │                 │
└─────────────────┘       └──────────────────────┘       └─────────────────┘
    Any Device             Your Computer :5555              Port 9223
        │                        │
        └──── ngrok tunnel ──────┘
              (encrypted)
```

1. **You run `npx antigravity-touch`** → the proxy auto-starts Antigravity if needed
2. **You type a message** in the web chat → it goes to the proxy server on your computer
3. **The proxy types it into the IDE** using Chrome DevTools Protocol (CDP)
4. **The proxy watches the IDE** by reading the agent panel's state every 500ms
5. **Changes are streamed back** to your browser in real-time via Server-Sent Events (SSE)
6. **ngrok tunnel** makes it all accessible from any device through an encrypted public URL

---

## 🛠️ For Developers

<details>
<summary>Click to expand developer documentation</summary>

### Running from Source

```bash
git clone <repo-url>
cd antigravity-touch
npm install
npm run dev
```

### API Reference

All endpoints are versioned under `/api/v1/`.

#### Health & Status

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/health` | Connection status |

#### Chat

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/chat` | Send message (blocking — waits for full response) |
| `POST` | `/api/v1/chat/stream` | Send message (SSE streaming — real-time events) |
| `GET` | `/api/v1/chat/state` | Current agent panel state snapshot |
| `GET` | `/api/v1/chat/history` | Full conversation history |
| `POST` | `/api/v1/chat/new` | Start a new chat session |
| `POST` | `/api/v1/chat/approve` | Approve a HITL action |
| `POST` | `/api/v1/chat/reject` | Reject a HITL action |
| `POST` | `/api/v1/chat/action` | Click any footer button by `toolId` + `buttonText` |

#### Conversations

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/conversations` | List all conversations with metadata |
| `POST` | `/api/v1/conversations/select` | Set active conversation |
| `GET` | `/api/v1/conversations/active` | Get current active conversation |

#### Artifacts

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/artifacts` | List all artifact directories |
| `GET` | `/api/v1/artifacts/:convId` | List files in a conversation |
| `GET` | `/api/v1/artifacts/:convId/:filename` | Serve a specific artifact file |

#### Windows

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/windows` | List available IDE windows |
| `POST` | `/api/v1/windows/select` | Switch to a different window |

#### Debug

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/debug/dom` | Raw HTML dump of the agent panel |

### SSE Event Types

When using `/api/v1/chat/stream`:

```jsonc
// Thinking block
{"type":"thinking","time":"Thought for 5s"}

// Tool call
{"type":"tool_call","index":0,"status":"Running command","command":"ls -la","isNew":true}

// HITL approval required
{"type":"hitl","action":"approval_required","tool":{...}}

// Streaming response (HTML)
{"type":"response","content":"<p>Here are the files...</p>","partial":true}

// Completion
{"type":"done","finalResponse":"<p>Done!</p>","isHTML":true}
```

### Project Structure

```
antigravity-touch/
├── app/                          # Next.js App Router
│   ├── layout.tsx                # Root layout
│   ├── page.tsx                  # Main chat page
│   ├── globals.css               # Design system
│   └── api/v1/                   # Versioned API routes
│       ├── health/route.ts
│       ├── chat/                 # Chat endpoints
│       ├── conversations/        # Conversation management
│       ├── artifacts/            # Artifact browsing
│       ├── windows/              # Window management
│       └── debug/                # Debug tools
├── components/                   # React UI components
├── hooks/                        # React hooks (chat, conversations, artifacts)
├── lib/                          # Server-side services
│   ├── cdp/                      # Chrome DevTools Protocol connection
│   ├── scraper/                  # Agent state DOM scraper
│   ├── actions/                  # IDE automation (send message, approve, etc.)
│   └── sse/                      # State diffing for real-time events
├── bin/cli.js                    # CLI entry point (npx command)
└── package.json
```

### Key Design Decisions

| Decision | Why |
|----------|-----|
| **Module singleton** for shared state | Next.js API routes share the Node.js process — persists across requests |
| **Lazy CDP init** | Connection established on first request, not at import — avoids crashes when IDE isn't running |
| **4-signal completion detection** | Using a single signal (e.g., spinner) is unreliable — combining spinner, stop button, pending tools, and step indicators prevents premature stream termination |
| **HTML response preservation** | `innerHTML` extraction preserves rich formatting (code blocks, lists, links) |
| **Standalone build** | The npm package ships pre-built — no build step needed when running via `npx` |

</details>

---

<div align="center">

**Built with [Next.js](https://nextjs.org) · [Puppeteer](https://pptr.dev) · [ngrok](https://ngrok.com) · [TypeScript](https://typescriptlang.org)**

MIT License · Made with ❤️

</div>
