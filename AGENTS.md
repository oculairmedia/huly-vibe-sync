<!-- VIBESYNC:project-info:START -->

# Agent Instructions

## Project Identity

- **Project Code**: `HVSYN`
- **Project Name**: Vibe Sync Service
- **Letta Agent ID**: `agent-b417b8da-84d2-40dd-97ad-3a35454934f7`

## Workflow Instructions

1. **Before starting work**: Use the local Beads tracker (`bd ready`, `bd show <id>`, `bd update <id> --claim`) to find and claim related work.
2. **Issue references**: Use Beads issue IDs exactly as reported by `bd` (for example, `HVSYN-abc` or the repository's configured prefix).
3. **On task completion**: Report to this project's Letta agent via `matrix-identity-bridge` using `talk_to_agent`.
4. **Memory**: Store important discoveries with the configured project memory tool.
<!-- VIBESYNC:project-info:END -->

<!-- VIBESYNC:reporting-hierarchy:START -->

## PM Agent Communication

**Project PM Agent:** `PM - Vibe Sync Service` (agent-b417b8da-84d2-40dd-97ad-3a35454934f7)

### Reporting Hierarchy

```
Emmanuel (Stakeholder)
    ↓
Meridian (Director of Engineering)
    ↓
PM Agent (Technical Product Owner - mega-experienced)
    ↓ communicates with
You (Developer Agent - experienced)
```

### MANDATORY: Report to PM Agent

**BEFORE reporting outcomes to the user**, send a report to the PM agent via Matrix:

```json
{
  "operation": "talk_to_agent",
  "agent": "PM - Vibe Sync Service",
  "message": "<your report>",
  "caller_directory": "/opt/stacks/huly-vibe-sync"
}
```

### When to Contact PM Agent

| Situation             | Action                                                              |
| --------------------- | ------------------------------------------------------------------- |
| Task completed        | Report outcome to PM before responding to user                      |
| Blocking question     | Forward to PM - they know user's wishes and will escalate if needed |
| Architecture decision | Consult PM for guidance                                             |
| Unclear requirements  | PM can clarify or contact user                                      |

### Report Format

```
**Status**: [Completed/Blocked/In Progress]
**Task**: [Brief description]
**Outcome**: [What was done/What's blocking]
**Files Changed**: [List if applicable]
**Next Steps**: [If any]
```

<!-- VIBESYNC:reporting-hierarchy:END -->

<!-- VIBESYNC:beads-instructions:START -->

## Issue Tracking

This project uses **bd** (Beads) for local issue tracking. Beads is a CLI tool: interact with it only through `bd` commands, not by reading or writing its backing database directly. Run `bd prime` for the current workflow context and command reference.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for task tracking and follow-up work; do not route issue operations through external issue tools.
- Do not access the Beads/Dolt backing database directly. Use the `bd` CLI for all issue reads, updates, claims, closes, syncs, and durable notes.
- Create or update Beads issues before writing code when the work is non-trivial.
- Close completed issues with `bd close <id>` and include a reason when helpful.
- Use `bd remember` for durable project knowledge instead of ad-hoc memory files.

### Persistence

- Beads state is local-first. If the repository has a remote, persist issue changes with the configured Beads sync command before ending a session.
- If no git remote is configured, leave the Beads database and JSONL export in a clean local state and note that work is local-only.

<!-- VIBESYNC:beads-instructions:END -->

<!-- VIBESYNC:bookstack-docs:START -->

## BookStack Documentation

- **Source of truth**: [BookStack](https://knowledge.oculair.ca)
- **Local sync**: `docs/bookstack/` (read-only mirror, syncs hourly)
- **To read docs**: Check `docs/bookstack/{book-slug}/` in your project directory
- **To create/edit docs**: Use `bookstack-mcp` tools to write directly to BookStack
- **Never edit** files in `docs/bookstack/` locally — they will be overwritten on next sync
- **PRDs and design docs** must be stored in BookStack, not local markdown files
<!-- VIBESYNC:bookstack-docs:END -->

<!-- VIBESYNC:session-completion:START -->

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is not complete until code changes, Beads state, and handoff notes are in a clean state.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Persist changes** - If a git remote is configured, push code and Beads state:
   ```bash
   git pull --rebase
   bd dolt push
   git push
   git status  # MUST show "up to date with origin"
   ```
   If no remote is configured, verify `git status` and Beads state locally and mention that the session is local-only.
5. **Clean up** - Clear stashes and prune stale branches when applicable
6. **Verify** - All intended changes are committed or explicitly handed off
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**

- Do not leave issue updates half-applied; Beads is the source of truth for task state.
- Use the `bd` CLI only; do not inspect or mutate the Beads/Dolt backing database directly.
- Do not use external issue tools for issue tracking.
- If push is available and fails, resolve and retry until it succeeds.
<!-- VIBESYNC:session-completion:END -->

<!-- VIBESYNC:codebase-context:START -->

## Codebase Context

**Project**: Vibe Sync Service (`HVSYN`)
**Path**: `/opt/stacks/huly-vibe-sync`

This project's PM agent has a `codebase_ast` memory block with live structural data including:

- File counts and function counts per directory
- Key modules and their roles
- Quality signals (doc gaps, untested modules, complexity hotspots)
- Recent file changes

Ask the PM agent for architectural guidance before making significant changes.

<!-- VIBESYNC:codebase-context:END -->
