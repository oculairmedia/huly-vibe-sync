-- Migration: Add timestamp tracking for conflict resolution
-- Adds columns to track when issues were last modified in Huly and Vibe
-- This enables "last-write-wins" conflict resolution

-- Add columns for modification timestamps from both systems
ALTER TABLE issues ADD COLUMN huly_modified_at INTEGER;
ALTER TABLE issues ADD COLUMN vibe_modified_at INTEGER;

-- Create indexes for timestamp queries (useful for debugging and analysis)
CREATE INDEX IF NOT EXISTS idx_issues_huly_modified ON issues(huly_modified_at);
CREATE INDEX IF NOT EXISTS idx_issues_vibe_modified ON issues(vibe_modified_at);
