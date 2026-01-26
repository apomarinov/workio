# Child Process Detection Plan

Detect spawned child processes (servers, long-running tasks) after commands are executed in the terminal.

## Approach

Poll for child processes briefly (1-2s) after each `command_start` event. This avoids continuous polling while still catching processes that spawn from the executed command.

## Implementation Steps

### 1. Add database column

```sql
-- In server/db.ts, add to terminals table
active_processes TEXT  -- JSON array of process names
```

Update `updateTerminal` to support `active_processes: string[] | null`.

### 2. Create cross-platform process detection

New file: `server/pty/process-tree.ts`

```typescript
import { execSync } from 'child_process'
import fs from 'fs'

export function getChildPids(pid: number): number[] {
  // Try Linux /proc first (faster, no process spawn)
  const childrenPath = `/proc/${pid}/task/${pid}/children`
  if (fs.existsSync(childrenPath)) {
    const content = fs.readFileSync(childrenPath, 'utf8').trim()
    return content ? content.split(' ').map(Number) : []
  }

  // Fallback to pgrep (macOS + Linux)
  try {
    const output = execSync(`pgrep -P ${pid}`, {
      encoding: 'utf8',
      timeout: 500,
    }).trim()
    return output ? output.split('\n').map(Number) : []
  } catch {
    return []
  }
}

export function getProcessComm(pid: number): string | null {
  // Try Linux /proc first
  const commPath = `/proc/${pid}/comm`
  if (fs.existsSync(commPath)) {
    return fs.readFileSync(commPath, 'utf8').trim()
  }

  // Fallback to ps
  try {
    return execSync(`ps -o comm= -p ${pid}`, {
      encoding: 'utf8',
      timeout: 500,
    }).trim()
  } catch {
    return null
  }
}

// Recursive to get full tree
export function getProcessTree(pid: number): string[] {
  const childPids = getChildPids(pid)
  const processes: string[] = []

  for (const childPid of childPids) {
    const comm = getProcessComm(childPid)
    if (comm) processes.push(comm)
    processes.push(...getProcessTree(childPid))
  }

  return processes
}

const IGNORE_PROCESSES = new Set(['zsh', 'bash', 'sh', 'fish'])

export function getChildProcesses(shellPid: number): string[] {
  return getProcessTree(shellPid).filter((p) => !IGNORE_PROCESSES.has(p))
}
```

### 3. Add polling function to manager

In `server/pty/manager.ts`:

```typescript
import { getChildProcesses } from './process-tree'

function pollChildProcesses(
  terminalId: number,
  shellPid: number,
  duration: number,
) {
  const interval = 300
  const endTime = Date.now() + duration
  let lastProcesses: string[] = []

  const poll = () => {
    if (Date.now() > endTime) return

    const children = getChildProcesses(shellPid)

    // Only update if changed
    if (JSON.stringify(children) !== JSON.stringify(lastProcesses)) {
      lastProcesses = children
      updateTerminal(terminalId, {
        active_processes: children.length > 0 ? children : null,
      })
    }

    setTimeout(poll, interval)
  }

  poll()
}
```

### 4. Hook into command_start event

```typescript
case 'command_start':
  session.isIdle = false
  session.currentCommand = event.command || null
  updateTerminal(terminalId, { active_cmd: event.command || null })

  // Start brief polling for child processes
  if (session.pty.pid) {
    pollChildProcesses(terminalId, session.pty.pid, 1500)
  }
  break
```

### 5. Clear on command end / idle

```typescript
case 'prompt':
  session.isIdle = true
  session.currentCommand = null
  updateTerminal(terminalId, { active_cmd: null, active_processes: null })
  break
```

### 6. Update types

In `src/types.ts`:

```typescript
export interface Terminal {
  // ...existing fields
  active_cmd: string | null
  active_processes: string[] | null
}
```

## Notes

- Polling duration of 1.5s should catch most process spawns
- 300ms interval = ~5 polls per command
- `/proc` is faster on Linux (file read vs process spawn)
- macOS falls back to `pgrep`/`ps`
- Filter out shell processes to reduce noise
- Short-lived processes (git, ls) naturally filtered by poll timing
