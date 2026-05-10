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
