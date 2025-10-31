-- Migration: Add Letta agent tracking columns to projects table
-- Date: 2025-10-31
-- Description: Adds columns to track Letta PM agent state per project

-- Add Letta columns to projects table
ALTER TABLE projects ADD COLUMN letta_agent_id TEXT;
ALTER TABLE projects ADD COLUMN letta_folder_id TEXT;
ALTER TABLE projects ADD COLUMN letta_source_id TEXT;
ALTER TABLE projects ADD COLUMN letta_last_sync_at INTEGER;

-- Add index for Letta sync tracking
CREATE INDEX IF NOT EXISTS idx_projects_letta_sync ON projects(letta_last_sync_at);
