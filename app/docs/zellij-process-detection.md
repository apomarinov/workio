# Zellij Process Detection

How to detect running commands inside Zellij panes from outside the multiplexer.

## Platform Support

| Feature | macOS | Linux |
|---------|-------|-------|
| Socket path detection | `/var/folders/.../zellij-501/...` | `/tmp/zellij-<uid>/...` |
| `lsof` for sockets | ✅ | ✅ |
| `pgrep -P` | ✅ | ✅ |
| `/proc` filesystem | ❌ | ✅ (faster) |

## Multiplexer Support

| Multiplexer | Detection Method | Status |
|-------------|------------------|--------|
| Zellij | Socket path + process tree | ✅ Documented |
| tmux | `tmux list-panes -F` | ⚠️ TODO |
| screen | Process tree | ⚠️ TODO |

## Key Findings

### Zellij Architecture
- **Zellij servers** run as daemons with PPID=1
- **Zellij clients** connect to servers (have various PPIDs)
- Each **pane** runs a shell as a direct child of the server
- **Commands** run as children of the pane shells

### Process Tree Structure
```
zellij (server, PPID=1)
├── /bin/zsh (pane 1 shell)
│   └── ngrok http 3010 (running command)
├── /bin/zsh (pane 2 shell)
│   └── just dev (running command)
│       └── node, vite, etc. (child processes)
├── /bin/zsh (pane 3 shell)
│   └── (no children = idle)
└── /bin/zsh (pane 4 shell)
    └── just code (running command)
```

### Mapping Server PID to Session Name
Zellij servers use Unix sockets with the session name in the path:
```
/var/folders/.../zellij-501/0.43.1/<SESSION_NAME>
```

Use `lsof` to find the socket and extract session name:
```bash
lsof -p <SERVER_PID> 2>/dev/null | grep 'unix.*zellij-501' | head -1 | awk '{print $NF}' | grep -oE '[^/]+$'
```

## Working Commands

### List All Zellij Processes
```bash
ps -axo pid,ppid,comm | grep zellij
```

Example output:
```
 9492     1 /opt/homebrew/bin/zellij    # server (PPID=1)
52165     1 /opt/homebrew/bin/zellij    # server (PPID=1)
 9489  7053 zellij                       # client
52162 39907 zellij                       # client
```

### Find Server PIDs (PPID=1)
```bash
ps -axo pid,ppid,comm | awk '$3 ~ /zellij/ && $2 == 1 {print $1}'
```

### Map Server PIDs to Session Names
```bash
for zpid in $(ps -axo pid,ppid,comm | awk '$3 ~ /zellij/ && $2 == 1 {print $1}'); do
  session=$(lsof -p $zpid 2>/dev/null | grep 'unix.*zellij-501' | head -1 | awk '{print $NF}' | grep -oE '[^/]+$')
  echo "Server $zpid = session '$session'"
done
```

Example output:
```
Server 9492 = session 'awesome-ocelot'
Server 52165 = session '1'
Server 60186 = session 'undulating-lake'
Server 74939 = session '2'
```

### Get Running Commands for a Session
```bash
session_name="1"

# Find server PID for this session
server_pid=$(for zpid in $(ps -axo pid,ppid,comm | awk '$3 ~ /zellij/ && $2 == 1 {print $1}'); do
  sess=$(lsof -p $zpid 2>/dev/null | grep 'unix.*zellij-501' | head -1 | awk '{print $NF}' | grep -oE '[^/]+$')
  if [ "$sess" = "$session_name" ]; then
    echo $zpid
    break
  fi
done)

echo "Session '$session_name':"
for shell_pid in $(pgrep -P $server_pid); do
  cmd_pid=$(pgrep -P $shell_pid 2>/dev/null | head -1)
  if [ -n "$cmd_pid" ]; then
    cmd=$(ps -o args= -p $cmd_pid 2>/dev/null)
    echo "  $cmd"
  else
    echo "  (idle)"
  fi
done
```

Example output:
```
Session '1':
  ngrok http 3010
  just dev
  (idle)
  just code
```

## Zellij CLI Commands (Limited Use)

These commands exist but have limitations:

### query-tab-names
```bash
zellij -s <session> action query-tab-names
```
Returns tab names but not running commands.

### list-clients
```bash
zellij -s <session> action list-clients
```
Shows `RUNNING_COMMAND` but **only for the active tab**, not all panes.

### dump-layout
```bash
zellij -s <session> action dump-layout
```
Shows startup configuration, not live running commands.

## Environment Variables (Inside Zellij)

When inside a Zellij pane:
```bash
ZELLIJ=0
ZELLIJ_PANE_ID=2
ZELLIJ_SESSION_NAME=1
```

## Implementation Notes

### Detecting Idle vs Running
- **Idle pane**: Shell has no child processes (`pgrep -P <shell_pid>` returns empty)
- **Running command**: Shell has child process(es)

### Getting Full Command with Arguments
Use `ps -o args=` instead of `ps -o comm=` to get the full command line:
```bash
ps -o args= -p <pid>
# Returns: "ngrok http 3010" instead of just "ngrok"
```

### Polling Interval
The process tree approach is lightweight and can be polled every 1-3 seconds without significant overhead.

### Cross-Platform
- macOS: Uses `lsof` for socket detection, `pgrep`/`ps` for process tree
- Linux: Could use `/proc` filesystem for faster access (not implemented yet)

---

## Linux Adaptations

### Socket Path
On Linux, Zellij sockets are typically in:
```
/tmp/zellij-<UID>/<VERSION>/<SESSION_NAME>
```

### Using /proc (Faster)
```bash
# Get child PIDs without spawning pgrep
cat /proc/<pid>/task/<pid>/children

# Get process name
cat /proc/<pid>/comm

# Get full command line
cat /proc/<pid>/cmdline | tr '\0' ' '
```

---

## tmux Detection (TODO)

tmux has built-in commands to query pane state:

```bash
# List all panes with their commands
tmux list-panes -a -F '#{session_name}:#{window_index}.#{pane_index} #{pane_current_command}'

# Get pane PID
tmux list-panes -a -F '#{pane_pid}'

# Get running command in pane
tmux list-panes -a -F '#{pane_current_command}'
```

This is more reliable than process tree walking for tmux.

---

## screen Detection (TODO)

screen is trickier - it doesn't have a query API like tmux.

Approach:
1. Find screen server processes (PPID=1, comm=screen or SCREEN)
2. Walk process tree like Zellij

```bash
# Find screen servers
ps -axo pid,ppid,comm | awk '$3 == "screen" && $2 == 1'

# Then walk children similar to Zellij approach
```
