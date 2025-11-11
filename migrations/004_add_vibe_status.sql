-- Migration: Add vibe_status column for proper Phase 1 conflict detection
-- The code tries to track Vibe's status separately from Huly's status
-- This column was missing, causing all Phase 1 syncs to be treated as conflicts

-- Add column to track last known Vibe status
ALTER TABLE issues ADD COLUMN vibe_status TEXT;

-- Create index for queries
CREATE INDEX IF NOT EXISTS idx_issues_vibe_status ON issues(vibe_status);
