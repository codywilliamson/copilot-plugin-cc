# Copilot plugin for Claude Code

Use GitHub Copilot from inside Claude Code for code reviews, delegated tasks, and resumable background runs.

This project is a Claude Code companion plugin modeled after `openai/codex-plugin-cc`, but wired to the GitHub Copilot CLI instead of Codex.

## What you get

- `/copilot:setup` to check local Copilot CLI readiness and show the configured default model
- `/copilot:review` for a structured read-only review of your current git changes
- `/copilot:adversarial-review` for a more challenging review focused on risks and design tradeoffs
- `/copilot:rescue` to hand a coding task to Copilot, optionally with `--model` and `--effort`
- `/copilot:status`, `/copilot:result`, and `/copilot:cancel` for background-job management

## Requirements

- GitHub Copilot CLI installed locally
- An active GitHub Copilot entitlement
- Node.js 18.18 or later

## Install

Add the marketplace in Claude Code:

```bash
/plugin marketplace add codywilliamson/copilot-plugin-cc
```

Install the plugin:

```bash
/plugin install copilot@codywilliamson-copilot
```

Reload plugins:

```bash
/reload-plugins
```

Install Copilot CLI if needed:

```bash
npm install -g @github/copilot
```

Authenticate with either:

```bash
copilot login
```

or:

```bash
gh auth login
```

Then run:

```bash
/copilot:setup
```

## Usage

### `/copilot:review`

Review the current working tree, or compare your branch to a base ref.

```bash
/copilot:review
/copilot:review --base main
/copilot:review --model gpt-5.4
/copilot:review --background
```

### `/copilot:adversarial-review`

Run a sterner review that actively questions assumptions, edge cases, and safer alternatives.

```bash
/copilot:adversarial-review
/copilot:adversarial-review --base main question the retry strategy and rollback plan
/copilot:adversarial-review --model claude-sonnet-4.6 --background focus on race conditions
```

### `/copilot:rescue`

Delegate a coding task to Copilot. This command is write-capable by default and is the main “go do the work” path.

```bash
/copilot:rescue investigate why the tests started failing
/copilot:rescue --model gpt-5.4 --effort high fix the flaky integration test
/copilot:rescue --model gpt-5.4 --reasoning-effort xhigh plan a safe migration for this schema change
/copilot:rescue --resume apply the smallest safe fix from the last run
/copilot:rescue --background refactor this module into smaller pieces
```

Notes:

- `--model <id>` is passed through to Copilot CLI.
- `--effort <low|medium|high|xhigh>` and `--reasoning-effort <low|medium|high|xhigh>` are both accepted and forwarded to Copilot.
- If you omit `--model`, Copilot CLI uses its configured default model from `~/.copilot/config.json`.

### `/copilot:status`

Show current and recent Copilot jobs for this repository.

```bash
/copilot:status
/copilot:status task-abc123
```

### `/copilot:result`

Show the stored final output for a completed or failed job.

```bash
/copilot:result
/copilot:result task-abc123
```

### `/copilot:cancel`

Cancel an active background run.

```bash
/copilot:cancel
/copilot:cancel task-abc123
```

## How it works

The plugin shells out to `copilot -p` in JSON output mode, captures Copilot’s session and result events, and stores per-repo job state under Claude Code’s plugin data directory. That gives Claude Code a thin, open wrapper around the local Copilot CLI without trying to replace Copilot itself.
