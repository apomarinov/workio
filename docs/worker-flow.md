# Worker Flow: Debouncing, Locking, and Processing

## Complete Worker Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           MONITOR (hook event received)                      │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         start_debounced_worker()                             │
│                                                                              │
│  1. Generate timestamp = now()                                               │
│                                                                              │
│  2. Check marker file exists?                                                │
│     ├─ NO  → Create marker { start: timestamp, latest: timestamp }           │
│     └─ YES → Update marker { start: <keep>, latest: timestamp }              │
│                                                                              │
│  3. Spawn background worker: python worker.py <session_id> <timestamp>       │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ (runs async in background)
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         WORKER: process_session()                            │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
                        ┌─────────────────────────┐
                        │  Sleep DEBOUNCE_SECONDS │
                        │  (default: 2 seconds)   │
                        └─────────────────────────┘
                                      │
                                      ▼
                        ┌─────────────────────────┐
                        │  Read marker file       │
                        └─────────────────────────┘
                                      │
                                      ▼
                   ┌──────────────────────────────────┐
                   │  Marker exists?                  │
                   └──────────────────────────────────┘
                          │                  │
                         NO                 YES
                          │                  │
                          ▼                  ▼
                   ┌────────────┐    ┌──────────────────────────┐
                   │ Exit early │    │ Parse start & latest     │
                   └────────────┘    └──────────────────────────┘
                                                  │
                                                  ▼
                              ┌─────────────────────────────────────┐
                              │  Am I the latest?                   │
                              │  (my_timestamp == marker.latest)    │
                              └─────────────────────────────────────┘
                                      │                    │
                                     YES                   NO
                                      │                    │
                                      │                    ▼
                                      │     ┌──────────────────────────────┐
                                      │     │ Has debounce period expired? │
                                      │     │ (now - start >= DEBOUNCE_S)  │
                                      │     └──────────────────────────────┘
                                      │              │              │
                                      │             YES             NO
                                      │              │              │
                                      │              │              ▼
                                      │              │       ┌─────────────┐
                                      ▼              ▼       │ Exit early  │
                              ┌───────────────────────────┐  │ (let latest │
                              │     PROCEED TO LOCK       │  │  handle it) │
                              └───────────────────────────┘  └─────────────┘
                                           │
                                           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              LOCK ACQUISITION                                │
└─────────────────────────────────────────────────────────────────────────────┘
                                           │
                                           ▼
                              ┌───────────────────────────┐
                              │   Lock file exists?       │
                              └───────────────────────────┘
                                    │              │
                                   YES             NO
                                    │              │
                                    ▼              │
                         ┌──────────────────────┐  │
                         │ Read lock timestamp  │  │
                         └──────────────────────┘  │
                                    │              │
                                    ▼              │
                         ┌──────────────────────┐  │
                         │ Lock age > timeout?  │  │
                         │ (DEBOUNCE_S * 30)    │  │
                         └──────────────────────┘  │
                              │           │        │
                             YES          NO       │
                              │           │        │
                              ▼           ▼        │
                     ┌─────────────┐ ┌─────────┐   │
                     │Delete stale│ │Wait 1s  │   │
                     │   lock     │ │& retry  │   │
                     └─────────────┘ └────┬────┘   │
                              │           │        │
                              │     (loop back)    │
                              │           │        │
                              ▼           │        │
                         ┌────────────────┴────────┴───┐
                         │   Write lock file           │
                         │   (timestamp = now)         │
                         └─────────────────────────────┘
                                        │
                                        ▼
                         ┌─────────────────────────────┐
                         │  Re-check marker exists?    │
                         │  (another worker may have   │
                         │   processed while waiting)  │
                         └─────────────────────────────┘
                                 │              │
                                NO             YES
                                 │              │
                                 ▼              ▼
                          ┌───────────┐  ┌─────────────────┐
                          │Exit early │  │    PROCESS      │
                          └───────────┘  └─────────────────┘
                                                │
                                                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           TRANSCRIPT PROCESSING                              │
