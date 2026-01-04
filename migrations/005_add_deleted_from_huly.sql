-- Migration: Add deleted_from_huly flag
-- When a Huly issue is deleted, mark it so Beads→Huly sync skips it permanently

ALTER TABLE issues ADD COLUMN deleted_from_huly INTEGER DEFAULT 0;

CREATE INDEX idx_issues_deleted_from_huly ON issues(deleted_from_huly);
