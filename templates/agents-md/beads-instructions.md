## Beads Issue Tracking

This project uses **bd** (beads) for issue tracking. Run `bd onboard` to get started.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --status in_progress  # Claim work
bd close <id>         # Complete work
bd sync               # Sync with git
```

### Beads Sync Flow (Hybrid System)

Beads uses a **hybrid sync** approach for reliability:

#### Automatic Sync (Real-time)

- `bd create`, `bd update`, `bd close` write to SQLite DB
- File watcher detects DB changes automatically
- Syncs to Huly within ~30-60 seconds

#### Git Persistence (`bd sync`)

- `bd sync` exports to JSONL and commits to git
- Required for cross-machine persistence
- Run before ending session to ensure changes are saved

### Best Practice

```bash
bd create "New task"   # Auto-syncs to Huly
bd close some-issue    # Auto-syncs to Huly
bd sync                # Git backup (recommended before session end)
```