│                                                                              │
│  1. Get session from DB → get transcript_path                                │
│  2. Get latest prompt for session                                            │
│  3. Read transcript.jsonl line by line                                       │
│  4. For each entry:                                                          │
│     - Skip if UUID already exists in DB                                      │
│     - Parse user messages (string content only)                              │
│     - Parse assistant messages (text or thinking)                            │
│     - Insert into messages table                                             │
│  5. If prompt has no text, backfill from latest user message                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                                │
                                                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLEANUP                                         │
│                                                                              │
│  1. Re-read marker file                                                      │
│  2. If marker.latest == our_latest_timestamp:                                │
│     - No new events during processing → delete marker                        │
│  3. Else:                                                                    │
│     - New event arrived → preserve marker for that worker                    │
│  4. Delete lock file (releases lock)                                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Debounce Timeline Example

```
Time ─────────────────────────────────────────────────────────────────────────►

T=0ms     T=100ms    T=200ms         T=2000ms        T=2100ms       T=2200ms
  │          │          │                │               │              │
  ▼          ▼          ▼                ▼               ▼              ▼
Event 1   Event 2   Event 3         Worker 1        Worker 2       Worker 3
arrives   arrives   arrives         wakes up        wakes up       wakes up
  │          │          │                │               │              │
  │          │          │                │               │              │
  ▼          ▼          ▼                │               │              │
┌──────┐  ┌──────┐  ┌──────┐             │               │              │
│Create│  │Update│  │Update│             │               │              │
│marker│  │marker│  │marker│             │               │              │
└──────┘  └──────┘  └──────┘             │               │              │
                                         │               │              │
Marker: { start: T1, latest: T1 }        │               │              │
     → { start: T1, latest: T2 }         │               │              │
          → { start: T1, latest: T3 }    │               │              │
                                         │               │              │
                                         ▼               │              │
                                   ┌───────────┐         │              │
                                   │ latest=T3 │         │              │
                                   │ I am T1   │         │              │
                                   │ T1 ≠ T3   │         │              │
                                   │           │         │              │
                                   │ Debounce  │         │              │
                                   │ expired?  │         │              │
                                   │ 2s >= 2s ✓│         │              │
                                   │           │         │              │
                                   │ PROCESS!  │         │              │
                                   └───────────┘         │              │
                                         │               ▼              │
                                         │         ┌───────────┐        │
                                         │         │ latest=T3 │        │
                                         │         │ I am T2   │        │
                                         │         │ T2 ≠ T3   │        │
                                         │         │           │        │
                                         │         │ Debounce  │        │
                                         │         │ expired?  │        │
                                         │         │ 2.1s >= 2s│        │
                                         │         │           │        │
                                         │         │ Wait lock │        │
                                         │         └───────────┘        │
                                         │               │              ▼
                                   (processing...)       │        ┌───────────┐
                                         │               │        │ latest=T3 │
                                         │               │        │ I am T3 ✓ │
                                         │               │        │           │
                                         │               │        │ Wait lock │
                                         │               │        └───────────┘
                                         │               │              │
                                         ▼               │              │
                                   ┌───────────┐         │              │
                                   │  Delete   │         │              │
                                   │  marker   │         │              │
                                   │  & lock   │         │              │
                                   └───────────┘         │              │
                                                         ▼              ▼
                                                   ┌───────────┐  ┌───────────┐
                                                   │ No marker │  │ No marker │
                                                   │ → EXIT    │  │ → EXIT    │
                                                   └───────────┘  └───────────┘
```

## File Structure

```
debounce/
├── session-abc123.marker     # { "start": "...", "latest": "..." }
└── session-abc123.lock       # "2024-01-15T10:30:00" (timestamp when acquired)
```

## Key Design Decisions

| Problem | Solution |
|---------|----------|
| Rapid events flood system | Debounce: wait 2s, let events accumulate |
| Multiple workers wake up | Only "latest" timestamp proceeds (or if debounce expired) |
| Concurrent processing | Lock file serializes access |
| Crashed worker leaves lock | Stale lock timeout (DEBOUNCE_SECONDS * 30) |
| Processed while waiting for lock | Re-check marker after acquiring lock |
| Event during processing gets lost | Only delete marker if no new events arrived |

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `DEBOUNCE_SECONDS` | 2 | How long to wait before processing |

Lock timeout is calculated as `DEBOUNCE_SECONDS * 30` (default: 60 seconds).
