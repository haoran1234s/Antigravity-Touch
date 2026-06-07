# Contributing to Antigravity Touch

Thanks for your interest in contributing! 馃帀 This project welcomes contributions of all kinds 鈥?bug reports, feature ideas, documentation improvements, and code.

## Getting Started

### Prerequisites

- **Node.js 18+** 鈥?[Download here](https://nodejs.org)
- **Antigravity IDE** installed on your system
- **Git**

### Setup

```bash
# Clone the repo
git clone https://github.com/haoran1234s/Antigravity-Touch.git
cd antigravity-touch

# Install dependencies
npm install

# Start the dev server
npm run dev
```

The dev server runs at `http://localhost:5555`.

### Useful Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Next.js dev server on port 5555 |
| `npm run lint` | Run ESLint |
| `npm run type-check` | Run TypeScript type checking |
| `npm run build` | Production build |

## How to Contribute

### Reporting Bugs

1. Check if the issue already exists in [GitHub Issues](https://github.com/haoran1234s/Antigravity-Touch/issues)
2. If not, open a new issue using the **Bug Report** template
3. Include as much detail as possible 鈥?OS, Node.js version, error messages, and steps to reproduce

### Suggesting Features

1. Open a new issue using the **Feature Request** template
2. Describe the use case and why it would be valuable

### Submitting Code

1. **Fork** the repository
2. Create a **feature branch** from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```
3. Make your changes
4. Ensure your code passes linting and type checks:
   ```bash
   npm run lint
   npm run type-check
   ```
5. Commit with a clear message:
   ```bash
   git commit -m "feat: add your feature description"
   ```
6. **Push** to your fork and open a **Pull Request**

### Commit Convention

We follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` 鈥?New feature
- `fix:` 鈥?Bug fix
- `docs:` 鈥?Documentation changes
- `refactor:` 鈥?Code refactoring
- `chore:` 鈥?Maintenance tasks

## Project Structure

```
antigravity-touch/
鈹溾攢鈹€ app/                    # Next.js App Router (pages + API routes)
鈹?  鈹斺攢鈹€ api/v1/             # Versioned API endpoints
鈹溾攢鈹€ components/             # React UI components
鈹溾攢鈹€ hooks/                  # React hooks
鈹溾攢鈹€ lib/                    # Server-side services
鈹?  鈹溾攢鈹€ cdp/                # Chrome DevTools Protocol
鈹?  鈹溾攢鈹€ scraper/            # Agent state DOM scraper
鈹?  鈹溾攢鈹€ actions/            # IDE automation
鈹?  鈹斺攢鈹€ sse/                # Real-time event streaming
鈹溾攢鈹€ bin/cli.js              # CLI entry point
鈹斺攢鈹€ public/                 # Static assets
```

## Code Style

- **TypeScript** for all source files
- **ESLint** with Next.js config
- Keep components focused and files under ~300 lines
- Use meaningful variable names 鈥?no abbreviations

## Questions?

Open a [Discussion](https://github.com/haoran1234s/Antigravity-Touch/discussions) or reach out in the issues. We're happy to help!
