---
name: wio
description: Workio utilities — notifications, and more
---

A collection of skills for interacting with the Workio dashboard. Workio is a terminal management app running locally.

## Custom Notifications

Send notifications to the Workio dashboard (browser + push) via the API.

### API

```
POST https://localhost:5176/api/notifications/send
Content-Type: application/json

{ "title": "...", "body": "...", "terminalId": 1, "shellId": 2 }
```

- `title` (required): Short notification title
- `body` (required): Notification body text
- `terminalId` (optional): Associates the notification with a terminal for context
- `shellId` (optional): Associates the notification with a shell for context

When `terminalId` or `shellId` are provided, the server resolves their names and prepends `[Terminal > Shell]` context to the body automatically.

### How to call it

Use `curl -k` (self-signed cert) from Bash, command on a single line like this:

```bash
curl -sk -X POST "https://localhost:5176/api/notifications/send" -H "Content-Type: application/json" -d "{\"title\":\"...\",\"body\":\"...\"}"
```

### Environment variables

Your shell may have these env vars set by Workio — use them when available:

- `WORKIO_TERMINAL_ID` — the terminal ID for the current shell
- `WORKIO_SHELL_ID` — the shell ID for the current shell

Example with context:

```bash
curl -sk -X POST "https://localhost:5176/api/notifications/send" -H "Content-Type: application/json" -d "{\"title\":\"Build done\",\"body\":\"Frontend compiled successfully\",\"terminalId\":${WORKIO_TERMINAL_ID:-null},\"shellId\":${WORKIO_SHELL_ID:-null}}"
```

### When to use

You already send automatic notifications for task completion (done) and permission prompts. Custom notifications are for **in-progress updates** during long-running or monitoring tasks. Use them when the user won't get a "done" notification for a while and would benefit from intermediate status updates.

Examples:

- **Monitoring**: User asks you to watch a deployment, test suite, or build pipeline. Notify on stage completions, failures, or warnings as they happen.
- **Progress on multi-step work**: You're running a long sequence of operations (e.g., migrating data, processing files). Notify periodically so the user knows things are moving.
- **Errors during background work**: Something fails mid-task but you can recover or retry. Notify about the error so the user is aware, even if you continue working.
- **Waiting on external input**: A process you're monitoring requires manual intervention or has stalled. Notify so the user can take action.

Do NOT use for:
- Simple task completion (the built-in done notification handles this)
- Every single command you run (too noisy)
