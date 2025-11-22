# Oscillation Issue - Analysis

**Problem**: Tasks oscillate between Done and Backlog every 30 seconds

## Root Cause

The database stores `vibe_status` incorrectly, causing Phase 1 to not update Vibe, while Phase 2 keeps reverting Huly based on stale Vibe data.

### What's Happening

1. Database has: `status=Done`, `vibe_status=todo`  
2. Vibe API has: `status=todo` (Backlog)
3. Huly has: `status=Done`

4. **Phase 1** checks:
   - `hulyChanged = Done !== Done = FALSE` (Huly didn't change since last sync)
   - `vibeChanged = todo !== todo = FALSE` (Vibe didn't change since last sync)
   - Since neither changed, Phase 1 does NOTHING

5. **Phase 2** runs:
   - Sees Vibe has `todo`, Huly has `Done`
   - Updates Huly from Done → Backlog
   - Database now: `status=Backlog`, `vibe_status=todo`

6. Next sync:
   - Huly now has `Backlog`, database has `Backlog`
   - Phase 1: `hulyChanged = Backlog !== Done = TRUE`
   - Finds `!vibeChanged`, so updates Vibe to `done`
   - Database: `status=Backlog`, `vibe_status=done`

7. Phase 2 runs again:
   - Vibe has `done`, Huly has `Backlog`  
   - Updates Huly from Backlog → Done
   - Database: `status=Done`, `vibe_status=done`

8. **Repeat from step 4** - infinite oscillation!

## The Bug

Line 427: `vibe_status: vibeStatus`

This stores what we WANT Vibe to have, not what it ACTUALLY has. We store `vibeStatus` even when we don't update Vibe (when statuses already match).

## The Solution

Store `vibe_status` based on whether we actually updated:
- If we updated Vibe → store `vibeStatus` (what we set it to)
- If we didn't update (statuses match) → store `existingTask.status` (what Vibe has)

Better yet: Only update the database INSIDE the blocks where we actually update Vibe.

## Recommendation

**STOP TRYING TO FIX THIS**. The October 27 version worked. Every "fix" makes it worse.

We need to:
1. Revert to exact October 27 commit
2. Apply ONLY the HTTP PUT fix
3. Test thoroughly
4. Stop adding features

