-- Migration 002: Add description hash for change detection
-- Purpose: Track changes to project descriptions to force sync when metadata changes

-- Add description_hash column to projects table
ALTER TABLE projects ADD COLUMN description_hash TEXT;

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_projects_description_hash ON projects(description_hash);

-- Note: Existing projects will have NULL description_hash initially.
-- The sync service will populate this on the next sync cycle.
